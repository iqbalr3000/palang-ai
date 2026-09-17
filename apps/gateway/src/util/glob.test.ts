import { test, expect } from "bun:test";
import { matchGlob } from "./glob.js";

test("exact match", () => {
  expect(matchGlob("gpt-4o-mini", "gpt-4o-mini")).toBe(true);
  expect(matchGlob("gpt-4o-mini", "gpt-4o")).toBe(false);
});

test("wildcard suffix", () => {
  expect(matchGlob("mock-*", "mock-echo")).toBe(true);
  expect(matchGlob("mock-*", "mock-")).toBe(true);
  expect(matchGlob("mock-*", "real-model")).toBe(false);
});

test("regex special characters in pattern are treated literally", () => {
  expect(matchGlob("gpt-4.5", "gpt-4.5")).toBe(true);
  expect(matchGlob("gpt-4.5", "gpt-4X5")).toBe(false); // "." must not act as regex any-char
});
