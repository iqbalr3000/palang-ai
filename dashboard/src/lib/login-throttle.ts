// One global throttle rather than per-IP: client IPs come from headers that can be forged when
// the dashboard isn't behind a trusted proxy. It slows guessing without ever locking the admin
// out for good.

const WINDOW_MS = 15 * 60 * 1000;
const FREE_FAILURES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export type Reservation = { waitMs: number } | { rejected: true };

export interface LoginThrottle {
  /** Claims the next attempt slot; attempts are spaced out globally once failures pile up. */
  reserve(now: number): Reservation;
  recordFailure(now: number): void;
  recordSuccess(): void;
}

export function createLoginThrottle(): LoginThrottle {
  let failures: number[] = [];
  // Attempts still being checked count as likely failures: otherwise a burst of parallel attempts
  // all get a free slot before the first one has failed.
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
