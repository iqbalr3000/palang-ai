import { test, expect } from "bun:test";
import { validateNpwp15 } from "./npwp.js";

test("valid: 15 digits", () => {
  expect(validateNpwp15("123456789012345")).toBe(true);
});

test("invalid: wrong length", () => {
  expect(validateNpwp15("12345678901234")).toBe(false); // 14
  expect(validateNpwp15("1234567890123456")).toBe(false); // 16 — that's NIK-shaped, not this
});

test("invalid: non-digit characters", () => {
  expect(validateNpwp15("12345678901234X")).toBe(false);
});
