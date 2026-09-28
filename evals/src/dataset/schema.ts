import { z } from "zod";

export const LANGS = ["id", "en"] as const;
export const CATEGORIES = ["direct", "indirect", "obfuscated", "benign", "benign_hard"] as const;
export const SPLITS = ["dev", "test"] as const;

export type Lang = (typeof LANGS)[number];
export type Category = (typeof CATEGORIES)[number];
export type Split = (typeof SPLITS)[number];

const INJECTION_CATEGORIES: readonly Category[] = ["direct", "indirect", "obfuscated"];

export const sampleSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    role: z.enum(["user", "tool"]),
    label: z.enum(["injection", "benign"]),
    lang: z.enum(LANGS),
    category: z.enum(CATEGORIES),
    source: z.string().min(1),
  })
  .refine((s) => (s.label === "injection") === INJECTION_CATEGORIES.includes(s.category), {
    message: "label and category disagree",
  });

export type Sample = z.infer<typeof sampleSchema>;

export function parseJsonl(content: string): Sample[] {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => sampleSchema.parse(JSON.parse(line)));
}

export async function loadDataset(path: string): Promise<Sample[]> {
  return parseJsonl(await Bun.file(path).text());
}
