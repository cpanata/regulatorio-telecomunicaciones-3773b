import {
  assertSameOrigin,
  authenticateAdmin,
  errorResponse,
  getEnvironment,
  HttpError,
  jsonResponse,
  requireAdminEnvironment,
  supabaseRequest
} from "../shared/rag-utils.mjs";

const BUCKET = "rag-documents";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const encodeStoragePath = (path) => path.split("/").map(encodeURIComponent).join("/");

const handler = async (request) => {
  if (!["GET", "DELETE"].includes(request.method)) {
    return jsonResponse(405, { error: "Método no permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  try {
    assertSameOrigin(request);
    const env = getEnvironment();
    requireAdminEnvironment(env);
    await authenticateAdmin(request, env);

    if (request.method === "GET") {
      const documents = await supabaseRequest(
        env,
        "/rest/v1/rag_documents?select=id,title,filename,source_url,published_at,created_at&order=created_at.desc&limit=100"
      );
      if (!Array.isArray(documents)) throw new Error("Supabase returned an invalid document list.");
      return jsonResponse(200, { documents });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "INVALID_JSON", "La solicitud no contiene JSON válido.");
    }
    if (typeof body?.id !== "string" || !UUID_PATTERN.test(body.id)) {
      throw new HttpError(400, "INVALID_DOCUMENT_ID", "El identificador del documento no es válido.");
    }
    const documents = await supabaseRequest(
      env,
      `/rest/v1/rag_documents?select=id,storage_path&id=eq.${encodeURIComponent(body.id)}`
    );
    const document = Array.isArray(documents) ? documents[0] : null;
    if (!document) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "El documento ya no existe.");

    const storageResponse = await fetch(
      `${env.supabaseUrl}/storage/v1/object/${BUCKET}/${encodeStoragePath(document.storage_path)}`,
      {
        method: "DELETE",
        headers: { apikey: env.supabaseKey, Authorization: `Bearer ${env.supabaseKey}` },
        signal: AbortSignal.timeout(10_000)
      }
    );
    if (!storageResponse.ok && storageResponse.status !== 404) {
      throw new Error(`Supabase Storage delete failed (${storageResponse.status}): ${await storageResponse.text()}`);
    }
    await supabaseRequest(env, `/rest/v1/rag_documents?id=eq.${encodeURIComponent(body.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    return jsonResponse(200, { id: body.id, deleted: true });
  } catch (error) {
    return errorResponse(error, "rag-documents");
  }
};

export default handler;
