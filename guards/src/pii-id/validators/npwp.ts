// PMK 112/PMK.03/2022: an individual's 16-digit NPWP is their NIK (typed NIK); companies and
// government institutions prefix their 15-digit NPWP with "0".
export function validateNpwp(digits: string): boolean {
  return /^0?\d{15}$/.test(digits);
}
