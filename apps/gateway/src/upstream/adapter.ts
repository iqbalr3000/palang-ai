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
    signal,
  });
}
