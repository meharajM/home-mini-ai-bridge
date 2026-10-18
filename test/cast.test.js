import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCastPlayer } from "../src/cast.js";

function fakeSpawner({ code = 0 } = {}) {
  let invocation;
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit("close", code, null));
    return child;
  };
  return { spawnProcess, get invocation() { return invocation; } };
}

test("Cast adapter passes the generated audio URL to the isolated PyChromecast helper", async () => {
  const fake = fakeSpawner();
  const play = createCastPlayer({
    ip: "192.168.1.20",
    pythonCommand: "python-test",
    scriptPath: "/test/cast_audio.py",
    spawnProcess: fake.spawnProcess,
  });

  await play("http://192.168.1.5:8787/audio/test?token=abc");
  assert.deepEqual(fake.invocation, {
    command: "python-test",
    args: ["/test/cast_audio.py", "192.168.1.20", "http://192.168.1.5:8787/audio/test?token=abc"],
    options: { stdio: ["ignore", "ignore", "pipe"] },
  });
});

test("Cast adapter rejects unsafe URLs and reports helper failures", async () => {
  const fake = fakeSpawner({ code: 1 });
  const play = createCastPlayer({ ip: "192.168.1.20", spawnProcess: fake.spawnProcess });
  await assert.rejects(play("file:///tmp/audio.wav"), /absolute HTTP URL/);
  await assert.rejects(play("http://speaker:secret@example.test/audio.wav"), /without credentials/);
  await assert.rejects(play("http://192.168.1.5/audio.wav"), /exited 1/);
  assert.throws(() => createCastPlayer({ ip: "speaker.local" }), /must be an IP address/);
});
