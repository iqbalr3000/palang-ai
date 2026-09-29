// Legacy 15-digit format only: since 2024 a 16-digit NPWP is the holder's NIK.
export function validateNpwp15(digits: string): boolean {
  return /^\d{15}$/.test(digits);
}
