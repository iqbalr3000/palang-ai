import type { GuardContext } from "@palang-ai/core";
import { processStream } from "@palang-ai/gateway/stream";
import {
  DEFAULT_PII_ID_CONFIG,
  createPiiIdInputGuard,
  createPiiIdOutputGuard,
} from "@palang-ai/guards";
import { createApp } from "@palang-ai/mock-upstream";
import { z } from "zod";
import { PII_TYPES, type PiiSample, type PiiType } from "../dataset/pii-schema.js";

// mock-echo streams 8-char chunks; mock-split-placeholder 1-char, splitting every placeholder.
export const RESTORE_SCENARIOS = ["mock-echo", "mock-split-placeholder"] as const;
export type RestoreScenario = (typeof RESTORE_SCENARIOS)[number];

export interface RestoreReport {
  /** Samples where masking produced at least one placeholder — the only ones restore applies to. */
  samples: number;
  succeeded: number;
  successRate: number | null;
  /** Vault entries never restored in the output, per entity type. */
  restoreMiss: Record<PiiType | "total", number>;
}

const PLACEHOLDER = /\[([A-Z_]+)_\d+\]/g;
const RESTORED_KEY = "piiRestoredPlaceholders"; // written by the pii-id output guard

const chunkSchema = z.object({
  choices: z.array(z.object({ delta: z.object({ content: z.string().optional() }) })).optional(),
});

const inputGuard = createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG);
const outputGuard = createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG);
const upstream = createApp({ chunkDelayMs: 0 });

function streamedContent(written: string[]): string {
  let content = "";
  for (const event of written) {
    const data = event.trim().replace(/^data: /, "");
    if (data === "[DONE]") continue;
    for (const choice of chunkSchema.parse(JSON.parse(data)).choices ?? []) {
      content += choice.delta.content ?? "";
    }
  }
  return content;
}

interface RoundTrip {
  placeholders: string[];
  success: boolean;
  missed: string[];
}

async function roundTrip(sample: PiiSample, scenario: RestoreScenario): Promise<RoundTrip> {
  const ctx: GuardContext = {
    requestId: sample.id,
    tenantId: "eval",
    model: scenario,
    stream: true,
    messages: [{ role: "user", content: sample.text }],
    piiVault: new Map(),
    signal: new AbortController().signal,
    metadata: {},
  };
  await inputGuard.check(ctx);
  const masked = ctx.messages[0]?.content ?? "";
  // Success is judged against the vault's normalized values, which is what restore returns.
  const expected = masked.replace(PLACEHOLDER, (p) => ctx.piiVault.get(p) ?? p);

  const response = await upstream.fetch(
    new Request("http://mock-upstream/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: scenario, stream: true, messages: ctx.messages }),
    }),
  );
  if (!response.body) throw new Error(`mock-upstream returned no body for ${sample.id}`);

  const written: string[] = [];
  const result = await processStream(
    response.body,
    {
      outputGuards: [outputGuard],
      guardConfigs: { "pii-id": { mode: "enforce" } },
      failureMode: "fail_closed",
      ctx,
    },
    async (chunk) => {
      written.push(chunk);
    },
  );

  const restored = ctx.metadata[RESTORED_KEY];
  const restoredSet = restored instanceof Set ? restored : new Set<unknown>();
  const placeholders = [...ctx.piiVault.keys()];
  return {
    placeholders,
    success: result.blocked === null && streamedContent(written) === expected,
    missed: placeholders.filter((p) => !restoredSet.has(p)),
  };
}

function typeOf(placeholder: string): PiiType {
  const type = PII_TYPES.find((t) => placeholder.startsWith(`[${t}_`));
  if (!type) throw new Error(`unexpected placeholder ${placeholder}`);
  return type;
}

export async function evaluateRestore(
  samples: PiiSample[],
  scenario: RestoreScenario,
): Promise<RestoreReport> {
  const restoreMiss = Object.fromEntries([...PII_TYPES, "total"].map((t) => [t, 0])) as Record<
    PiiType | "total",
    number
  >;
  let applicable = 0;
  let succeeded = 0;

  for (const sample of samples) {
    const trip = await roundTrip(sample, scenario);
    if (trip.placeholders.length === 0) continue;
    applicable += 1;
    if (trip.success) succeeded += 1;
    for (const placeholder of trip.missed) {
      restoreMiss[typeOf(placeholder)] += 1;
      restoreMiss.total += 1;
    }
  }

  return {
    samples: applicable,
    succeeded,
    successRate: applicable === 0 ? null : succeeded / applicable,
    restoreMiss,
  };
}
