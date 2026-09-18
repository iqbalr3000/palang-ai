export type PiiEntityType = "NIK" | "NPWP" | "PHONE_ID" | "EMAIL" | "CARD";

export interface PiiMatch {
  type: PiiEntityType;
  start: number;
  end: number;
  value: string; // the matched substring, as it appeared (with any separators)
  normalized: string; // digits only (or +62-prefixed for PHONE_ID), used as the vault key
}
