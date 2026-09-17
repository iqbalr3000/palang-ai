import { test, expect } from "bun:test";
import { generateApiKey, sha256Hex } from "./keys.js";

test("generated key matches plg_<env>_<random> shape and has >=32 bytes of randomness", async () => {
  const key = await generateApiKey("prod");
  expect(key.plaintext).toMatch(/^plg_prod_[0-9a-f]{64}$/); // 32 bytes = 64 hex chars
  expect(key.prefix).toBe(key.plaintext.slice(0, 12));
});

test("hash is deterministic sha256 and does not equal the plaintext", async () => {
  const key = await generateApiKey("prod");
  expect(key.hash).toBe(await sha256Hex(key.plaintext));
  expect(key.hash).not.toBe(key.plaintext);
  expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
});

test("two generated keys never collide", async () => {
  const a = await generateApiKey("prod");
  const b = await generateApiKey("prod");
  expect(a.plaintext).not.toBe(b.plaintext);
  expect(a.hash).not.toBe(b.hash);
});
