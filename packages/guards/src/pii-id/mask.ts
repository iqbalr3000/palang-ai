import type { ChatMessage, Decision, Finding, GuardContext, InputGuard } from "@palang-ai/core";
import { detectPii } from "./detect.js";
import { getOrCreatePlaceholder } from "./vault.js";
import type { PiiIdConfig } from "./config.js";

const PRESERVE_HINT_TEXT =
  "Palang has replaced sensitive personal data in this conversation with placeholders like " +
  "[NIK_1]. Keep every placeholder exactly as written in your reply — do not modify, translate, " +
  "or attempt to guess the original value.";

function maskText(
  text: string,
  vault: Map<string, string>,
  entities: ReadonlySet<string>,
  messageIndex: number,
  findings: Finding[],
): string {
  const matches = detectPii(text).filter((m) => entities.has(m.type));
  if (matches.length === 0) return text;

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    const placeholder = getOrCreatePlaceholder(vault, match.type, match.normalized);
    result += text.slice(cursor, match.start) + placeholder;
    cursor = match.end;
    findings.push({ type: match.type, messageIndex, start: match.start, end: match.end });
  }
  result += text.slice(cursor);
  return result;
}

function appendPreserveHint(messages: ChatMessage[]): void {
  const system = messages.find((m) => m.role === "system");
  if (system) {
    system.content = `${system.content ?? ""}\n\n${PRESERVE_HINT_TEXT}`.trim();
    return;
  }
  messages.unshift({ role: "system", content: PRESERVE_HINT_TEXT });
}

export function createPiiIdInputGuard(config: PiiIdConfig): InputGuard {
  const entities = new Set<string>(config.entities);

  return {
    name: "pii-id",
    phase: "input",
    async check(ctx: GuardContext): Promise<Decision> {
      const findings: Finding[] = [];

      for (let i = 0; i < ctx.messages.length; i++) {
        const message = ctx.messages[i]!;
        if (!config.roles.includes(message.role)) continue;

        if (message.content) {
          message.content = maskText(message.content, ctx.piiVault, entities, i, findings);
        }

        if (message.tool_calls) {
          for (const call of message.tool_calls) {
            call.function.arguments = maskText(
              call.function.arguments,
              ctx.piiVault,
              entities,
              i,
              findings,
            );
          }
        }
      }

      if (config.preserveHint && findings.length > 0) {
        appendPreserveHint(ctx.messages);
      }

      return {
        guard: "pii-id",
        action: findings.length > 0 ? "modify" : "allow",
        findings,
        latencyMs: 0, // overwritten by the pipeline runner
      };
    },
  };
}
