import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSameOrigin,
  chunkText,
  HttpError,
  MAX_CHUNKS,
  MAX_EXTRACTED_CHARACTERS,
  parseJsonBody,
  validatePublishedAt,
  validateQuestion,
  validateSourceUrl
} from "../netlify/shared/rag-utils.mjs";

test("chunkText preserves text coverage and overlaps adjacent fragments", () => {
  const text = "palabra ".repeat(600);
  const chunks = chunkText(text, 200, 30);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 200));
  assert.ok(chunks[0].endsWith(chunks[1].slice(0, 30)));
  assert.ok(chunks.at(-1).length > 0);
});

test("chunkText reports all fragments so uploads can reject over-limit files", () => {
  const chunks = chunkText("texto ".repeat(24_000));
  assert.ok(chunks.length > MAX_CHUNKS);
});

test("upload limits admit the 43-page ARCOTEL regulation PDF text volume", () => {
  const text = "norma ".repeat(18_366);
  const chunks = chunkText(text);
  assert.ok(text.length <= MAX_EXTRACTED_CHARACTERS);
  assert.ok(chunks.length <= MAX_CHUNKS);
});

test("validateQuestion trims and enforces length", () => {
  assert.equal(validateQuestion("  ¿Qué aplica?  "), "¿Qué aplica?");
  assert.throws(() => validateQuestion(" "), HttpError);
});

test("validateSourceUrl only accepts public HTTPS URLs", () => {
  assert.equal(validateSourceUrl("https://arcotel.gob.ec/norma"), "https://arcotel.gob.ec/norma");
  assert.throws(() => validateSourceUrl("http://arcotel.gob.ec"), HttpError);
  assert.throws(() => validateSourceUrl("javascript:alert(1)"), HttpError);
});

test("validatePublishedAt rejects impossible calendar dates", () => {
  assert.equal(validatePublishedAt("2026-11-01"), "2026-11-01");
  assert.throws(() => validatePublishedAt("2026-02-31"), HttpError);
  assert.throws(() => validatePublishedAt("not-a-date"), HttpError);
});

test("assertSameOrigin rejects cross-site requests", () => {
  const request = new Request("https://site.example/.netlify/functions/rag-chat", {
    headers: { Origin: "https://attacker.example" }
  });
  assert.throws(() => assertSameOrigin(request), HttpError);
});

test("parseJsonBody rejects invalid JSON and oversized requests", async () => {
  const invalid = new Request("https://site.example/api", { method: "POST", body: "{" });
  await assert.rejects(() => parseJsonBody(invalid), HttpError);
  const oversized = new Request("https://site.example/api", {
    method: "POST",
    headers: { "Content-Length": "9000" },
    body: "{}"
  });
  await assert.rejects(() => parseJsonBody(oversized, 100), HttpError);
});
