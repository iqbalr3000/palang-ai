import type {
  Decision,
  FailureMode,
  GuardContext,
  GuardRuntimeConfig,
  OutputGuard,
  ToolCall,
} from "@palang-ai/guards";
import { runOutputGuardText, runOutputGuardToolCall } from "../stream/run-output-guard.js";
import type { CompletionChoice } from "../stream/types.js";

export interface ApplyOutputGuardsResult {
  blocked: Decision | null;
  decisions: Decision[];
}

function guardConfigFor(
  configs: Record<string, GuardRuntimeConfig>,
  name: string,
): GuardRuntimeConfig {
  const config = configs[name];
  if (!config) throw new Error(`No runtime config for guard "${name}"`);
  return config;
}

// Same runOutputGuardText/runOutputGuardToolCall helpers the stream processor uses, called once
// over the complete response instead of per released chunk. Mutates choices in place.
export async function applyOutputGuardsToChoices(
  choices: CompletionChoice[],
  outputGuards: OutputGuard[],
  guardConfigs: Record<string, GuardRuntimeConfig>,
  failureMode: FailureMode,
  ctx: GuardContext,
): Promise<ApplyOutputGuardsResult> {
  const decisions: Decision[] = [];

  async function guardText(text: string, choiceIndex: number): Promise<string | null> {
    let current = text;
    for (const guard of outputGuards) {
      if (!guard.checkText) continue;
      const result = await runOutputGuardText(
        guard,
        current,
        ctx,
        guardConfigFor(guardConfigs, guard.name),
        failureMode,
        choiceIndex,
      );
      current = result.text;
      decisions.push(result.decision);
      if (result.decision.action === "block") return null;
    }
    return current;
  }

  for (const [choiceIndex, choice] of choices.entries()) {
    // Token-level logprobs would hand back the raw output the guards just rewrote.
    delete choice.logprobs;
    const message = choice.message;
    if (!message) continue;

    for (const field of ["content", "refusal"] as const) {
      const text = message[field];
      if (!text) continue;
      const checked = await guardText(text, choiceIndex);
      if (checked === null) return { blocked: decisions.at(-1) ?? null, decisions };
      message[field] = checked;
    }

    if (message.tool_calls) {
      for (let i = 0; i < message.tool_calls.length; i++) {
        let call: ToolCall = message.tool_calls[i]!;
        for (const guard of outputGuards) {
          if (!guard.checkToolCall) continue;
          const result = await runOutputGuardToolCall(
            guard,
            call,
            ctx,
            guardConfigFor(guardConfigs, guard.name),
            failureMode,
          );
          call = result.call;
          decisions.push(result.decision);
          if (result.decision.action === "block") return { blocked: result.decision, decisions };
        }
        message.tool_calls[i] = { ...call };
      }
    }
  }

  return { blocked: null, decisions };
}
