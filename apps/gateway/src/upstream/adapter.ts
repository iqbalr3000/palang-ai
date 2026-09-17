// TSD §7.2: `UpstreamAdapter.chat()` returns a raw fetch `Response`. v0.1 implements only
// `openai-compatible` (OpenAI, OpenRouter, Groq, vLLM, Ollama, mock-upstream, etc. — anything
// speaking the same wire format at a configurable `base_url`).

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
}

export function callUpstream(
  config: UpstreamConfig,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal, // client disconnect aborts the upstream request (TSD §7.2)
  });
}
