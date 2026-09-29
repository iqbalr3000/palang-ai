import type { Decision } from "@palang-ai/guards";
import {
  runTextGuards,
  runToolCallGuards,
  type OutputGuardChain,
} from "../stream/run-output-guard.js";
import type { CompletionChoice } from "../stream/types.js";

export interface ApplyOutputGuardsResult {
  blocked: Decision | null;
  decisions: Decision[];
}

export async function applyOutputGuardsToChoices(
  choices: CompletionChoice[],
  chain: OutputGuardChain,
): Promise<ApplyOutputGuardsResult> {
  const decisions: Decision[] = [];

  for (const [choiceIndex, choice] of choices.entries()) {
    delete choice.logprobs;
    const message = choice.message;
    if (!message) continue;

    for (const field of ["content", "refusal"] as const) {
      const text = message[field];
      if (!text) continue;
      const result = await runTextGuards(chain, text, choiceIndex);
      decisions.push(...result.decisions);
      if (result.blocked) return { blocked: result.blocked, decisions };
      message[field] = result.value;
    }

    const toolCalls = message.tool_calls ?? [];
    for (const [i, call] of toolCalls.entries()) {
      const result = await runToolCallGuards(chain, call);
      decisions.push(...result.decisions);
      if (result.blocked) return { blocked: result.blocked, decisions };
      toolCalls[i] = { ...result.value };
    }
  }

  return { blocked: null, decisions };
}
