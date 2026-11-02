import test from "node:test";
import assert from "node:assert/strict";
import ragChat from "../netlify/functions/rag-chat.mjs";
import ragUpload from "../netlify/functions/rag-upload.mjs";
import ragDocuments from "../netlify/functions/rag-documents.mjs";

const withEnvironment = async (values, action) => {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const createPdf = (text) => {
  const stream = `BT /F1 14 Tf 50 730 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += `${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
};

test("RAG endpoints reject unsupported methods", async () => {
  for (const handler of [ragChat, ragUpload, ragDocuments]) {
    const response = await handler(new Request("https://site.example/.netlify/functions/test", {
      method: "PUT"
    }), { ip: "127.0.0.1" });
    assert.equal(response.status, 405);
    assert.equal((await response.json()).code, "METHOD_NOT_ALLOWED");
  }
});

test("chat searches documents and returns cited sources", async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    GEMINI_API_KEY: "test-key",
    SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    RAG_RATE_LIMIT_SECRET: "test-rate-limit-secret"
  };
  await withEnvironment(env, async () => {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.includes("consume_rag_chat_rate_limit")) {
        return Response.json([{ allowed: true, remaining: 19, resets_at: "2026-11-02T00:00:00Z" }]);
      }
      if (url.includes("match_rag_chunks")) {
        return Response.json([
          {
            document_id: "doc-1",
            title: "Norma de prueba",
            source_url: "https://arcotel.gob.ec/norma.pdf",
            published_at: "2026-01-01",
            content: "La norma establece un requisito de prueba.",
            similarity: 0.81
          },
          {
            document_id: "doc-1",
            title: "Norma de prueba",
            source_url: "https://arcotel.gob.ec/norma.pdf",
            published_at: "2026-01-01",
            content: "El requisito debe verificarse en la fuente.",
            similarity: 0.78
          }
        ]);
      }
      if (url.includes(":batchEmbedContents")) {
        return Response.json({ embeddings: [{ values: Array(768).fill(0.01) }] });
      }
      if (url.includes(":generateContent")) {
        const requestBody = JSON.parse(init.body);
        assert.match(requestBody.contents[0].parts[0].text, /\[1\] Documento: Norma de prueba/);
        return Response.json({
          candidates: [{ content: { parts: [{ text: "La norma establece el requisito [1]." }] } }]
        });
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    };

    try {
      const response = await ragChat(new Request("https://site.example/.netlify/functions/rag-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://site.example" },
        body: JSON.stringify({ question: "¿Qué requisito establece la norma?" })
      }), { ip: "192.0.2.10" });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.answer, "La norma establece el requisito [1].");
      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].reference, 1);
      assert.equal(result.sources[0].title, "Norma de prueba");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("authorized admin uploads and indexes a public PDF", async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    GEMINI_API_KEY: "test-key",
    SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    RAG_RATE_LIMIT_SECRET: "test-rate-limit-secret",
    RAG_ADMIN_EMAILS: "owner@example.com"
  };
  await withEnvironment(env, async () => {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/.netlify/identity/user")) {
        return Response.json({ email: "owner@example.com" });
      }
      if (url.includes(":batchEmbedContents")) {
        const count = JSON.parse(init.body).requests.length;
        return Response.json({ embeddings: Array.from({ length: count }, () => ({ values: Array(768).fill(0.02) })) });
      }
      if (url.includes("/storage/v1/object/rag-documents/")) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/ingest_rag_document")) {
        return Response.json(JSON.parse(init.body).p_document_id);
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    };

    try {
      const form = new FormData();
      form.set("title", "Norma pública de prueba");
      form.set("sourceUrl", "https://arcotel.gob.ec/norma.pdf");
      form.set("publishedAt", "2026-01-01");
      form.set("publicDocument", "yes");
      form.set("file", new File([
        createPdf("Texto público de una norma de telecomunicaciones con contenido suficiente para extraer y generar un índice de búsqueda semántica.")
      ], "norma.pdf", { type: "application/pdf" }));
      const response = await ragUpload(new Request("https://site.example/.netlify/functions/rag-upload", {
        method: "POST",
        headers: {
          Authorization: "Bearer identity-token",
          Origin: "https://site.example"
        },
        body: form
      }));
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.title, "Norma pública de prueba");
      assert.equal(result.filename, "norma.pdf");
      assert.ok(result.chunks > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("document management rejects authenticated users outside the allowlist", async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    GEMINI_API_KEY: "test-key",
    SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    RAG_RATE_LIMIT_SECRET: "test-rate-limit-secret",
    RAG_ADMIN_EMAILS: "owner@example.com"
  };
  await withEnvironment(env, async () => {
    globalThis.fetch = async (input) => {
      assert.match(String(input), /\.netlify\/identity\/user$/);
      return Response.json({ email: "other@example.com" });
    };
    try {
      const response = await ragDocuments(new Request("https://site.example/.netlify/functions/rag-documents", {
        method: "GET",
        headers: {
          Authorization: "Bearer identity-token",
          Origin: "https://site.example"
        }
      }));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "ADMIN_ACCESS_REQUIRED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("public chat reports when its providers are not configured", async () => {
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const response = await ragChat(new Request("https://site.example/.netlify/functions/rag-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://site.example" },
      body: JSON.stringify({ question: "¿Qué norma aplica?" })
    }), { ip: "127.0.0.1" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "RAG_NOT_CONFIGURED");
  } finally {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  }
});
