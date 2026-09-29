import { expect, test } from "bun:test";
import { maskPiiDeep } from "./mask.js";

const ALL = ["NIK", "NPWP", "PHONE_ID", "EMAIL", "CARD"] as const;

test("masks PII in every string of a request-shaped value, reusing the vault", () => {
  const vault = new Map([["[NIK_1]", "3171011506900001"]]);
  const body = {
    user: "budi@example.com",
    messages: [{ role: "user", name: "budi-3171011506900001", content: "NIK saya [NIK_1]" }],
    prediction: { type: "content", content: "Hubungi 081234567890" },
    tools: [
      { type: "function", function: { name: "lookup", description: "Cari NIK 3171011506900001" } },
    ],
    temperature: 0.2,
    stream: true,
    stop: null,
  };

  const result = maskPiiDeep(body, vault, ALL);

  expect(result.masked).toBe(4);
  expect(result.value).toEqual({
    user: "[EMAIL_1]",
    messages: [{ role: "user", name: "budi-[NIK_1]", content: "NIK saya [NIK_1]" }],
    prediction: { type: "content", content: "Hubungi [PHONE_ID_1]" },
    tools: [{ type: "function", function: { name: "lookup", description: "Cari NIK [NIK_1]" } }],
    temperature: 0.2,
    stream: true,
    stop: null,
  });
  expect(vault.get("[EMAIL_1]")).toBe("budi@example.com");
});

test("only the configured entity types are masked", () => {
  const result = maskPiiDeep({ user: "budi@example.com, 081234567890" }, new Map(), ["EMAIL"]);
  expect(result.value).toEqual({ user: "[EMAIL_1], 081234567890" });
});

test("the input value is not mutated", () => {
  const body = { user: "budi@example.com" };
  maskPiiDeep(body, new Map(), ALL);
  expect(body.user).toBe("budi@example.com");
});
