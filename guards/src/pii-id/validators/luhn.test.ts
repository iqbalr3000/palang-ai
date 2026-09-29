import { test, expect } from "bun:test";
import { luhnCheck } from "./luhn.js";

test("valid Luhn numbers pass", () => {
  expect(luhnCheck("4111111111111111")).toBe(true);
  expect(luhnCheck("79927398713")).toBe(true);
});

test("invalid Luhn numbers fail", () => {
  expect(luhnCheck("4111111111111112")).toBe(false);
  expect(luhnCheck("79927398710")).toBe(false);
});

test("non-digit input is not a valid Luhn number", () => {
  expect(luhnCheck("411a111111111111")).toBe(false);
});
