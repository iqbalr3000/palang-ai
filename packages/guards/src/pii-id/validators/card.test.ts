import { test, expect } from "bun:test";
import { validateCard } from "./card.js";

test("valid: 16-digit Luhn-valid number", () => {
  expect(validateCard("4111111111111111")).toBe(true);
});

test("valid: 13-digit (shortest allowed)", () => {
  expect(validateCard("4222222222222")).toBe(true); // well-known 13-digit Visa test number
});

test("invalid: fails Luhn", () => {
  expect(validateCard("4111111111111112")).toBe(false);
});

test("invalid: wrong length", () => {
  expect(validateCard("411111111111")).toBe(false); // 12 digits
  expect(validateCard("41111111111111111111")).toBe(false); // 21 digits
});

test("invalid: non-digit characters", () => {
  expect(validateCard("411111111111111X")).toBe(false);
});
