export interface PhoneIdResult {
  valid: boolean;
  normalized?: string;
}

const LOCAL_PATTERN = /^8\d{8,11}$/;

export function normalizePhoneId(raw: string): PhoneIdResult {
  const stripped = raw.replace(/[\s.-]/g, "");

  let local: string | undefined;
  if (stripped.startsWith("+62")) local = stripped.slice(3);
  else if (stripped.startsWith("62")) local = stripped.slice(2);
  else if (stripped.startsWith("0")) local = stripped.slice(1);

  if (!local || !LOCAL_PATTERN.test(local)) return { valid: false };

  return { valid: true, normalized: `+62${local}` };
}
