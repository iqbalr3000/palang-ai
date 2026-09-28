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

// Logged-out session ids, until their token would have expired anyway. On globalThis because Next
// can load this module more than once per process (proxy, server components, actions). Lost on
// restart, when tokens still expire within SESSION_TTL_MS.
const revoked: Map<string, number> = ((
  globalThis as { __palangRevokedSessions?: Map<string, number> }
).__palangRevokedSessions ??= new Map());

/** `<expiresAtMs>.<id>.<base64url HMAC of "expiresAtMs.id">` */
export async function createSessionToken(adminToken: string, now = Date.now()): Promise<string> {
  const payload = `${now + SESSION_TTL_MS}.${toBase64Url(crypto.getRandomValues(new Uint8Array(16)).buffer)}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(adminToken),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(signature)}`;
}

interface ParsedToken {
  expiresAt: number;
  id: string;
}

async function parseVerified(token: string, adminToken: string): Promise<ParsedToken | null> {
  const [expiresAt, id, signature, ...rest] = token.split(".");
  if (!expiresAt || !id || !signature || rest.length > 0 || !/^\d+$/.test(expiresAt)) return null;
  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await sessionKey(adminToken),
    Buffer.from(signature, "base64url"),
    encoder.encode(`${expiresAt}.${id}`),
  );
  return valid ? { expiresAt: Number(expiresAt), id } : null;
}

export async function revokeSessionToken(token: string, adminToken: string): Promise<void> {
  const parsed = await parseVerified(token, adminToken);
  if (!parsed) return;
  const now = Date.now();
  for (const [id, expiresAt] of revoked) if (expiresAt <= now) revoked.delete(id);
  revoked.set(parsed.id, parsed.expiresAt);
}

export async function verifySessionToken(
  token: string,
  adminToken: string,
  now = Date.now(),
): Promise<boolean> {
  const parsed = await parseVerified(token, adminToken);
  return parsed !== null && parsed.expiresAt > now && !revoked.has(parsed.id);
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
