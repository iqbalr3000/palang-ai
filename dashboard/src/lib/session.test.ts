import { expect, test } from "bun:test";
import {
  SESSION_TTL_MS,
  createSessionToken,
  passwordMatches,
  revokeSessionToken,
  verifySessionToken,
} from "./session";

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
  const [expiry, id, signature] = token.split(".") as [string, string, string];
  expect(
    await verifySessionToken(`${Number(expiry) + 999_999}.${id}.${signature}`, TOKEN, NOW),
  ).toBe(false);
  expect(await verifySessionToken(`${expiry}.other-id.${signature}`, TOKEN, NOW)).toBe(false);
  expect(await verifySessionToken(`${expiry}.${id}.${signature.slice(0, -2)}xx`, TOKEN, NOW)).toBe(
    false,
  );
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

test("every session gets its own id", async () => {
  const a = await createSessionToken(TOKEN, NOW);
  const b = await createSessionToken(TOKEN, NOW);
  expect(a).not.toBe(b);
});

test("a revoked session no longer verifies, other sessions still do", async () => {
  const revoked = await createSessionToken(TOKEN, NOW);
  const other = await createSessionToken(TOKEN, NOW);
  await revokeSessionToken(revoked, TOKEN);
  expect(await verifySessionToken(revoked, TOKEN, NOW + 1000)).toBe(false);
  expect(await verifySessionToken(other, TOKEN, NOW + 1000)).toBe(true);
});
