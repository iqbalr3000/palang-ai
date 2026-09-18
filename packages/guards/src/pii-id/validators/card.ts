import { luhnCheck } from "./luhn.js";

export function validateCard(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  return luhnCheck(digits);
}
