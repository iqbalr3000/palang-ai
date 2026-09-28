# Admin API — spec

Feature entry: `docs/plans/roadmap.md`. First of the three features TSD M5 (`dashboard-launch`)
was split into on 2026-09-28 (`admin-api` → `dashboard` → `launch`, see `docs/plans/overview.md`).
Source: `docs/TSD.md` §7.4 (admin API), §7.5 (audit queue), §8 (`content_mode`), §9 (data
model), §10.2 (security), §10.4 (observability), and the admin-API scope `spec-gateway-core.md`
deferred here. Decisions agreed 2026-09-28.

## Scope

- The rest of the admin API (TSD §7.4): `GET /admin/stats`, `/admin/events`, `/admin/events/:id`,
  `/admin/tenants`, `/admin/tenants/:id/keys`, `/admin/config`.
- `GET /metrics` (TSD §10.4) on the admin port.
- Audit `content_mode` (`none` / `redacted` / `hash`) actually written to `request_content` /
  `response_content`, and the `retention_days` job.
- pino JSON logging with redaction (TSD §3, §10.2).
- Request body limit and upstream timeout (TSD §10.2); `ttft_ms` recorded.
- Fix, found while planning: `final_action` is never `flag` — every non-block path writes
  `allow`, even when a guard flagged (including monitor-mode `wouldBlock`). The dashboard's
  "flagged over time" needs it.

Explicitly out of scope: the dashboard (`dashboard`); `docker compose`, README, license files,
npm publish, dependency audit in CI (`launch`).

## Design

| Point | Decision | Why |
|---|---|---|
| Split | TSD M5 is three features, this one first. | Agreed; each gets its own spec, review and commit, and the dashboard builds on a tested API. |
| `redacted` content | Storage redaction independent of guard config: before persisting, text is scanned with `detectPii` and each match replaced by `[TYPE]`; existing placeholders are left as they are. Request = messages after the input pipeline; response = the model's **raw** output before restore (text + tool calls). The canary token, if any, is replaced by `[CANARY]`. | Agreed. "Never persist PII" can't depend on whether a tenant enabled `pii-id` or which roles it scans, and raw model output can contain PII the model wrote itself. The canary replacement keeps `tool-policy`'s "token never reaches audit" true now that content is stored. |
| Streaming response capture | Capped at 64 KB per field, with a `truncated` flag. Only captured when `content_mode` isn't `none`. | TSD §10.1 bounds memory per stream. |
| `hash` / `none` | `hash`: SHA-256 per message (request) and per choice (response). `none`: content columns stay null. | TSD §8. |
| `/admin/events` | Keyset pagination on `(created_at, id)`; filters `tenant`, `action`, `guard` (= the guard made a `flag` or `block` decision, via the `decisions` jsonb), `from`/`to`. List omits content; `/admin/events/:id` includes it. | Stable under inserts; the list stays light. |
| `/admin/stats` | Default window is the last 24 h; hourly buckets for ranges ≤ 2 days, daily beyond. Totals by action, `flag`/`block` decisions by guard, top block reasons, latency p50/p95 (total and guard overhead) and guard latency p95 per guard — all computed in SQL. | Covers the dashboard overview page (TSD §13). `modify` (PII masking, canary inject) is routine on every request, so it's left out of the guard breakdown and filter — decided while building. |
| Secrets | `/admin/tenants` and `/admin/config` replace every `upstream.api_key` with `"***"`. | TSD §10.2. |
| `/metrics` | Hand-rolled Prometheus text format (counters + fixed-bucket histograms), no new dependency. On the admin port, behind the admin token. Metrics: requests by tenant/action, guard latency histogram by guard, audit dropped/flushed counters, upstream errors by tenant. | Agreed: TSD §10.4's metrics are few; `prom-client` isn't in TSD §3. Prometheus supports bearer auth. |
| Logging | pino JSON, one line per request: `request_id`, tenant, model, final action, blocking guard, status, latencies. Never message content. `authorization` and `api_key` are redacted. `LOG_LEVEL` is read in `config/`, together with the env reads `index.ts` currently does itself. | TSD §3, §10.2, Working rule 4, CLAUDE.md's "config flows through `config/` only". |
| Body limit | `server.max_body_bytes`, default 1 MB → 413. | TSD §10.2. |
| Upstream timeout | `upstream.timeout_ms` per tenant, default 120 s → 504. | TSD §10.2. |
| Retention | In-process timer in the gateway: runs at boot, then every 24 h, deleting events older than `retention_days`. | TSD §9; v0.1 is single-instance. |
| `ttft_ms` | Time from request start to the first chunk the gateway writes to the client. | TSD §9 column, never populated so far. |
| `final_action` | `block` if blocked; else `flag` if any decision is `flag`; else `allow` — on every path, including upstream errors. | Fix, see Scope. |

## Engineering tasks

- [x] Config: `server.max_body_bytes`, `upstream.timeout_ms`; env reads (`DATABASE_URL`,
      `PALANG_ADMIN_TOKEN`, `LOG_LEVEL`) moved into `config/`.
- [x] One place that records a finished request (audit enqueue + metrics + log line), replacing
      the scattered `auditQueue.enqueue` calls; `final_action` computed there.
- [x] Storage redaction + content capture (request, raw response incl. streaming, 64 KB cap,
      canary replaced); `none`/`redacted`/`hash`.
- [x] Body limit (413), upstream timeout (504), `ttft_ms`.
- [x] Metrics registry + `GET /metrics`.
- [x] Admin read endpoints with Zod-validated query params.
- [x] Retention job.
- [x] Tests: redaction (incl. a tenant without `pii-id`, and the canary), capture cap, metrics
      text format, each admin endpoint against Postgres, retention, body limit, timeout,
      `final_action = flag`.

## Implementation notes

Decided while building, not separately discussed — flagged for the user to confirm or overrule:
- **The upstream timeout covers the wait for response headers only.** A stream that keeps
  producing past 120 s isn't cut off; TSD §10.2 doesn't say which it means, and cutting long
  generations mid-stream would be the more surprising behavior.
- **`by_guard` and the `guard` filter count `flag`/`block` only**, not every non-`allow` decision
  (see Design) — found when the first stats test showed canary's routine `modify` in the breakdown.
- **`x-palang-decision`** on non-streaming responses now reports `flag` too, via the same
  `final_action` rule. Streaming keeps the provisional `allow` header (headers go out first).
- **`PublicAppDeps.metrics`/`logger` are optional** (a private metrics instance and a silent
  logger when omitted), so existing tests didn't need changing; `index.ts` passes the shared
  instances. `createAdminApp` requires `metrics`.
- **An invalid `LOG_LEVEL` fails boot**, like any other config error.
- Verified with a real boot (`src/index.ts` against `palang.example.yaml`, a real mock upstream and
  Postgres): JSON log lines, retention at boot, the request's audit row and `/metrics` counters.
