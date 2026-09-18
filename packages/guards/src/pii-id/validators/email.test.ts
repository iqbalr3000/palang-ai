import { test, expect } from "bun:test";
import { validateEmail } from "./email.js";

test("valid emails", () => {
  expect(validateEmail("budi@example.com")).toBe(true);
  expect(validateEmail("budi.santoso+work@sub.example.co.id")).toBe(true);
});

test("invalid: missing @", () => {
  expect(validateEmail("budi.example.com")).toBe(false);
});

test("invalid: missing domain", () => {
  expect(validateEmail("budi@")).toBe(false);
});

test("invalid: missing TLD", () => {
  expect(validateEmail("budi@example")).toBe(false);
});

test("invalid: whitespace", () => {
  expect(validateEmail("budi santoso@example.com")).toBe(false);
});
