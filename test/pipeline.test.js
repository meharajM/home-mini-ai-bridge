import test from "node:test";
import assert from "node:assert/strict";
import { createAudioStore } from "../src/audio-store.js";
import { createPipeline } from "../src/pipeline.js";

test("a repeated event is processed once and produces a protected audio URL", async () => {
  let modelCalls = 0;
  let ttsCalls = 0;
  let playCalls = 0;
  const audioStore = createAudioStore({ baseUrl: "http://127.0.0.1:8787" });
  const pipeline = createPipeline({
    respond: async (text) => {
      modelCalls += 1;
      assert.equal(text, "What time is it?");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "I cannot read the clock in this test.";
    },
    synthesize: async (text) => {
      ttsCalls += 1;
      assert.match(text, /clock/);
      return Buffer.from("RIFF-test-audio");
    },
    audioStore,
    castEnabled: true,
    playAudio: async (url) => {
      playCalls += 1;
      assert.match(url, /^http:\/\/127\.0\.0\.1:8787\/audio\//);
    },
  });

  const [first, duplicate] = await Promise.all([
    pipeline.processTurn({ eventId: "keep-note-1", transcript: "What time is it?" }),
    pipeline.processTurn({ eventId: "keep-note-1", transcript: "What time is it?" }),
  ]);

  assert.deepEqual(duplicate, first);
  assert.equal(first.playback, "cast");
  assert.equal(modelCalls, 1);
  assert.equal(ttsCalls, 1);
  assert.equal(playCalls, 1);
  const audioUrl = new URL(first.audioUrl);
  assert.ok(audioStore.get(audioUrl.pathname.split("/").at(-1), audioUrl.searchParams.get("token")));
});

test("casting stays disabled by default", async () => {
  let playCalls = 0;
  const pipeline = createPipeline({
    respond: async () => "Hello.",
    synthesize: async () => Buffer.from("RIFF-test-audio"),
    audioStore: createAudioStore({ baseUrl: "http://127.0.0.1:8787" }),
    playAudio: async () => { playCalls += 1; },
  });

  const result = await pipeline.processTurn({ eventId: "test-2", transcript: "Hi" });
  assert.equal(result.playback, "disabled");
  assert.equal(playCalls, 0);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function options(overrides = {}) {
  return {
    respond: async (text) => text,
    synthesize: async () => Buffer.from("RIFF-test-audio"),
    audioStore: createAudioStore({ baseUrl: "http://127.0.0.1" }),
    ...overrides,
  };
}

test("FIFO queue waits for playback, coalesces duplicates, and rejects overload without reserving it", async () => {
  const playing = deferred();
  const started = deferred();
  const order = [];
  const pipeline = createPipeline(options({
    maxWaiting: 1,
    castEnabled: true,
    respond: async (text) => { order.push(text); return text; },
    playAudio: async () => { started.resolve(); await playing.promise; },
  }));
  const first = pipeline.processTurn({ eventId: "one", transcript: "first" });
  await started.promise;
  const second = pipeline.processTurn({ eventId: "two", transcript: "second" });
  const duplicate = pipeline.processTurn({ eventId: "two", transcript: "second" });
  await assert.rejects(pipeline.processTurn({ eventId: "two", transcript: "changed" }), { status: 409 });
  await assert.rejects(pipeline.processTurn({ eventId: "three", transcript: "third" }), { status: 429 });
  assert.deepEqual(order, ["first"]);
  playing.resolve();
  await first;
  assert.deepEqual(await second, await duplicate);
  await pipeline.processTurn({ eventId: "three", transcript: "third" });
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("Cast failure blocks queued and future work without another playback", async () => {
  const playing = deferred();
  let playCalls = 0;
  const pipeline = createPipeline(options({
    castEnabled: true,
    playAudio: async () => { playCalls += 1; await playing.promise; throw new Error("secret device detail"); },
  }));
  const first = pipeline.processTurn({ eventId: "one", transcript: "first" });
  const second = pipeline.processTurn({ eventId: "two", transcript: "second" });
  const rejected = Promise.all([
    assert.rejects(first, { status: 503 }),
    assert.rejects(second, { status: 503 }),
  ]);
  playing.resolve();
  await rejected;
  await assert.rejects(pipeline.processTurn({ eventId: "three", transcript: "third" }), { status: 503 });
  assert.equal(playCalls, 1);
});

test("failed provider attempt is handled once and does not stall later turns", async () => {
  const pipeline = createPipeline(options({ respond: async (text) => {
    if (text === "fail") throw new Error("upstream failed");
    return text;
  } }));
  await assert.rejects(pipeline.processTurn({ eventId: "fail", transcript: "fail" }));
  assert.equal((await pipeline.processTurn({ eventId: "fail", transcript: "fail" })).status, "already_handled");
  assert.equal((await pipeline.processTurn({ eventId: "ok", transcript: "ok" })).playback, "disabled");
});
