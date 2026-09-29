import { expect, test } from "bun:test";
import { createLoginThrottle, type Reservation } from "./login-throttle";

const MINUTE = 60_000;

function fail(throttle: ReturnType<typeof createLoginThrottle>, times: number, at: number) {
  for (let i = 0; i < times; i++) {
    throttle.reserve(at);
    throttle.recordFailure(at);
  }
}

test("the first few failures cost nothing extra", () => {
  const throttle = createLoginThrottle();
  for (let i = 0; i < 3; i++) {
    expect(throttle.reserve(0)).toEqual({ waitMs: 0 });
    throttle.recordFailure(0);
  }
});

test("after that, attempts are spaced out further and further, globally", () => {
  const throttle = createLoginThrottle();
  fail(throttle, 3, 0);
  const waits = [0, 1, 2].map(() => throttle.reserve(10 * MINUTE));
  expect(waits).toEqual([{ waitMs: 0 }, { waitMs: 1000 }, { waitMs: 3000 }]);
});

test("a burst of simultaneous attempts is throttled before any of them fails", () => {
  const throttle = createLoginThrottle();
  const burst: Reservation[] = Array.from({ length: 100 }, () => throttle.reserve(0));
  const admitted = burst.filter((r) => "waitMs" in r);
  expect(admitted.length).toBeLessThan(10);
  expect(burst.filter((r) => "rejected" in r).length).toBeGreaterThan(90);
});

test("the spacing is capped, and a flood is turned away instead of queueing forever", () => {
  const throttle = createLoginThrottle();
  fail(throttle, 50, 0);
  expect(throttle.reserve(MINUTE)).toEqual({ waitMs: 0 });
  expect(throttle.reserve(MINUTE)).toEqual({ waitMs: 30_000 });
  expect(throttle.reserve(MINUTE)).toEqual({ rejected: true });
});

test("failures age out, and a successful sign-in resets everything", () => {
  const throttle = createLoginThrottle();
  fail(throttle, 10, 0);
  expect(throttle.reserve(20 * MINUTE)).toEqual({ waitMs: 0 });
  throttle.recordFailure(20 * MINUTE);

  fail(throttle, 10, 40 * MINUTE);
  throttle.reserve(41 * MINUTE);
  throttle.recordSuccess();
  expect(throttle.reserve(41 * MINUTE)).toEqual({ waitMs: 0 });
  throttle.recordSuccess();
  expect(throttle.reserve(41 * MINUTE)).toEqual({ waitMs: 0 });
});
