export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export class UpstreamTimeoutError extends Error {}

/** The timeout covers the wait for response headers only; a long stream isn't cut off. */
export async function callUpstream(
  config: UpstreamConfig,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), config.timeoutMs);
  try {
    return await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeout.signal]),
    });
  } catch (error) {
    if (timeout.signal.aborted)
      throw new UpstreamTimeoutError(`upstream timed out after ${config.timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
