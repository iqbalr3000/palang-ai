import { test, expect } from "bun:test";
import { getOrCreatePlaceholder } from "./vault.js";

test("mints [TYPE_1] for the first value of a type", () => {
  const vault = new Map<string, string>();
  expect(getOrCreatePlaceholder(vault, "NIK", "3171011506900001")).toBe("[NIK_1]");
});

test("reuses the placeholder for a repeated value", () => {
  const vault = new Map<string, string>();
  const first = getOrCreatePlaceholder(vault, "EMAIL", "budi@example.com");
  const second = getOrCreatePlaceholder(vault, "EMAIL", "budi@example.com");
  expect(second).toBe(first);
  expect(vault.size).toBe(1);
});

test("increments N per type independently", () => {
  const vault = new Map<string, string>();
  getOrCreatePlaceholder(vault, "EMAIL", "budi@example.com");
  getOrCreatePlaceholder(vault, "EMAIL", "siti@example.com");
  const nikPlaceholder = getOrCreatePlaceholder(vault, "NIK", "3171011506900001");
  expect(nikPlaceholder).toBe("[NIK_1]"); // NIK's own counter, unaffected by EMAIL's count
});
