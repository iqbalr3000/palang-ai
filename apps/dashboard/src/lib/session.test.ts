import { expect, test } from "bun:test";
import { SESSION_TTL_MS, createSessionToken, passwordMatches, verifySessionToken } from "./session";

const TOKEN = "admin-token-with-plenty-of-entropy";
const NOW = 1_800_000_000_000;

test("a fresh session token verifies", async () => {
  const token = await createSessionToken(TOKEN, NOW);
  expect(await verifySessionToken(token, TOKEN, NOW + 1000)).toBe(true);
});

test("an expired token is rejected", async () => {
  const token = await createSessionToken(TOKEN, NOW);
  expect(await verifySessionToken(token, TOKEN, NOW + SESSION_TTL_MS + 1)).toBe(false);
});

test("a tampered expiry or signature is rejected", async () => {
  const token = await createSessionToken(TOKEN, NOW);
  const [expiry, signature] = token.split(".") as [string, string];
  expect(await verifySessionToken(`${Number(expiry) + 999_999}.${signature}`, TOKEN, NOW)).toBe(
    false,
  );
  expect(await verifySessionToken(`${expiry}.${signature.slice(0, -2)}xx`, TOKEN, NOW)).toBe(false);
});

test("rotating the admin token signs everyone out", async () => {
  const token = await createSessionToken(TOKEN, NOW);
  expect(await verifySessionToken(token, "rotated-admin-token", NOW)).toBe(false);
});

test("garbage never verifies", async () => {
  for (const value of ["", "abc", "1.2.3", ".", "NaN.x", `${NOW}.`]) {
    expect(await verifySessionToken(value, TOKEN, NOW)).toBe(false);
  }
});

test("password comparison", async () => {
  expect(await passwordMatches("hunter2", "hunter2")).toBe(true);
  expect(await passwordMatches("hunter3", "hunter2")).toBe(false);
  expect(await passwordMatches("", "hunter2")).toBe(false);
});
