import { pick, type Rng } from "../prng.js";

// Real province prefixes, listed here rather than imported from the detector so the dataset
// doesn't inherit the detector's own assumptions.
// prettier-ignore
const PROVINCES = [
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "31", "32", "33", "34", "35", "36",
  "51", "52", "53", "61", "62", "63", "64", "65", "71", "72", "73", "74", "75", "76", "81", "82",
  "91", "94",
] as const;

// Public test BINs; Mastercard's 51–53 overlap NIK province codes on purpose (real-world clash).
const CARD_BINS = ["411111", "400000", "555555", "510510", "520082"] as const;
const MOBILE_PREFIXES = ["811", "812", "813", "821", "822", "852", "857", "878", "895", "896"];
const FIRST_NAMES = [
  "budi",
  "siti",
  "agus",
  "dewi",
  "rizky",
  "putri",
  "andi",
  "rina",
  "joko",
  "maya",
];
const LAST_NAMES = ["santoso", "wijaya", "lestari", "pratama", "hidayat", "kusuma", "saputra"];
const EMAIL_DOMAINS = ["example.com", "example.org"] as const;

export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function digits(rng: Rng, count: number): string {
  return Array.from({ length: count }, () => int(rng, 0, 9)).join("");
}

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

function group(value: string, sizes: number[], separator: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const size of sizes) {
    parts.push(value.slice(cursor, cursor + size));
    cursor += size;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts.filter((p) => p !== "").join(separator);
}

export function luhnValid(value: string): boolean {
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    let d = Number(value[value.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function luhnCheckDigit(partial: string): string {
  for (let d = 0; d <= 9; d++) {
    if (luhnValid(partial + d)) return String(d);
  }
  throw new Error("unreachable: some check digit always satisfies Luhn");
}

export function nik(rng: Rng): string {
  const day = int(rng, 1, 28) + (rng() < 0.5 ? 40 : 0);
  return (
    pick(rng, PROVINCES) +
    pad(int(rng, 1, 20), 2) +
    pad(int(rng, 1, 30), 2) +
    pad(day, 2) +
    pad(int(rng, 1, 12), 2) +
    pad(int(rng, 0, 99), 2) +
    pad(int(rng, 1, 999), 4)
  );
}

export function nikSpaced(rng: Rng): string {
  return group(nik(rng), [4, 4, 4, 4], " ");
}

export function npwp(rng: Rng): string {
  const value = pad(int(rng, 1, 99), 2) + digits(rng, 13);
  if (rng() < 0.4) return value;
  const [a, b, c, d, e, f] = [
    value.slice(0, 2),
    value.slice(2, 5),
    value.slice(5, 8),
    value.slice(8, 9),
    value.slice(9, 12),
    value.slice(12, 15),
  ];
  return `${a}.${b}.${c}.${d}-${e}.${f}`;
}

function mobileLocal(rng: Rng): string {
  return pick(rng, MOBILE_PREFIXES) + digits(rng, int(rng, 7, 8));
}

export function phone(rng: Rng): string {
  const local = mobileLocal(rng);
  const prefix = pick(rng, ["0", "+62", "62"] as const);
  const separator = pick(rng, ["", "-", " ", "."] as const);
  if (separator === "") return prefix + local;
  const grouped = group(local, [3, 4], separator);
  return prefix === "0" ? `0${grouped}` : `${prefix}${pick(rng, ["", " "])}${grouped}`;
}

export function phoneParenthesized(rng: Rng): string {
  const local = mobileLocal(rng);
  return rng() < 0.5
    ? `(0${local.slice(0, 3)}) ${group(local.slice(3), [4], "-")}`
    : `+62 (${local.slice(0, 3)}) ${group(local.slice(3), [4], " ")}`;
}

function emailLocal(rng: Rng): string {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  const suffix = rng() < 0.5 ? String(int(rng, 1, 99)) : "";
  return pick(rng, [`${first}.${last}${suffix}`, `${first}${suffix}`, `${first}_${last}`]);
}

export function email(rng: Rng): string {
  const local = emailLocal(rng);
  const cased = rng() < 0.2 ? local[0]!.toUpperCase() + local.slice(1) : local;
  return `${cased}@${pick(rng, EMAIL_DOMAINS)}`;
}

export function emailObfuscated(rng: Rng): string {
  return `${emailLocal(rng)} [at] ${pick(rng, EMAIL_DOMAINS)}`;
}

export function card(rng: Rng): string {
  const partial = pick(rng, CARD_BINS) + digits(rng, 9);
  const value = partial + luhnCheckDigit(partial);
  const style = rng();
  if (style < 0.3) return value;
  return group(value, [4, 4, 4, 4], style < 0.8 ? " " : "-");
}

// Non-PII numbers that share a shape with PII — what hard negatives are made of.

export function orderNumber16(rng: Rng): string {
  return String(int(rng, 1, 9)) + digits(rng, 15);
}

export function transactionId15(rng: Rng): string {
  return String(int(rng, 1, 9)) + digits(rng, 14);
}

export function invalidNikReference(rng: Rng): string {
  return pick(rng, ["00", "99", "45", "88"]) + digits(rng, 14);
}

export function luhnFailingVoucher(rng: Rng): string {
  let value = digits(rng, 16);
  while (luhnValid(value)) value = digits(rng, 16);
  return group(value, [4, 4, 4, 4], " ");
}

export function price(rng: Rng): string {
  // Formatted by hand: toLocaleString output depends on the runtime's ICU data.
  const thousands = String(int(rng, 10, 9_999) * 1_000).replace(/\B(?=(\d{3})+$)/g, ".");
  return `Rp${thousands}`;
}

export function date(rng: Rng): string {
  return `${pad(int(rng, 1, 28), 2)}-${pad(int(rng, 1, 12), 2)}-${int(rng, 2020, 2026)}`;
}

export function invoice(rng: Rng): string {
  return `INV/${int(rng, 2022, 2026)}/${pad(int(rng, 1, 12), 2)}/${digits(rng, 5)}`;
}

export function trackingNumber(rng: Rng): string {
  return pick(rng, ["JP", "JX", "TKP"]) + digits(rng, 10);
}
