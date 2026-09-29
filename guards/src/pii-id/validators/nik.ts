import { NIK_PROVINCE_CODES } from "../data/provinces.js";

// Women's NIKs add 40 to the birth day.
export function validateNik(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;

  const province = digits.slice(0, 2);
  const day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  const serial = digits.slice(12, 16);

  if (!NIK_PROVINCE_CODES.has(province)) return false;
  if (!((day >= 1 && day <= 31) || (day >= 41 && day <= 71))) return false;
  if (!(month >= 1 && month <= 12)) return false;
  if (serial === "0000") return false;

  return true;
}
