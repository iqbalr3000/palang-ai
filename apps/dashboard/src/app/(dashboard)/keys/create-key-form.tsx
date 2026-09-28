"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createKey, type CreateKeyState } from "./actions";

export function CreateKeyForm({ tenant }: { tenant: string }) {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createKey, {
    status: "idle",
  });
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tenant" value={tenant} />
        <div className="grid gap-2">
          <Label htmlFor="key-name">New key name</Label>
          <Input
            id="key-name"
            name="name"
            placeholder="e.g. backend-prod"
            required
            className="w-64"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </form>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.status === "created" && (
        <div className="space-y-2 rounded-md border border-action-flag/40 bg-action-flag/10 p-4">
          <p className="text-sm font-medium">
            Key &ldquo;{state.name}&rdquo; created. Copy it now — it won&apos;t be shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-background px-2 py-1 font-mono text-sm break-all">
              {state.key}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(state.key);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
