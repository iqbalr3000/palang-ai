import type { Context } from "hono";
import { stream } from "hono/streaming";

/**
 * Straight-through relay of the upstream SSE body — no holdback buffer yet, since no output
 * guard exists to need one (TSD §7.3's holdback size is `max(holdback of active output guards)`,
 * which is 0 with zero guards configured). `pii-guard` replaces this with the real holdback
 * buffer + tool-call assembler once there's an actual guard to test it against.
 */
export function relayStream(c: Context, upstreamBody: ReadableStream<Uint8Array>) {
  return stream(c, async (s) => {
    await s.pipe(upstreamBody);
  });
}
