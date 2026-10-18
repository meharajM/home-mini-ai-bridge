export function createChatResponder({
  baseUrl,
  model,
  apiKey,
  systemPrompt,
  fetchImpl = fetch,
  timeoutMs = 120_000,
  maxAnswerChars = 2000,
}) {
  if (!baseUrl || !model) throw new Error("LLM_BASE_URL and LLM_MODEL are required");
  const endpoint = new URL("chat/completions", `${baseUrl.replace(/\/$/, "")}/`);
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("LLM_BASE_URL must use HTTP or HTTPS");
  }

  return async (transcript) => {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
      }),
    });
    if (!response.ok) throw new Error(`LLM request failed with HTTP ${response.status}`);
    const payload = await response.json();
    const answer = payload?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("LLM returned no answer text");
    }
    return answer.trim().slice(0, maxAnswerChars);
  };
}
