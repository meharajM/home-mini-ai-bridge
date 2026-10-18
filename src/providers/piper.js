async function readLimited(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Piper returned an empty response body");

  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Piper audio exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export function createPiperSynthesizer({
  url,
  voice,
  fetchImpl = fetch,
  timeoutMs = 45_000,
  maxAudioBytes = 20 * 1024 * 1024,
}) {
  if (!url) throw new Error("PIPER_URL is required");
  const endpoint = new URL(url);
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("PIPER_URL must use HTTP or HTTPS");
  }

  return async (text) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
    });
    if (!response.ok) throw new Error(`Piper request failed with HTTP ${response.status}`);
    // Piper's Flask server labels its valid WAV byte response as text/html.
    const audio = await readLimited(response, maxAudioBytes);
    if (audio.length < 12 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Piper returned an invalid WAV file");
    }
    return audio;
  };
}
