# Gateway core — spec

Feature entry: `docs/plans/roadmap.md`. Source of scope/acceptance criteria: `docs/TSD.md` §15 M1,
§4 (repo structure), §5 (core domain model), §7 (gateway), §8 (config), §9 (data model). This
records decisions on top of those sections, not a restatement of them.

## Scope

Covers, per TSD §15 M1:
- Monorepo scaffold (Bun workspaces + Turborepo, TSD §4) + CI config (typecheck/test/lint, using
  the tooling from `docs/decisions/0001-lint-tooling.md`).
- `packages/core`: guard types, pipeline runner, `enforce`/`monitor` mode, per-guard timeout,
  `fail_open`/`fail_closed` failure mode (TSD §5, §5.1). No real guards exist yet (`pii-guard` is
  next) — the runner is built and tested against fakes. Designed standalone-usable per
  `docs/decisions/0002-in-process-guards-v0.1.md`, even though nothing publishes it yet (that's a
  `dashboard-launch` task).
- Config loader: YAML + Zod schema, `${VAR}` env interpolation (TSD §8).
- `apps/mock-upstream`: `mock-echo` and streaming scenarios (TSD §12). The streaming mechanism is
  the same `stream()`/`pipe()` pattern already proven in `runtime-spike`'s `sse-streaming` spike.
- `apps/gateway` public API: `POST /v1/chat/completions` (streaming + non-streaming passthrough,
  no guards wired in yet), `GET /v1/models`, `GET /healthz`, `GET /readyz` (TSD §7.1).
- API key auth (`plg_<env>_<random>`, SHA-256 hash, constant-time compare — TSD §7.1, §10.2).
- `packages/db`: Drizzle schema + migrations for `api_keys` and `audit_events` (TSD §9).
- Audit queue + batch writer (in-memory bounded queue, async, never blocks the request path — TSD
  §7.5).

Explicitly out of scope: any actual guard logic (`pii-guard`/`injection-guard`/`tool-policy`);
`docker-compose.yml` (`dashboard-launch`); the dashboard itself; the full Admin API surface (see
Design below — only key create/revoke lands here).

## Design

| Point | Decision | Why |
|---|---|---|
| Admin API scope | Only `POST /admin/tenants/:id/keys` and `DELETE /admin/keys/:id` (TSD §7.4). `GET /admin/stats`, `/admin/events`, `/admin/events/:id`, `/admin/tenants`, `/admin/tenants/:id/keys` (list), `/admin/config`, and `/metrics` (TSD §10.4) deferred to `dashboard-launch`. | TSD §15 M1's checklist doesn't list the Admin API at all, but M1's own acceptance criterion ("openai SDK works against the gateway") needs *some* way to mint an API key. The read/reporting/observability endpoints only have a consumer (the dashboard) once `dashboard-launch` exists. |
| `/readyz` scope | Checks DB reachable + config valid only. Does not check "models loaded" (TSD §7.1's full definition). | No ML model exists to load yet at this stage — that check only becomes meaningful once `injection-guard` lands. Revisit `/readyz` then. |
| DB outage scope | Only the audit path is required to survive DB downtime (TSD §2.3's "the request path never waits on the database" is literally scoped to audit writes). Auth still requires a DB read per request (TSD §9 — keys live in the DB) and is **not** outage-resilient — a DB-down auth failure returns `503 auth_unavailable`, distinguished from a real `401 invalid_api_key`. Full record: `docs/decisions/0004-db-outage-scope.md`. | TSD §15 M1's "killing the DB does not break proxying" is ambiguous against §9's DB-backed auth. An in-memory API-key cache would make auth itself outage-resilient too, but that's a real scope increase (cache invalidation, delayed revocation during an outage) not designed here. |
| Stream processor scope | `apps/gateway/src/stream/relay.ts` is a straight-through pipe (`hono/streaming`'s `pipe()`), not TSD §7.3's holdback buffer + tool-call assembler. | The holdback size is `max(holdback of active output guards)`, which is 0 with zero guards configured (none exist until `pii-guard`). Building the real holdback buffer now, with nothing to validate it against, would be speculative. `pii-guard` replaces this file's contents when it needs to. Same reasoning applies to audit's `ttft_ms`/streaming `usage` fields, left `null` for now — populating them needs the same per-chunk inspection the holdback buffer will already be doing. |
| Request validation | `apps/gateway/src/public/request-schema.ts` — a minimal Zod schema (`model`, `messages`, `stream`) with `.passthrough()` at every level. | Enough to route the request through Palang's own logic (model allowlist, `GuardContext`); TSD §7.1's "unknown request fields are forwarded unchanged" means we deliberately don't validate the rest of the OpenAI request shape. |

## Execution order

Staged, agreed 2026-09-17 — each stage produces something checkable before the next starts:
1. Monorepo scaffold + CI (nothing else can start without this). **Done.**
2. `packages/core` + `packages/db` (independent of each other and of config/mock-upstream). **Done.**
3. Config loader. **Done.**
4. `apps/mock-upstream`. **Done.**
5. `apps/gateway`: passthrough routes + auth + audit queue + minimal admin key endpoints (the
   integration stage — pulls together everything from 1–4). **Done.**

## Engineering tasks

Matches TSD §15 M1 checklist, plus the Admin API decision above:
- [x] Monorepo scaffold per TSD §4 (`apps/gateway`, `apps/mock-upstream`, `packages/core`,
      `packages/db`, `packages/config`), Turborepo, `bunfig.toml` (`linker = "isolated"`).
- [x] CI: GitHub Actions (typecheck, test, lint) per `docs/decisions/0001-lint-tooling.md`. Also
      added a `postgres:16` service container for `packages/db`'s tests.
- [x] `packages/core`: types (TSD §5, plus `wouldBlock`/`FinalAction` gap-fills — see
      `src/types.ts`), pipeline runner with mode/timeout/failure-mode handling (TSD §5.1), tested
      against fake guards (`src/pipeline.test.ts`, 8 cases).
- [x] Config loader + Zod schema (TSD §8), `${VAR}` interpolation. `loadConfig()` throws a
      readable `ConfigError`; exiting the process on that error is gateway boot's job (stage 5).
      `palang.example.yaml` added at repo root and used as the loader's own test fixture.
- [x] `apps/mock-upstream`: `mock-echo` scenario, both non-streaming and streaming (SSE chunked
      via `hono/streaming`), registry pattern ready for later scenarios (`mock-split-placeholder`
      etc., added by the features that need them). Verified with `bun test` and a real bound
      `curl` round-trip.
- [x] `apps/gateway` public API: `/v1/chat/completions` (stream + non-stream passthrough, glob
      model allowlist, block-response shape wired but unreachable with zero guards),
      `/v1/models`, `/healthz`, `/readyz` (DB + config only, per Design above).
- [x] API key auth (`plg_<env>_<random>`, hashed, DB-equality lookup — see auth/middleware.ts on
      why that satisfies TSD §10.2's constant-time requirement without a manual compare loop);
      admin token uses an explicit `timingSafeEqualString` since there's no DB lookup for it.
- [x] `packages/db`: `api_keys` + `audit_events` schema and migrations (TSD §9), integration-tested
      against a real Postgres 16 (`src/schema.test.ts`).
- [x] Audit queue + batch writer, non-blocking (TSD §7.5) — `apps/gateway/src/audit/queue.ts`.
- [x] Admin API: `POST /admin/tenants/:id/keys`, `DELETE /admin/keys/:id` only (per Design above).
- [x] Acceptance (TSD §15 M1): official `openai` SDK works against the gateway in both streaming
      and non-streaming modes; audit rows appear in Postgres — demonstrated together in
      `apps/gateway/test/gateway.e2e.test.ts` against really-bound servers (gateway + mock-upstream).
      "Killing the DB does not break proxying" — narrowed per the DB outage scope decision above;
      covered by two targeted unit tests (`audit/queue.test.ts`'s failed-flush case,
      `auth/middleware.test.ts`'s DB-unreachable case) rather than a literal kill-the-container e2e
      test.
