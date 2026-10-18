import { createAudioStore } from "./audio-store.js";
import { createCastPlayer } from "./cast.js";
import { createPipeline } from "./pipeline.js";
import { createChatResponder } from "./providers/ollama.js";
import { createPiperSynthesizer } from "./providers/piper.js";
import { createServer } from "./server.js";

const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? "127.0.0.1";
const castEnabled = env.CAST_ENABLED === "true";
const publicBaseUrl = env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
const turnApiToken = env.TURN_API_TOKEN || undefined;

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
if (castEnabled && !env.CAST_DEVICE_IP) throw new Error("CAST_DEVICE_IP is required when CAST_ENABLED=true");

const audioStore = createAudioStore({ baseUrl: publicBaseUrl });
const pipeline = createPipeline({
  respond: createChatResponder({
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    systemPrompt: env.LLM_SYSTEM_PROMPT ?? "Answer conversationally in no more than two concise spoken sentences.",
  }),
  synthesize: createPiperSynthesizer({ url: env.PIPER_URL, voice: env.PIPER_VOICE }),
  audioStore,
  castEnabled,
  playAudio: castEnabled ? createCastPlayer({
    ip: env.CAST_DEVICE_IP,
    pythonCommand: env.PYCHROMECAST_PYTHON ?? "python3",
  }) : undefined,
});

const server = createServer({ config: { host, turnApiToken }, pipeline, audioStore });
server.listen(port, host, () => {
  process.stdout.write(`Home Mini AI bridge listening on http://${host}:${port}; Cast ${castEnabled ? "enabled" : "disabled"}.\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
