// 15-digit legacy format only — a 16-digit NPWP is, since the 2024 tax reform, literally the
// holder's NIK, resolved by trying validateNik first (detect.ts's priority order).
export function validateNpwp15(digits: string): boolean {
  return /^\d{15}$/.test(digits);
}
