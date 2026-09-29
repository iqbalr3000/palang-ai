# Gateway latency — 095abcb-dirty

300 sequential requests per case after 30 warm-up runs, against mock-upstream with no artificial delay, so the numbers are Palang's own cost. Guards: canary, pii-id, injection (L1 only, monitor), tool-policy. Host: Apple M1, Bun 1.3.12, Postgres on the same machine.

- **Guard overhead p95:** 1.10 ms (budget ≤ 10 ms: met), summed over every guard decision of a request (p50 0.92 ms, 660 requests).
- **Added time-to-first-token p95 (streaming):** 5.27 ms (budget ≤ 100 ms: met).

| Case (ms) | Direct p50 | Direct p95 | Via Palang p50 | Via Palang p95 | Added p95 |
|---|---:|---:|---:|---:|---:|
| Non-streaming, total | 0.11 | 0.29 | 1.63 | 3.50 | +3.21 |
| Streaming, first token | 0.22 | 0.54 | 3.75 | 5.81 | +5.27 |

The added end-to-end time also covers API-key lookup, request validation and the HTTP hop; audit writes are asynchronous and not on the request path.
