import { NIK_PROVINCE_CODES } from "../data/provinces.js";

// 16 digits: province (1-2) whitelisted, day (7-8) 01-31 or 41-71 (female = real day + 40),
// month (9-10) 01-12, serial (13-16) != 0000. Kab/kota and kecamatan aren't checked — that data
// churns too often to whitelist.
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
