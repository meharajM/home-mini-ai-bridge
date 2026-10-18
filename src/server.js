import { createServer as createHttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { RequestError } from "./errors.js";

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
    if (size > BODY_LIMIT) throw new RequestError(413, "Request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Request body must be valid JSON");
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createServer({ config, pipeline, audioStore }) {
  if (config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1" && (typeof config.turnApiToken !== "string" || config.turnApiToken.length < 32
      || /\s/.test(config.turnApiToken) || new Set(config.turnApiToken).size < 8)) {
    throw new Error("A strong TURN_API_TOKEN (32+ characters, 8+ distinct, no whitespace) is required when HOST is exposed beyond loopback");
  }

  return createHttpServer(async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); }
    catch { return sendJson(response, 400, { error: "Invalid request URL" }); }

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
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
        throw new RequestError(415, "Content-Type must be application/json");
      }
      const input = await readJson(request);
      if (!input || Array.isArray(input) || typeof input !== "object" || typeof input.eventId !== "string" || !input.eventId.trim() || input.eventId.length > 200) {
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
      if (error instanceof RequestError) {
        if (error.status === 429) response.setHeader("retry-after", "1");
        return sendJson(response, error.status, { error: error.message });
      }
      return sendJson(response, 502, { error: "Turn failed" });
    }
  });
}
