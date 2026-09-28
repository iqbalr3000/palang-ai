// Pure Web Crypto, so it runs in the proxy, Server Components, and tests alike.

export const SESSION_COOKIE = "palang_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("base64url");
}

// Derived from the admin token (high-entropy, already on the server) rather than the password,
// so a leaked cookie can't be brute-forced back to a weak password.
async function sessionKey(adminToken: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`palang-dashboard-session:${adminToken}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** `<expiresAtMs>.<base64url HMAC of expiresAtMs>` */
export async function createSessionToken(adminToken: string, now = Date.now()): Promise<string> {
  const expiresAt = String(now + SESSION_TTL_MS);
  const signature = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(adminToken),
    encoder.encode(expiresAt),
  );
  return `${expiresAt}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(
  token: string,
  adminToken: string,
  now = Date.now(),
): Promise<boolean> {
  const [expiresAt, signature, ...rest] = token.split(".");
  if (!expiresAt || !signature || rest.length > 0 || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) <= now) return false;
  // subtle.verify compares in constant time.
  return crypto.subtle.verify(
    "HMAC",
    await sessionKey(adminToken),
    Buffer.from(signature, "base64url"),
    encoder.encode(expiresAt),
  );
}

/** Constant-time: both sides are hashed to equal length and compared with HMAC verify. */
export async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const expectedMac = await crypto.subtle.sign("HMAC", key, encoder.encode(expected));
  return crypto.subtle.verify("HMAC", key, expectedMac, encoder.encode(candidate));
}
