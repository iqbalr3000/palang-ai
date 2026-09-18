import { test, expect } from "bun:test";
import { validateNik } from "./nik.js";

test("valid NIK, male (day 01-31)", () => {
  expect(validateNik("3171011506900001")).toBe(true);
});

test("valid NIK, female (day 41-71, i.e. real day + 40)", () => {
  expect(validateNik("3171015506900001")).toBe(true);
});

test("invalid: province code not in the whitelist", () => {
  expect(validateNik("0071011506900001")).toBe(false);
  expect(validateNik("9971011506900001")).toBe(false);
});

test("invalid: day out of range for both male (01-31) and female (41-71) encodings", () => {
  expect(validateNik("3171013206900001")).toBe(false); // 32
  expect(validateNik("3171017206900001")).toBe(false); // 72
  expect(validateNik("3171010006900001")).toBe(false); // 00
});

test("invalid: month out of range", () => {
  expect(validateNik("3171011513900001")).toBe(false); // month 13
  expect(validateNik("3171011500900001")).toBe(false); // month 00
});

test("invalid: serial is 0000", () => {
  expect(validateNik("3171011506900000")).toBe(false);
});

test("invalid: wrong length", () => {
  expect(validateNik("317101150690001")).toBe(false); // 15 digits
  expect(validateNik("31710115069000011")).toBe(false); // 17 digits
});

test("invalid: non-digit characters", () => {
  expect(validateNik("317101150690000X")).toBe(false);
});
