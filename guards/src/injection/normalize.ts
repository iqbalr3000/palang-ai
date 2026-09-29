const INVISIBLE_CHARS = /\p{Cf}/gu;
const BASE64_SEGMENT = /[A-Za-z0-9+/]{24,}={0,2}/g;
const NON_TEXT_CONTROL = /(?![\n\r\t])\p{Cc}/u;

function decodeBase64Segment(segment: string): string | null {
  const unpadded = segment.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return null;

  let binary: string;
  try {
    binary = atob(unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "="));
  } catch {
    return null;
  }

  let text: string;
  try {
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return NON_TEXT_CONTROL.test(text) ? null : text;
}

function toScanForm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeForInjectionScan(text: string): string[] {
  // Base64 is case-sensitive: extract segments before lowercasing.
  const cleaned = text.normalize("NFKC").replace(INVISIBLE_CHARS, "");
  const targets = [toScanForm(cleaned)];

  for (const [segment] of cleaned.matchAll(BASE64_SEGMENT)) {
    const decoded = decodeBase64Segment(segment);
    if (decoded !== null) targets.push(toScanForm(decoded));
  }
  return targets;
}
