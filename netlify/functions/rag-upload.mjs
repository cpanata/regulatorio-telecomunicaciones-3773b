import { createHash, randomUUID } from "node:crypto";
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import {
  assertSameOrigin,
  authenticateAdmin,
  chunkText,
  errorResponse,
  getEnvironment,
  HttpError,
  jsonResponse,
  makeEmbeddings,
  MAX_CHUNKS,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PDF_BYTES,
  requireAdminEnvironment,
  supabaseRequest,
  validatePublishedAt,
  validateSourceUrl
} from "../shared/rag-utils.mjs";

globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

const { PDFParse } = await import("pdf-parse");

const BUCKET = "rag-documents";

const encodeStoragePath = (path) => path.split("/").map(encodeURIComponent).join("/");

const handler = async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Método no permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  let uploadedPath;
  let env;
  try {
    assertSameOrigin(request);
    env = getEnvironment();
    requireAdminEnvironment(env);
    await authenticateAdmin(request, env);

    const declaredSize = Number(request.headers.get("content-length") || "0");
    if (declaredSize > MAX_PDF_BYTES + 32_000) {
      throw new HttpError(413, "FILE_TOO_LARGE", "El PDF supera el límite de 5 MB.");
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "INVALID_FORM", "No se pudo leer el formulario de carga.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new HttpError(400, "PDF_REQUIRED", "Selecciona un archivo PDF.");
    }
    if (form.get("publicDocument") !== "yes") {
      throw new HttpError(400, "PUBLIC_DOCUMENT_CONFIRMATION_REQUIRED", "Confirma que el documento es público y puede procesarse.");
    }
    if (file.size > MAX_PDF_BYTES || file.type !== "application/pdf") {
      throw new HttpError(400, "INVALID_PDF", "Solo se aceptan archivos PDF de hasta 5 MB.");
    }
    const title = String(form.get("title") || "").trim();
    if (title.length < 3 || title.length > 160) {
      throw new HttpError(400, "INVALID_TITLE", "El título debe tener entre 3 y 160 caracteres.");
    }
    const sourceUrl = validateSourceUrl(String(form.get("sourceUrl") || "").trim());
    const publishedAt = validatePublishedAt(String(form.get("publishedAt") || "").trim());
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new HttpError(400, "INVALID_PDF_SIGNATURE", "El archivo no contiene una firma PDF válida.");
    }

    const parser = new PDFParse({ data: bytes });
    let extractedText;
    try {
      const parsed = await parser.getText();
      extractedText = parsed.text
        .replace(/\u0000/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch {
      throw new HttpError(422, "PDF_UNREADABLE", "No se pudo interpretar el PDF. Verifica que el archivo no esté dañado o protegido.");
    } finally {
      await parser.destroy();
    }
    if (!extractedText || extractedText.length < 100) {
      throw new HttpError(422, "PDF_TEXT_NOT_FOUND", "No se encontró texto suficiente. Los PDF escaneados requieren OCR y aún no están soportados.");
    }
    if (extractedText.length > MAX_EXTRACTED_CHARACTERS) {
      throw new HttpError(413, "PDF_TEXT_TOO_LONG", "El PDF contiene demasiado texto para esta primera versión; divide el documento en archivos más pequeños.");
    }

    const chunks = chunkText(extractedText);
    if (!chunks.length || chunks.length > MAX_CHUNKS) {
      throw new HttpError(413, "TOO_MANY_CHUNKS", "El documento supera el límite de fragmentos admitido.");
    }
    const embeddings = await makeEmbeddings(env, chunks.map((chunk) => `title: ${title} | text: ${chunk}`), "RETRIEVAL_DOCUMENT");
    const documentId = randomUUID();
    const baseFilename = file.name.split(/[\\/]/).pop() || "";
    const cleanedFilename = baseFilename.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^\.+/, "").slice(-120);
    const safeFilename = /\.pdf$/i.test(cleanedFilename)
      ? cleanedFilename
      : `${cleanedFilename || "documento"}.pdf`;
    uploadedPath = `${documentId}/${safeFilename}`;
    const storageResponse = await fetch(
      `${env.supabaseUrl}/storage/v1/object/${BUCKET}/${encodeStoragePath(uploadedPath)}`,
      {
        method: "POST",
        headers: {
          apikey: env.supabaseKey,
          Authorization: `Bearer ${env.supabaseKey}`,
          "Content-Type": "application/pdf",
          "x-upsert": "false"
        },
        body: bytes,
        signal: AbortSignal.timeout(20_000)
      }
    );
    if (!storageResponse.ok) {
      throw new Error(`Supabase Storage upload failed (${storageResponse.status}): ${await storageResponse.text()}`);
    }

    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const storedId = await supabaseRequest(env, "/rest/v1/rpc/ingest_rag_document", {
      method: "POST",
      body: JSON.stringify({
        p_document_id: documentId,
        p_title: title,
        p_filename: safeFilename,
        p_storage_path: uploadedPath,
        p_source_url: sourceUrl,
        p_published_at: publishedAt,
        p_content_sha256: contentHash,
        p_chunks: chunks.map((content, chunkIndex) => ({
          chunk_index: chunkIndex,
          content,
          embedding: embeddings[chunkIndex]
        }))
      })
    });
    if (storedId !== documentId) throw new Error("Supabase returned an unexpected document identifier.");
    return jsonResponse(201, {
      id: documentId,
      title,
      filename: safeFilename,
      chunks: chunks.length
    });
  } catch (error) {
    if (uploadedPath && env?.supabaseUrl && env?.supabaseKey) {
      try {
        const cleanup = await fetch(
          `${env.supabaseUrl}/storage/v1/object/${BUCKET}/${encodeStoragePath(uploadedPath)}`,
          {
            method: "DELETE",
            headers: { apikey: env.supabaseKey, Authorization: `Bearer ${env.supabaseKey}` },
            signal: AbortSignal.timeout(10_000)
          }
        );
        if (!cleanup.ok) console.error("Could not clean up uploaded source file", cleanup.status);
      } catch (cleanupError) {
        console.error("Could not clean up uploaded source file", cleanupError);
      }
    }
    if (error?.code === "23505" || /duplicate key value/i.test(error?.message || "")) {
      return jsonResponse(409, { error: "Este PDF ya fue cargado anteriormente.", code: "DUPLICATE_DOCUMENT" });
    }
    return errorResponse(error, "rag-upload");
  }
};

export default handler;
