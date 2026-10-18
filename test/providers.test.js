import test from "node:test";
import assert from "node:assert/strict";
import { createChatResponder } from "../src/providers/ollama.js";
import { createPiperSynthesizer } from "../src/providers/piper.js";

test("chat provider calls OpenAI-compatible local endpoint", async () => {
  let call;
  const respond = createChatResponder({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "test-model",
    apiKey: "local-key",
    systemPrompt: "Keep it short.",
    fetchImpl: async (url, options) => {
      call = { url: String(url), options };
      return Response.json({ choices: [{ message: { content: "  Hello there.  " } }] });
    },
  });

  assert.equal(await respond("Say hello"), "Hello there.");
  assert.equal(call.url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(call.options.headers.authorization, "Bearer local-key");
  assert.deepEqual(JSON.parse(call.options.body).messages, [
    { role: "system", content: "Keep it short." },
    { role: "user", content: "Say hello" },
  ]);
});

test("chat provider reports missing or failed model responses", async () => {
  assert.throws(() => createChatResponder({ baseUrl: "http://127.0.0.1/v1" }), /LLM_MODEL/);
  const respond = createChatResponder({
    baseUrl: "http://127.0.0.1/v1",
    model: "test-model",
    fetchImpl: async () => new Response("offline", { status: 503 }),
  });
  await assert.rejects(respond("hello"), /HTTP 503/);
});

test("Piper provider sends text and accepts bounded WAV output", async () => {
  let call;
  const wav = Buffer.from("RIFF....WAVE");
  const synthesize = createPiperSynthesizer({
    url: "http://127.0.0.1:5001/synthesize",
    voice: "en_US-test",
    fetchImpl: async (url, options) => {
      call = { url: String(url), options };
      return new Response(wav, { headers: { "content-type": "audio/wav" } });
    },
  });

  assert.deepEqual(await synthesize("Hello there."), wav);
  assert.equal(call.url, "http://127.0.0.1:5001/synthesize");
  assert.deepEqual(JSON.parse(call.options.body), { text: "Hello there.", voice: "en_US-test" });
});

test("Piper provider validates WAV bytes even when Piper labels them as HTML", async () => {
  const wav = Buffer.from("RIFF....WAVE");
  const synthesize = createPiperSynthesizer({
    url: "http://127.0.0.1:5001/synthesize",
    fetchImpl: async () => new Response(wav, { headers: { "content-type": "text/html; charset=utf-8" } }),
  });
  assert.deepEqual(await synthesize("hello"), wav);
});

test("Piper provider rejects invalid WAV and oversized output", async () => {
  const wrongType = createPiperSynthesizer({
    url: "http://127.0.0.1:5001/synthesize",
    fetchImpl: async () => new Response("no audio", { headers: { "content-type": "text/plain" } }),
  });
  await assert.rejects(wrongType("hello"), /invalid WAV/);

  const invalidWaveHeader = createPiperSynthesizer({
    url: "http://127.0.0.1:5001/synthesize",
    fetchImpl: async () => new Response(Buffer.from("RIFF....NOPE"), { headers: { "content-type": "audio/wav" } }),
  });
  await assert.rejects(invalidWaveHeader("hello"), /invalid WAV/);

  const tooLarge = createPiperSynthesizer({
    url: "http://127.0.0.1:5001/synthesize",
    maxAudioBytes: 16,
    fetchImpl: async () => new Response(Buffer.from("RIFF".padEnd(32, ".")), { headers: { "content-type": "audio/wav" } }),
  });
  await assert.rejects(tooLarge("hello"), /exceeds 16 bytes/);
});
