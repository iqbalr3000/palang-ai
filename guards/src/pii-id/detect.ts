import { validateNik } from "./validators/nik.js";
import { validateNpwp } from "./validators/npwp.js";
import { normalizePhoneId } from "./validators/phone-id.js";
import { validateEmail } from "./validators/email.js";
import { validateCard } from "./validators/card.js";
import type { PiiEntityType, PiiMatch } from "./types.js";

interface Candidate {
  type: PiiEntityType;
  start: number;
  end: number;
  value: string;
}

// No space separators: too many false positives across unrelated numbers in prose. An
// individual's 16-digit NPWP is their NIK, so it's typed as one.
const NIK_CANDIDATE = /\b(?:\d[.-]?){15}\d\b/g;
const NPWP_FORMATTED = /\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g;
// Plain 15 digits (or 16 with the company "0" prefix) are too common in IDs to accept unlabeled.
const NPWP_PLAIN = /\b0?\d{15}\b/g;
const NPWP_KEYWORD = /npwp|n\.p\.w\.p|nomor pokok wajib pajak|tax[ _-]?(?:id|number)|taxpayer/i;
const NPWP_KEYWORD_WINDOW = 40;
// Lookarounds instead of `\b` (which rejects "+62"): a phone must not be read out of a longer
// digit run ("5200 8283 9981 7031") or an email's local part.
const PHONE_CANDIDATE =
  /(?<!\d[\s.-]?)(?:\+62|62|0)[\s.-]?8(?:[\s.-]?\d){8,11}(?!\d)(?!\S{0,64}@)/g;
// "(0812) 3456-7890", "+62 (812) 3456 7890"; total length is checked by normalizePhoneId. The
// "not after a digit" check is done in code: a leading lookbehind runs at every position (~40x slower).
const PHONE_PAREN_CANDIDATE =
  /(?:(?:\+62|62)[\s.-]?\(8\d{2,3}\)|\(08\d{2,3}\))(?:[\s.-]?\d){5,9}(?!\d)(?!\S{0,64}@)/g;
const AFTER_DIGIT = /\d[\s.-]?$/;
// Bounded, with a lookbehind, to stay linear on long runs without "@".
const EMAIL_CANDIDATE =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g;
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

function hasNpwpKeyword(text: string, start: number): boolean {
  return NPWP_KEYWORD.test(text.slice(Math.max(0, start - NPWP_KEYWORD_WINDOW), start));
}

function findCandidates(text: string, type: PiiEntityType, pattern: RegExp): Candidate[] {
  const candidates: Candidate[] = [];
  for (const m of text.matchAll(pattern)) {
    if (m.index === undefined) continue;
    candidates.push({ type, start: m.index, end: m.index + m[0].length, value: m[0] });
  }
  return candidates;
}

// Most specific type first: a real NIK also passes as a CARD.
export function detectPii(text: string): PiiMatch[] {
  const accepted: PiiMatch[] = [];
  const claimed = new Uint8Array(text.length);

  function tryAccept(candidate: Candidate, normalized: string): void {
    for (let i = candidate.start; i < candidate.end; i++) if (claimed[i]) return;
    claimed.fill(1, candidate.start, candidate.end);
    accepted.push({
      type: candidate.type,
      start: candidate.start,
      end: candidate.end,
      value: candidate.value,
      normalized,
    });
  }

  for (const c of findCandidates(text, "NIK", NIK_CANDIDATE)) {
    const digits = c.value.replace(/[.-]/g, "");
    if (validateNik(digits)) tryAccept(c, digits);
  }

  for (const c of findCandidates(text, "NPWP", NPWP_FORMATTED)) {
    tryAccept(c, c.value.replace(/[.-]/g, ""));
  }
  for (const c of findCandidates(text, "NPWP", NPWP_PLAIN)) {
    if (validateNpwp(c.value) && hasNpwpKeyword(text, c.start)) tryAccept(c, c.value);
  }

  const phoneCandidates = [
    ...findCandidates(text, "PHONE_ID", PHONE_CANDIDATE),
    ...findCandidates(text, "PHONE_ID", PHONE_PAREN_CANDIDATE).filter(
      (c) => !AFTER_DIGIT.test(text.slice(Math.max(0, c.start - 2), c.start)),
    ),
  ];
  for (const c of phoneCandidates) {
    const result = normalizePhoneId(c.value);
    if (result.valid && result.normalized) tryAccept(c, result.normalized);
  }

  for (const c of findCandidates(text, "EMAIL", EMAIL_CANDIDATE)) {
    if (validateEmail(c.value)) tryAccept(c, c.value.toLowerCase());
  }

  for (const c of findCandidates(text, "CARD", CARD_CANDIDATE)) {
    const digits = c.value.replace(/[ -]/g, "");
    if (validateCard(digits)) tryAccept(c, digits);
  }

  return accepted.sort((a, b) => a.start - b.start);
}
