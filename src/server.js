import { createServer as createHttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const BODY_LIMIT = 16 * 1024;
const TRANSCRIPT_LIMIT = 2000;

function matchesToken(expected, authorization) {
  if (!expected) return true;
  const prefix = "Bearer ";
  if (typeof authorization !== "string" || !authorization.startsWith(prefix)) return false;
  const actual = Buffer.from(authorization.slice(prefix.length));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createServer({ config, pipeline, audioStore }) {
  if (config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1" && !config.turnApiToken) {
    throw new Error("TURN_API_TOKEN is required when HOST is exposed beyond loopback");
  }

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { status: "ok" });
    }

    const audioMatch = request.method === "GET" && url.pathname.match(/^\/audio\/([a-f0-9-]+)$/i);
    if (audioMatch) {
      const audio = audioStore.get(audioMatch[1], url.searchParams.get("token"));
      if (!audio) return sendJson(response, 404, { error: "Audio not found or link expired" });
      response.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": audio.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      return response.end(audio);
    }

    if (request.method !== "POST" || url.pathname !== "/v1/turn") {
      return sendJson(response, 404, { error: "Not found" });
    }
    if (!matchesToken(config.turnApiToken, request.headers.authorization)) {
      return sendJson(response, 401, { error: "Unauthorized" });
    }

    try {
      const input = await readJson(request);
      if (!input || typeof input.eventId !== "string" || input.eventId.length < 1 || input.eventId.length > 200) {
        return sendJson(response, 400, { error: "eventId must be a string of 1–200 characters" });
      }
      if (typeof input.transcript !== "string" || !input.transcript.trim() || input.transcript.length > TRANSCRIPT_LIMIT) {
        return sendJson(response, 400, { error: `transcript must contain 1–${TRANSCRIPT_LIMIT} characters` });
      }
      const result = await pipeline.processTurn({
        eventId: input.eventId,
        transcript: input.transcript.trim(),
      });
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, error.status ?? 502, { error: error.message ?? "Turn failed" });
    }
  });
}
