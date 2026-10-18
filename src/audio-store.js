import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

function secretMatches(expected, actual) {
  if (typeof actual !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAudioStore({
  baseUrl,
  ttlMs = 10 * 60 * 1000,
  maxItems = 64,
  maxBytes = 64 * 1024 * 1024,
}) {
  const items = new Map();
  let storedBytes = 0;

  if (!Number.isInteger(maxItems) || maxItems < 1) throw new Error("maxItems must be a positive integer");
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive integer");

  function remove(id) {
    const item = items.get(id);
    if (item) storedBytes -= item.audio.length;
    items.delete(id);
  }

  function purgeExpired(now = Date.now()) {
    for (const [id, item] of items) {
      if (item.expiresAt <= now) remove(id);
    }
  }

  return {
    publish(audio) {
      if (!Buffer.isBuffer(audio) || audio.length === 0) {
        throw new TypeError("Audio must be a non-empty Buffer");
      }
      if (audio.length > maxBytes) throw new RangeError(`Audio exceeds the ${maxBytes}-byte store limit`);
      purgeExpired();
      while (items.size >= maxItems || storedBytes + audio.length > maxBytes) {
        remove(items.keys().next().value);
      }

      const id = randomUUID();
      const token = randomBytes(24).toString("base64url");
      const expiresAt = Date.now() + ttlMs;
      items.set(id, { audio, token, expiresAt });
      storedBytes += audio.length;
      const base = typeof baseUrl === "function" ? baseUrl() : baseUrl;
      const url = new URL(`/audio/${id}?token=${token}`, base).toString();
      return { id, url, expiresAt };
    },

    get(id, token) {
      purgeExpired();
      const item = items.get(id);
      if (!item || !secretMatches(item.token, token)) return undefined;
      return item.audio;
    },
  };
}
