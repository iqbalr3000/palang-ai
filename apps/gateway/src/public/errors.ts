import type { Decision } from "@palang-ai/core";

// TSD §7.1 block response shape (non-streaming).
export function blockedErrorBody(requestId: string, blocked: Decision) {
  const code = blocked.reason ?? "blocked";
  return {
    error: {
      message: `Request blocked by Palang: ${code}`,
      type: "palang_policy_violation",
      code,
      param: null,
    },
    palang: { request_id: requestId, guard: blocked.guard },
  };
}
