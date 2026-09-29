export type PiiEntityType = "NIK" | "NPWP" | "PHONE_ID" | "EMAIL" | "CARD";

export interface PiiMatch {
  type: PiiEntityType;
  start: number;
  end: number;
  value: string;
  normalized: string;
}
