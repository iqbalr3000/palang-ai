import type {
  Decision,
  FailureMode,
  GuardContext,
  GuardRuntimeConfig,
  OutputGuard,
  ToolCall,
} from "@palang-ai/core";
import { runOutputGuardText, runOutputGuardToolCall } from "../stream/run-output-guard.js";

export interface NonStreamingChoice {
  message?: { content?: string | null; tool_calls?: ToolCall[] };
}

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
  choices: NonStreamingChoice[],
  outputGuards: OutputGuard[],
  guardConfigs: Record<string, GuardRuntimeConfig>,
  failureMode: FailureMode,
  ctx: GuardContext,
): Promise<ApplyOutputGuardsResult> {
  const decisions: Decision[] = [];

  for (const choice of choices) {
    if (!choice.message) continue;

    if (choice.message.content) {
      let text = choice.message.content;
      for (const guard of outputGuards) {
        if (!guard.checkText) continue;
        const result = await runOutputGuardText(
          guard,
          text,
          ctx,
          guardConfigFor(guardConfigs, guard.name),
          failureMode,
        );
        text = result.text;
        decisions.push(result.decision);
        if (result.decision.action === "block") return { blocked: result.decision, decisions };
      }
      choice.message.content = text;
    }

    if (choice.message.tool_calls) {
      for (let i = 0; i < choice.message.tool_calls.length; i++) {
        let call = choice.message.tool_calls[i]!;
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
        choice.message.tool_calls[i] = call;
      }
    }
  }

  return { blocked: null, decisions };
}
