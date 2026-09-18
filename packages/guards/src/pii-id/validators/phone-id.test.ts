import { test, expect } from "bun:test";
import { normalizePhoneId } from "./phone-id.js";

test("valid: +62 prefix", () => {
  expect(normalizePhoneId("+6281234567890")).toEqual({ valid: true, normalized: "+6281234567890" });
});

test("valid: 62 prefix, no plus", () => {
  expect(normalizePhoneId("6281234567890")).toEqual({ valid: true, normalized: "+6281234567890" });
});

test("valid: 0 prefix (typical local format)", () => {
  expect(normalizePhoneId("081234567890")).toEqual({ valid: true, normalized: "+6281234567890" });
});

test("valid: separators (spaces, dots, dashes) are stripped before validation", () => {
  expect(normalizePhoneId("0812-3456-7890")).toEqual({ valid: true, normalized: "+6281234567890" });
  expect(normalizePhoneId("0812.3456.7890")).toEqual({ valid: true, normalized: "+6281234567890" });
  expect(normalizePhoneId("0812 3456 7890")).toEqual({ valid: true, normalized: "+6281234567890" });
});

test("valid: shortest allowed (8 + 8 more digits = 9 total after prefix)", () => {
  expect(normalizePhoneId("0812345678")).toEqual({ valid: true, normalized: "+62812345678" });
});

test("valid: longest allowed (8 + 11 more digits = 12 total after prefix)", () => {
  expect(normalizePhoneId("0812345678901")).toEqual({
    valid: true,
    normalized: "+62812345678901",
  });
});

test("invalid: does not start with 8 after the prefix", () => {
  expect(normalizePhoneId("0712345678")).toEqual({ valid: false });
});

test("invalid: too short after the prefix", () => {
  expect(normalizePhoneId("08123456")).toEqual({ valid: false }); // only 7 after the 0
});

test("invalid: too long after the prefix", () => {
  expect(normalizePhoneId("0812345678901234")).toEqual({ valid: false }); // 13 after the 0
});

test("invalid: no recognizable prefix", () => {
  expect(normalizePhoneId("81234567890")).toEqual({ valid: false });
});
