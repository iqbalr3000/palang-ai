import { test, expect } from "bun:test";
import { validateNpwp } from "./npwp.js";

test("valid: 15 digits", () => {
  expect(validateNpwp("123456789012345")).toBe(true);
});

test("valid: 16-digit company NPWP (0 + the 15-digit NPWP)", () => {
  expect(validateNpwp("0123456789012345")).toBe(true);
});

test("invalid: 16 digits not starting with 0", () => {
  expect(validateNpwp("1234567890123456")).toBe(false);
});

test("invalid: wrong length", () => {
  expect(validateNpwp("12345678901234")).toBe(false);
  expect(validateNpwp("01234567890123456")).toBe(false);
});

test("invalid: non-digit characters", () => {
  expect(validateNpwp("12345678901234X")).toBe(false);
});
