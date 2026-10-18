import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { createAudioStore } from "../src/audio-store.js";
import { createChatResponder } from "../src/providers/ollama.js";
import { createPiperSynthesizer } from "../src/providers/piper.js";
import { createPipeline } from "../src/pipeline.js";
import { createServer } from "../src/server.js";

async function startServer(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function stopServer(server) {
  server.close();
  await once(server, "close");
}

test("POC turns a transcript into a model answer and a retrievable WAV", async () => {
  const wav = Buffer.from("RIFF....WAVE-poc-audio");
  let receivedPrompt;
  const modelServer = createHttpServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    receivedPrompt = JSON.parse(body).messages.at(-1).content;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "The sky looks blue because air scatters blue light." } }] }));
  });
  const piperServer = createHttpServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.equal(JSON.parse(body).text, "The sky looks blue because air scatters blue light.");
    response.writeHead(200, { "content-type": "audio/wav" });
    response.end(wav);
  });
  const modelUrl = await startServer(modelServer);
  const piperUrl = await startServer(piperServer);
  let bridge;
  const audioStore = createAudioStore({
    baseUrl: () => `http://127.0.0.1:${bridge.address().port}`,
  });
  const pipeline = createPipeline({
    respond: createChatResponder({ baseUrl: `${modelUrl}/v1`, model: "test-model" }),
    synthesize: createPiperSynthesizer({ url: `${piperUrl}/synthesize` }),
    audioStore,
  });
  bridge = createServer({
    config: { host: "127.0.0.1" },
    pipeline,
    audioStore,
  });
  try {
    const baseUrl = await startServer(bridge);
    const turnResponse = await fetch(`${baseUrl}/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "poc-1", transcript: "Why is the sky blue?" }),
    });
    assert.equal(turnResponse.status, 200);
    const turn = await turnResponse.json();
    assert.equal(receivedPrompt, "Why is the sky blue?");
    assert.equal(turn.playback, "disabled");
    assert.match(turn.audioUrl, new RegExp(`^${baseUrl}/audio/`));

    const audioResponse = await fetch(turn.audioUrl);
    assert.equal(audioResponse.status, 200);
    assert.equal(audioResponse.headers.get("content-type"), "audio/wav");
    assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), wav);
  } finally {
    await stopServer(bridge);
    await stopServer(modelServer);
    await stopServer(piperServer);
  }
});
