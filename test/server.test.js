import test from "node:test";
import assert from "node:assert/strict";
import { createAudioStore } from "../src/audio-store.js";
import { createServer } from "../src/server.js";

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("HTTP endpoint validates, authenticates, and submits transcript events", async () => {
  const calls = [];
  const audioStore = createAudioStore({ baseUrl: "http://127.0.0.1:8787" });
  const server = {
    host: "127.0.0.1",
    turnApiToken: "test-token",
  };
  await withServer({
    config: server,
    audioStore,
    pipeline: {
      processTurn: async (input) => {
        calls.push(input);
        return { ...input, answer: "Test answer", audioUrl: "http://127.0.0.1/audio/test", playback: "disabled" };
      },
    },
  }, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "event-1", transcript: "hello" }),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/v1/turn`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "event-1", transcript: "  hello  " }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      eventId: "event-1",
      transcript: "hello",
      answer: "Test answer",
      audioUrl: "http://127.0.0.1/audio/test",
      playback: "disabled",
    });
    assert.deepEqual(calls, [{ eventId: "event-1", transcript: "hello" }]);

    const badRequest = await fetch(`${baseUrl}/v1/turn`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "", transcript: "hello" }),
    });
    assert.equal(badRequest.status, 400);

    const health = await fetch(`${baseUrl}/health`);
    assert.deepEqual(await health.json(), { status: "ok" });
  });
});

test("LAN-facing server requires an API token", () => {
  assert.throws(() => createServer({
    config: { host: "0.0.0.0" },
    audioStore: createAudioStore({ baseUrl: "http://127.0.0.1" }),
    pipeline: { processTurn: async () => ({}) },
  }), /TURN_API_TOKEN/);
});
