function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export interface GeneratedApiKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

export async function generateApiKey(env: string): Promise<GeneratedApiKey> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = `plg_${env}_${toHex(randomBytes)}`;
  return { plaintext, prefix: plaintext.slice(0, 12), hash: await sha256Hex(plaintext) };
}
