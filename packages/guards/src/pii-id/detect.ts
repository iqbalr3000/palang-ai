import { validateNik } from "./validators/nik.js";
import { validateNpwp15 } from "./validators/npwp.js";
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

// No spaces as separators — too easy to false-positive across unrelated numbers in prose. A
// 16-digit NPWP (post-2024) validates as a NIK below, so it's typed NIK, never NPWP.
const NIK_CANDIDATE = /\b(?:\d[.-]?){15}\d\b/g;
const NPWP15_FORMATTED = /\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g;
const NPWP15_PLAIN = /\b\d{15}\b/g;
// Trailing lookahead rejects a match immediately followed by "@" (no whitespace between) — without
// it, the digit-only pattern also matches the local part of an email like "0812345678@x.com" and,
// checked before EMAIL below, wins the overlap and swallows the whole address.
const PHONE_CANDIDATE = /(?:\+62|62|0)[\s.-]?8(?:[\s.-]?\d){8,11}(?!\S*@)/g;
// Restricted to actual email-safe characters (not "any non-whitespace") — a naive `[^\s@]+`
// swallows surrounding JSON punctuation (`{"email":"x@y.com"}`) as part of the match.
const EMAIL_CANDIDATE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 13-19 digits, optionally grouped with spaces/dashes (how card numbers are usually written).
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

function findCandidates(text: string, type: PiiEntityType, pattern: RegExp): Candidate[] {
  const candidates: Candidate[] = [];
  for (const m of text.matchAll(pattern)) {
    if (m.index === undefined) continue;
    candidates.push({ type, start: m.index, end: m.index + m[0].length, value: m[0] });
  }
  return candidates;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// Entity types are checked in priority order (NIK, NPWP, PHONE_ID, EMAIL, CARD) so a more
// specific, structurally validated type wins over a looser one matching the same digits — a real
// NIK is also a valid CARD pattern. Once a span is accepted, overlapping candidates are discarded.
export function detectPii(text: string): PiiMatch[] {
  const accepted: PiiMatch[] = [];

  function tryAccept(candidate: Candidate, normalized: string): void {
    if (accepted.some((a) => overlaps(a, candidate))) return;
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

  const npwpCandidates = [
    ...findCandidates(text, "NPWP", NPWP15_FORMATTED),
    ...findCandidates(text, "NPWP", NPWP15_PLAIN),
  ];
  for (const c of npwpCandidates) {
    const digits = c.value.replace(/[.-]/g, "");
    if (validateNpwp15(digits)) tryAccept(c, digits);
  }

  for (const c of findCandidates(text, "PHONE_ID", PHONE_CANDIDATE)) {
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
