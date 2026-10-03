# Gateway latency — e9fab6a-dirty

300 sequential requests per case after 30 warm-up runs, against mock-upstream with no artificial delay, so the numbers are Palang's own cost. Guards: canary, pii-id, injection (L1 only, monitor), tool-policy. Host: Apple M1, Bun 1.3.12, Postgres on the same machine.

- **Guard overhead p95:** 1.16 ms (budget ≤ 10 ms: met), summed over every guard decision of a request (p50 0.97 ms, 660 requests).
- **Added time-to-first-token p95 (streaming):** 5.51 ms (budget ≤ 100 ms: met).

| Case (ms) | Direct p50 | Direct p95 | Via Palang p50 | Via Palang p95 | Added p95 |
|---|---:|---:|---:|---:|---:|
| Non-streaming, total | 0.13 | 0.29 | 1.44 | 2.63 | +2.34 |
| Streaming, first token | 0.25 | 0.52 | 3.86 | 6.03 | +5.51 |

The added end-to-end time also covers API-key lookup, request validation and the HTTP hop; audit writes are asynchronous and not on the request path.
