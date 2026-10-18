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

test("LAN token policy rejects weak secrets and authenticates valid secrets", async () => {
  const token = "B4GxAOVKxjH56ltKjR_y4APf0WHgFfs7B0RhYUzVNF0";
  const options = { config: { host: "0.0.0.0", turnApiToken: token },
    audioStore: createAudioStore({ baseUrl: "http://127.0.0.1" }),
    pipeline: { processTurn: async () => ({ playback: "disabled" }) } };
  for (const weak of [undefined, "short", "a".repeat(64), "space ".repeat(8)]) {
    assert.throws(() => createServer({ ...options, config: { ...options.config, turnApiToken: weak } }), /strong TURN_API_TOKEN/);
  }
  await withServer(options, async (baseUrl) => {
    for (const authorization of [undefined, "Bearer wrong", `Basic ${token}`, `Bearer ${token}wrong`, `Bearer ${token}`]) {
      const response = await fetch(`${baseUrl}/v1/turn`, { method: "POST",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify({ eventId: "auth", transcript: "test" }) });
      assert.equal(response.status, authorization === `Bearer ${token}` ? 200 : 401);
    }
  });
});

test("invalid JSON/shape/content type and oversized bodies get safe client errors", async () => {
  await withServer({ config: { host: "127.0.0.1" },
    audioStore: createAudioStore({ baseUrl: "http://127.0.0.1" }),
    pipeline: { processTurn: async () => assert.fail("invalid input reached pipeline") },
  }, async (baseUrl) => {
    for (const [body, type, status] of [
      ["{", "application/json", 400], ["null", "application/json", 400],
      ["[]", "application/json", 400], ["[]", "text/plain", 415],
      [JSON.stringify({ eventId: " ", transcript: "ok" }), "application/json", 400],
      [JSON.stringify({ eventId: "ok", transcript: " ".repeat(10) }), "application/json", 400],
      [JSON.stringify({ eventId: "ok", transcript: "a".repeat(2001) }), "application/json", 400],
      [" ".repeat(17 * 1024), "application/json", 413],
    ]) {
      const response = await fetch(`${baseUrl}/v1/turn`, { method: "POST", headers: { "content-type": type }, body });
      assert.equal(response.status, status);
      assert.equal(typeof (await response.json()).error, "string");
    }
  });
});

test("unknown provider errors cannot expose secrets or claim an HTTP status", async () => {
  await withServer({ config: { host: "127.0.0.1" },
    audioStore: createAudioStore({ baseUrl: "http://127.0.0.1" }),
    pipeline: { processTurn: async () => { throw Object.assign(new Error("secret transcript/api key/url"), { status: 400 }); } },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/turn`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "ok", transcript: "ok" }) });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Turn failed" });
  });
});
