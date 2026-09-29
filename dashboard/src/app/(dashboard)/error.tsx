"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Couldn&apos;t load this page</h1>
      <p className="text-sm text-muted-foreground">
        The admin API didn&apos;t respond as expected. Check that the gateway is running and that
        PALANG_ADMIN_URL points at its admin port.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">{error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
