// Global, not per-IP: client IPs come from forgeable headers.

const WINDOW_MS = 15 * 60 * 1000;
const FREE_FAILURES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export type Reservation = { waitMs: number } | { rejected: true };

export interface LoginThrottle {
  reserve(now: number): Reservation;
  recordFailure(now: number): void;
  recordSuccess(): void;
}

export function createLoginThrottle(): LoginThrottle {
  let failures: number[] = [];
  // In-flight attempts count as failures, or a parallel burst all gets free slots.
  let pending = 0;
  let nextSlotAt = 0;

  const spacing = (recentFailures: number): number =>
    recentFailures < FREE_FAILURES
      ? 0
      : Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (recentFailures - FREE_FAILURES));

  return {
    reserve(now) {
      failures = failures.filter((at) => now - at < WINDOW_MS);
      const waitMs = Math.max(0, nextSlotAt - now);
      if (waitMs > MAX_DELAY_MS) return { rejected: true };
      nextSlotAt = Math.max(now, nextSlotAt) + spacing(failures.length + pending);
      pending++;
      return { waitMs };
    },
    recordFailure(now) {
      pending = Math.max(0, pending - 1);
      failures.push(now);
    },
    recordSuccess() {
      pending = Math.max(0, pending - 1);
      failures = [];
      nextSlotAt = 0;
    },
  };
}
