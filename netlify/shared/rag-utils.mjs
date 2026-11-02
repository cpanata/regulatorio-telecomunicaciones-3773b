import { createHmac } from "node:crypto";

export const MAX_QUESTION_LENGTH = 1000;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 80_000;
export const MAX_CHUNKS = 60;
export const EMBEDDING_DIMENSIONS = 768;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });

export const getEnvironment = () => ({
  geminiApiKey: process.env.GEMINI_API_KEY?.trim(),
  chatModel: process.env.GEMINI_CHAT_MODEL?.trim() || "gemini-2.5-flash",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001",
  supabaseUrl: process.env.SUPABASE_URL?.trim()?.replace(/\/+$/, ""),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  rateLimitSecret: process.env.RAG_RATE_LIMIT_SECRET?.trim(),
  adminEmails: (process.env.RAG_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  matchThreshold: Number(process.env.RAG_MATCH_THRESHOLD || "0.45"),
  maxRequestsPerHour: Number(process.env.RAG_MAX_REQUESTS_PER_HOUR || "20")
});

export const requireChatEnvironment = (env) => {
  if (!env.geminiApiKey || !env.embeddingModel || !env.chatModel) {
    throw new HttpError(503, "RAG_NOT_CONFIGURED", "El asistente documental aún no está configurado.");
  }
  if (!env.supabaseUrl || !env.supabaseKey || !env.rateLimitSecret) {
    throw new HttpError(503, "RAG_CONFIGURATION_ERROR", "El asistente documental no está disponible por una configuración incompleta.");
  }
  if (!Number.isFinite(env.matchThreshold) || env.matchThreshold < 0 || env.matchThreshold > 1 ||
      !Number.isInteger(env.maxRequestsPerHour) || env.maxRequestsPerHour < 1 || env.maxRequestsPerHour > 100) {
    throw new HttpError(503, "RAG_CONFIGURATION_ERROR", "Los límites del asistente documental no están configurados correctamente.");
  }
};

export const requireAdminEnvironment = (env) => {
  requireChatEnvironment(env);
  if (!env.adminEmails.length) {
    throw new HttpError(503, "RAG_ADMIN_NOT_CONFIGURED", "La administración documental no está configurada.");
  }
};

export const assertSameOrigin = (request) => {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origen de solicitud no permitido.");
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origen de solicitud no permitido.");
    }
  }
};

export const validateQuestion = (question) => {
  if (typeof question !== "string") {
    throw new HttpError(400, "INVALID_QUESTION", "Escribe una pregunta para el asistente.");
  }
  const cleaned = question.trim();
  if (cleaned.length < 3 || cleaned.length > MAX_QUESTION_LENGTH) {
    throw new HttpError(400, "INVALID_QUESTION", `La pregunta debe tener entre 3 y ${MAX_QUESTION_LENGTH} caracteres.`);
  }
  return cleaned;
};

export const chunkText = (text, chunkSize = 1400, overlap = 180) => {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length);
    if (end < cleaned.length) {
      const boundary = cleaned.lastIndexOf(" ", end);
      if (boundary > start + chunkSize * 0.65) end = boundary;
    }
    chunks.push(cleaned.slice(start, end).trim());
    if (end >= cleaned.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
};

export const parseJsonBody = async (request, maxBytes = 8_192) => {
  const declaredSize = Number(request.headers.get("content-length") || "0");
  if (declaredSize > maxBytes) {
    throw new HttpError(413, "REQUEST_TOO_LARGE", "La solicitud supera el tamaño permitido.");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "La solicitud no contiene JSON válido.");
  }
  return body;
};

export const validateSourceUrl = (value) => {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "INVALID_SOURCE_URL", "La fuente debe ser una URL HTTPS válida.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new HttpError(400, "INVALID_SOURCE_URL", "La fuente debe ser una URL HTTPS pública.");
  }
  return url.toString();
};

export const validatePublishedAt = (value) => {
  if (!value) return null;
  const timestamp = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : Number.NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "INVALID_PUBLICATION_DATE", "La fecha del documento no es válida.");
  }
  return value;
};

export const hashClientIp = (ip, secret) => {
  if (!ip) throw new HttpError(503, "CLIENT_IP_UNAVAILABLE", "No fue posible verificar el límite de consultas.");
  return createHmac("sha256", secret).update(ip).digest("hex");
};

export const supabaseRequest = async (env, path, options = {}) => {
  const response = await fetch(`${env.supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: env.supabaseKey,
      Authorization: `Bearer ${env.supabaseKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(20_000)
  });
  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = responseText;
  }
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
};

export const callGemini = async (apiKey, model, method, body) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000)
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini API request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
};

export const makeEmbeddings = async (env, texts, taskType) => {
  const result = await callGemini(env.geminiApiKey, env.embeddingModel, "batchEmbedContents", {
    requests: texts.map((text) => ({
      model: `models/${env.embeddingModel}`,
      content: { parts: [{ text }] },
      config: {
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS
      }
    }))
  });
  const embeddings = result?.embeddings?.map((item) => item.values);
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length ||
      embeddings.some((item) => !Array.isArray(item) || item.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Gemini returned embeddings with an unexpected shape.");
  }
  return embeddings;
};

export const authenticateAdmin = async (request, env) => {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token.length > 4096) {
    throw new HttpError(401, "AUTHENTICATION_REQUIRED", "Inicia sesión con una cuenta autorizada.");
  }
  const identityUrl = new URL("/.netlify/identity/user", request.url);
  const response = await fetch(identityUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new HttpError(401, "INVALID_SESSION", "La sesión expiró. Inicia sesión nuevamente.");
  }
  const user = await response.json();
  if (!env.adminEmails.includes(String(user.email || "").toLowerCase())) {
    throw new HttpError(403, "ADMIN_ACCESS_REQUIRED", "Esta cuenta no está autorizada para administrar documentos.");
  }
  return user;
};

export const errorResponse = (error, operation) => {
  if (error instanceof HttpError) {
    return jsonResponse(error.status, { error: error.message, code: error.code });
  }
  console.error(`${operation} failed`, error);
  return jsonResponse(502, {
    error: "No se pudo completar la operación. Verifica la configuración o inténtalo más tarde.",
    code: "RAG_UPSTREAM_ERROR"
  });
};
