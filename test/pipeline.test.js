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
