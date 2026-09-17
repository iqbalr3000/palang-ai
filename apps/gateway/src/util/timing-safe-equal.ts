// Constant-time string compare (TSD §10.2) — used wherever a secret is compared directly in
// application code (the admin token has no DB-mediated lookup to do this for it, unlike API keys
// — see auth/middleware.ts's comment on that).
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }
  return diff === 0;
}
