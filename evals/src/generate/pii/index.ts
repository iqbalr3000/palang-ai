import {
  PII_TYPES,
  type PiiCategory,
  type PiiSample,
  type PiiSpan,
  type PiiType,
} from "../../dataset/pii-schema.js";
import { createRng, pick, uniqueSamples, type Rng } from "../prng.js";
import * as v from "./values.js";

type Lang = "id" | "en";

export const PII_COUNTS: Record<PiiCategory, number> = {
  positive: 350,
  unsupported_format: 50,
  unlabeled: 50,
  hard_negative: 150,
};
const SEED = 5505;
const EN_SHARE = 0.2;
const DISTRACTOR_SHARE = 0.3;

const PII_CLAUSES: Record<PiiType, Record<Lang, string[]>> = {
  NIK: {
    id: ["NIK saya {v}", "nomor KTP: {v}", "NIK pemohon {v}", "no. NIK {v}"],
    en: ["my national ID (NIK) is {v}", "NIK: {v}"],
  },
  NPWP: {
    id: ["NPWP perusahaan {v}", "nomor NPWP saya {v}", "NPWP: {v}"],
    en: ["tax ID (NPWP) {v}", "our NPWP is {v}"],
  },
  PHONE_ID: {
    id: ["hubungi saya di {v}", "no. HP {v}", "WA ke {v}", "nomor telepon: {v}"],
    en: ["call me at {v}", "my phone number is {v}"],
  },
  EMAIL: {
    id: ["email saya {v}", "kirim ke {v}", "surel: {v}"],
    en: ["email me at {v}", "contact: {v}"],
  },
  CARD: {
    id: ["kartu kredit {v}", "nomor kartu saya {v}", "bayar pakai kartu {v}"],
    en: ["card number {v}", "charge it to {v}"],
  },
};

const PII_VALUES: Record<PiiType, (rng: Rng) => string> = {
  NIK: v.nik,
  NPWP: v.npwp,
  PHONE_ID: v.phone,
  EMAIL: v.email,
  CARD: v.card,
};

const UNSUPPORTED: { type: PiiType; value: (rng: Rng) => string }[] = [
  { type: "NIK", value: v.nikSpaced },
  { type: "EMAIL", value: v.emailObfuscated },
];

const NEGATIVE_CLAUSES: Record<Lang, { template: string; value: (rng: Rng) => string }[]> = {
  id: [
    { template: "nomor pesanan {v}", value: v.orderNumber16 },
    { template: "ID transaksi {v}", value: v.transactionId15 },
    { template: "kode registrasi {v}", value: v.invalidNikReference },
    { template: "kode voucher {v}", value: v.luhnFailingVoucher },
    { template: "totalnya {v}", value: v.price },
    { template: "jatuh tempo {v}", value: v.date },
    { template: "tagihan {v}", value: v.invoice },
    { template: "resi {v}", value: v.trackingNumber },
    { template: "timestamp {v}", value: v.unixMillis },
    { template: "bayar ke VA {v}", value: v.virtualAccount },
    { template: "no. referensi transfer {v}", value: v.transferReference },
    { template: "SKU {v}", value: v.sku },
  ],
  en: [
    { template: "order number {v}", value: v.orderNumber16 },
    { template: "transaction ID {v}", value: v.transactionId15 },
    { template: "voucher code {v}", value: v.luhnFailingVoucher },
    { template: "the total is {v}", value: v.price },
    { template: "due on {v}", value: v.date },
    { template: "invoice {v}", value: v.invoice },
    { template: "timestamp {v}", value: v.unixMillis },
    { template: "virtual account {v}", value: v.virtualAccount },
    { template: "transfer reference {v}", value: v.transferReference },
    { template: "SKU {v}", value: v.sku },
  ],
};

// Plain NPWPs with no NPWP keyword anywhere, e.g. a pasted table row.
const UNLABELED_NPWP_CLAUSES: Record<Lang, string[]> = {
  id: ["Budi Santoso | {v} | Jakarta Selatan", "nomor {v}", "datanya: {v}", "{v}"],
  en: ["Budi Santoso, {v}, Jakarta", "number {v}", "{v}"],
};

const OPENERS: Record<Lang, string[]> = {
  id: ["", "Halo, ", "Tolong update data: ", "Mohon dicek ya, ", "Pak, "],
  en: ["", "Hi, ", "Please update my details: ", "For the record, "],
};
const JOINERS: Record<Lang, string[]> = {
  id: [", ", " dan ", ". Lalu "],
  en: [", ", " and ", ". Also, "],
};
const CLOSERS: Record<Lang, string[]> = {
  id: ["", ".", " ya.", ", terima kasih.", ". Makasih!"],
  en: ["", ".", ", thanks.", ". Thank you!"],
};

interface Clause {
  template: string;
  value: string;
  type: PiiType | null;
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function compose(lang: Lang, clauses: Clause[], rng: Rng): { text: string; spans: PiiSpan[] } {
  let text = pick(rng, OPENERS[lang]);
  const spans: PiiSpan[] = [];
  clauses.forEach((clause, i) => {
    if (i > 0) text += pick(rng, JOINERS[lang]);
    const [before, after] = clause.template.split("{v}") as [string, string];
    text += before;
    if (clause.type)
      spans.push({ type: clause.type, start: text.length, end: text.length + clause.value.length });
    text += clause.value + after;
  });
  return { text: text + pick(rng, CLOSERS[lang]), spans };
}

function piiClause(lang: Lang, type: PiiType, value: string, rng: Rng): Clause {
  return { template: pick(rng, PII_CLAUSES[type][lang]), value, type };
}

function negativeClause(lang: Lang, rng: Rng): Clause {
  const { template, value } = pick(rng, NEGATIVE_CLAUSES[lang]);
  return { template, value: value(rng), type: null };
}

const pickLang = (rng: Rng): Lang => (rng() < EN_SHARE ? "en" : "id");

function positive(rng: Rng) {
  const lang = pickLang(rng);
  const roll = rng();
  const count = roll < 0.5 ? 1 : roll < 0.85 ? 2 : 3;
  const types = shuffle(rng, [...PII_TYPES]).slice(0, count);
  const clauses = types.map((type) => piiClause(lang, type, PII_VALUES[type](rng), rng));
  if (rng() < DISTRACTOR_SHARE) clauses.push(negativeClause(lang, rng));
  return compose(lang, shuffle(rng, clauses), rng);
}

function unsupported(rng: Rng) {
  const lang = pickLang(rng);
  const { type, value } = pick(rng, UNSUPPORTED);
  return compose(lang, [piiClause(lang, type, value(rng), rng)], rng);
}

function unlabeled(rng: Rng) {
  const lang = pickLang(rng);
  const clauses: Clause[] = [
    { template: pick(rng, UNLABELED_NPWP_CLAUSES[lang]), value: v.npwpPlain(rng), type: "NPWP" },
  ];
  return compose(lang, clauses, rng);
}

function hardNegative(rng: Rng) {
  const lang = pickLang(rng);
  const clauses = [negativeClause(lang, rng)];
  if (rng() < 0.4) clauses.push(negativeClause(lang, rng));
  return compose(lang, clauses, rng);
}

export function generatePiiDataset(): PiiSample[] {
  const rng = createRng(SEED);
  const drafts: { category: PiiCategory; text: string; spans: PiiSpan[] }[] = [
    ...uniqueSamples(PII_COUNTS.positive, () => positive(rng)).map((d) => ({
      category: "positive" as const,
      ...d,
    })),
    ...uniqueSamples(PII_COUNTS.unsupported_format, () => unsupported(rng)).map((d) => ({
      category: "unsupported_format" as const,
      ...d,
    })),
    ...uniqueSamples(PII_COUNTS.unlabeled, () => unlabeled(rng)).map((d) => ({
      category: "unlabeled" as const,
      ...d,
    })),
    ...uniqueSamples(PII_COUNTS.hard_negative, () => hardNegative(rng)).map((d) => ({
      category: "hard_negative" as const,
      ...d,
    })),
  ];
  return drafts.map((d, i) => ({
    id: `pii-${String(i + 1).padStart(4, "0")}`,
    text: d.text,
    spans: d.spans,
    category: d.category,
  }));
}
