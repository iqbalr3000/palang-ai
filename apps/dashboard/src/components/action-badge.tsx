import type { Action } from "@/lib/admin-client";
import { cn } from "@/lib/utils";

const STYLES: Record<Action, string> = {
  allow: "bg-action-allow/15 text-action-allow",
  flag: "bg-action-flag/15 text-action-flag",
  block: "bg-action-block/15 text-action-block",
};

export function ActionBadge({ action }: { action: Action }) {
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", STYLES[action])}>
      {action}
    </span>
  );
}
