import { test, expect } from "bun:test";
import { detectPii } from "./detect.js";

test("detects a plain NIK in a sentence", () => {
  const text = "NIK saya 3171011506900001 ya";
  const matches = detectPii(text);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ type: "NIK", value: "3171011506900001" });
  expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe("3171011506900001");
});

test("detects an NPWP-formatted 15-digit number", () => {
  const text = "NPWP: 12.345.678.9-012.345";
  const matches = detectPii(text);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ type: "NPWP", normalized: "123456789012345" });
});

test("a valid 16-digit value is typed NIK, not NPWP (post-2024: individual NPWP = NIK)", () => {
  const text = "npwp baru saya samain sama nik: 3171011506900001";
  const matches = detectPii(text);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.type).toBe("NIK");
});

test("detects an Indonesian phone number with dashes and normalizes it", () => {
  const text = "hubungi saya di 0812-3456-7890 sore ini";
  const matches = detectPii(text);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ type: "PHONE_ID", normalized: "+6281234567890" });
});

test("detects an email address", () => {
  const text = "kirim ke budi.santoso@example.com terima kasih";
  const matches = detectPii(text);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ type: "EMAIL", value: "budi.santoso@example.com" });
});

test("detects a Luhn-valid card number and does not flag a random 16-digit non-card number", () => {
  const text = "kartu saya 4111111111111111 tapi ini bukan kartu 1234567890123450";
  const matches = detectPii(text);
  const cardMatches = matches.filter((m) => m.type === "CARD");
  expect(cardMatches).toHaveLength(1);
  expect(cardMatches[0]!.normalized).toBe("4111111111111111");
});

test("does not flag a plausible-looking but structurally invalid NIK", () => {
  // province 00 is not a real province code
  const text = "nomor acak 0071011506900001 doang";
  const matches = detectPii(text);
  expect(matches.find((m) => m.type === "NIK")).toBeUndefined();
});

test("multiple distinct entities in one message, each found once", () => {
  const text = "NIK: 3171011506900001, email: budi@example.com, telp: 081234567890";
  const matches = detectPii(text);
  const types = matches.map((m) => m.type).sort();
  expect(types).toEqual(["EMAIL", "NIK", "PHONE_ID"]);
});

test("plain text with no PII yields no matches", () => {
  expect(detectPii("Halo, apa kabar? Semoga harimu menyenangkan.")).toHaveLength(0);
});

test("matches are returned in left-to-right order", () => {
  const text = "081234567890 lalu budi@example.com";
  const matches = detectPii(text);
  expect(matches.map((m) => m.type)).toEqual(["PHONE_ID", "EMAIL"]);
  expect(matches[0]!.start).toBeLessThan(matches[1]!.start);
});

test("a space-grouped card is a CARD, not a phone found inside it", () => {
  const matches = detectPii("kartu 5200 8283 9981 7031 ya");
  expect(matches.map((m) => m.type)).toEqual(["CARD"]);
});

test("no phone is read from the middle or start of a longer digit run", () => {
  expect(detectPii("pesanan 6081870179141044").filter((m) => m.type === "PHONE_ID")).toEqual([]);
  expect(detectPii("resi 0812345678901234567").filter((m) => m.type === "PHONE_ID")).toEqual([]);
  expect(detectPii("voucher 7953 0806 4480 8778").filter((m) => m.type === "PHONE_ID")).toEqual([]);
});

test("phones right after punctuation or with a +62 prefix are still found", () => {
  const matches = detectPii("HP:081234567890, WA +62 812-3456-7890");
  expect(matches.map((m) => m.normalized)).toEqual(["+6281234567890", "+6281234567890"]);
});
