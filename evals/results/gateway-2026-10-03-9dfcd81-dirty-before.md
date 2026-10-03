# Gateway latency — 9dfcd81-dirty

300 sequential requests per case after 30 warm-up runs, against mock-upstream with no artificial delay, so the numbers are Palang's own cost. Guards: canary, pii-id, injection (L1 only, monitor), tool-policy. Host: Apple M1, Bun 1.3.12, Postgres on the same machine.

- **Guard overhead p95:** 1.09 ms (budget ≤ 10 ms: met), summed over every guard decision of a request (p50 0.93 ms, 660 requests).
- **Added time-to-first-token p95 (streaming):** 4.76 ms (budget ≤ 100 ms: met).

| Case (ms) | Direct p50 | Direct p95 | Via Palang p50 | Via Palang p95 | Added p95 |
|---|---:|---:|---:|---:|---:|
| Non-streaming, total | 0.12 | 0.17 | 1.85 | 3.16 | +2.99 |
| Streaming, first token | 0.24 | 0.47 | 3.55 | 5.23 | +4.76 |

The added end-to-end time also covers API-key lookup, request validation and the HTTP hop; audit writes are asynchronous and not on the request path.
