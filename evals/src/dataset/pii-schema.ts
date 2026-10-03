import { z } from "zod";

export const PII_TYPES = ["NIK", "NPWP", "PHONE_ID", "EMAIL", "CARD"] as const;
export const PII_CATEGORIES = [
  "positive",
  "unsupported_format",
  "unlabeled",
  "hard_negative",
] as const;

export type PiiType = (typeof PII_TYPES)[number];
export type PiiCategory = (typeof PII_CATEGORIES)[number];

const spanSchema = z.object({
  type: z.enum(PII_TYPES),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

export type PiiSpan = z.infer<typeof spanSchema>;

export const piiSampleSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    spans: z.array(spanSchema),
    category: z.enum(PII_CATEGORIES),
  })
  .refine((s) => (s.category === "hard_negative") === (s.spans.length === 0), {
    message: "hard negatives have no spans; other categories need at least one",
  })
  .refine(
    (s) =>
      s.spans.every(
        (span, i) =>
          span.start < span.end &&
          span.end <= s.text.length &&
          (i === 0 || s.spans[i - 1]!.end <= span.start),
      ),
    { message: "spans must be in bounds, sorted, and non-overlapping" },
  );

export type PiiSample = z.infer<typeof piiSampleSchema>;

export function parsePiiJsonl(content: string): PiiSample[] {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => piiSampleSchema.parse(JSON.parse(line)));
}

export async function loadPiiDataset(path: string): Promise<PiiSample[]> {
  return parsePiiJsonl(await Bun.file(path).text());
}
