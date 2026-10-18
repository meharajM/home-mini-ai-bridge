import test from "node:test";
import assert from "node:assert/strict";
import { createAudioStore } from "../src/audio-store.js";

test("audio URLs require an unguessable token and expire", async () => {
  const store = createAudioStore({ baseUrl: "http://127.0.0.1:8787", ttlMs: 10 });
  const audio = Buffer.from("RIFF-test");
  const published = store.publish(audio);
  const url = new URL(published.url);
  const id = url.pathname.split("/").at(-1);
  assert.deepEqual(store.get(id, url.searchParams.get("token")), audio);
  assert.equal(store.get(id, "wrong-token"), undefined);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(store.get(id, url.searchParams.get("token")), undefined);
});

test("audio store evicts oldest entries to stay within item and byte caps", () => {
  const store = createAudioStore({ baseUrl: "http://127.0.0.1", maxItems: 3, maxBytes: 7 });
  const first = store.publish(Buffer.from("1234"));
  const second = store.publish(Buffer.from("567"));
  const third = store.publish(Buffer.from("8901"));
  const firstUrl = new URL(first.url);
  const secondUrl = new URL(second.url);
  const thirdUrl = new URL(third.url);

  assert.equal(store.get(firstUrl.pathname.split("/").at(-1), firstUrl.searchParams.get("token")), undefined);
  assert.deepEqual(store.get(secondUrl.pathname.split("/").at(-1), secondUrl.searchParams.get("token")), Buffer.from("567"));
  assert.deepEqual(store.get(thirdUrl.pathname.split("/").at(-1), thirdUrl.searchParams.get("token")), Buffer.from("8901"));
  assert.throws(() => store.publish(Buffer.alloc(8)), /store limit/);
});
