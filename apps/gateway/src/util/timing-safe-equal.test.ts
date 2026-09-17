import { test, expect } from "bun:test";
import { timingSafeEqualString } from "./timing-safe-equal.js";

test("equal strings", () => {
  expect(timingSafeEqualString("secret", "secret")).toBe(true);
});

test("different strings, same length", () => {
  expect(timingSafeEqualString("secret", "secre!")).toBe(false);
});

test("different lengths", () => {
  expect(timingSafeEqualString("short", "much longer string")).toBe(false);
});
