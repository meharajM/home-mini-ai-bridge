import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createEventStore, hash } from "../src/event-store.js";
import { createPipeline } from "../src/pipeline.js";

function temporary(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "bridge-events-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

function pipeline(dataDir) {
  return createPipeline({
    eventStore: createEventStore({ dataDir }),
    respond: async () => "private model answer",
    synthesize: async () => Buffer.from("private audio"),
    audioStore: { publish: () => ({ url: "http://private-url?token=secret" }) },
  });
}

test("completed events survive process restart; disk contains only hashes/status/timestamps", async (t) => {
  const dataDir = temporary(t);
  const input = { eventId: "private event id", transcript: "private recognized text" };
  await pipeline(dataDir).processTurn(input);
  const files = readdirSync(dataDir);
  assert.deepEqual(files, [`${hash(input.eventId)}.json`]);
  const record = JSON.parse(readFileSync(join(dataDir, files[0]), "utf8"));
  assert.deepEqual(Object.keys(record).sort(), ["createdAt", "eventHash", "status", "transcriptHash", "updatedAt"]);
  assert.equal(record.transcriptHash, hash(input.transcript));
  assert.equal(record.status, "completed");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { createPipeline } from './src/pipeline.js';
    import { createEventStore } from './src/event-store.js';
    const pipeline = createPipeline({ eventStore: createEventStore({ dataDir: process.argv[1] }),
      respond: () => { throw new Error('must not replay'); } });
    console.log(JSON.stringify(await pipeline.processTurn(JSON.parse(process.argv[2]))));
  `, dataDir, JSON.stringify(input)], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { eventId: input.eventId, status: "already_handled", playback: "skipped" });
  await assert.rejects(pipeline(dataDir).processTurn({ ...input, transcript: "different" }), { status: 409 });
});

test("interrupted and failed reservations prevent replay after restart", async (t) => {
  const dataDir = temporary(t);
  const store = createEventStore({ dataDir });
  for (const status of ["pending", "failed"]) {
    store.set({ eventHash: hash(status), transcriptHash: hash("text"), status, createdAt: 1, updatedAt: 1 });
    assert.equal((await pipeline(dataDir).processTurn({ eventId: status, transcript: "text" })).status, "already_handled");
  }
});

test("corrupt/unwritable metadata fails closed before model work", async (t) => {
  const dataDir = temporary(t);
  writeFileSync(join(dataDir, `${hash("bad")}.json`), "{}");
  await assert.rejects(pipeline(dataDir).processTurn({ eventId: "bad", transcript: "text" }), /metadata/);
  let calls = 0;
  const bridge = createPipeline({ eventStore: { get: () => undefined, set: () => { throw new Error("disk full"); } },
    respond: () => { calls += 1; } });
  await assert.rejects(bridge.processTurn({ eventId: "bad", transcript: "text" }), /disk full/);
  assert.equal(calls, 0);
});


test("empty data directory cannot silently disable persistence", () => {
  assert.throws(() => createEventStore({ dataDir: "" }), /non-empty path/);
});

test("process interrupted during model work retains its reservation", async (t) => {
  const dataDir = temporary(t);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { createPipeline } from './src/pipeline.js';
    import { createEventStore } from './src/event-store.js';
    await createPipeline({ eventStore: createEventStore({ dataDir: process.argv[1] }),
      respond: () => process.exit(0) }).processTurn({ eventId: 'crash', transcript: 'text' });
  `, dataDir], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(createEventStore({ dataDir }).get(hash("crash")).status, "pending");
  assert.equal((await pipeline(dataDir).processTurn({ eventId: "crash", transcript: "text" })).status, "already_handled");
});
