# Roadmap — shipped work log

This is a **log, not a plan**. Forward-looking design (scope, design, engineering tasks) lives in
each feature's own `docs/plans/spec-*.md` — see `docs/plans/overview.md` for the current list. An
item lands here only after the user has reviewed and tested it and confirmed it's actually done; the
agent doesn't mark its own work done. Entries are grouped by feature, most recent first within each
group.

Feature order comes from `docs/TSD.md` §15; see `docs/plans/overview.md` for the label mapping.

---

## `runtime-spike`

*Spec: `spec-runtime-spike.md`. Results: `docs/spike-results.md`.*

- All three risky Bun integration points confirmed working: SSE streaming through Hono
  (`stream()`/`pipe()`) doesn't buffer; the ONNX classifier runs under Bun via the native
  `onnxruntime-node` backend (the originally-planned "force WASM" requirement was dropped — it
  turned out structurally unavailable under Bun, and unnecessary once native was proven to work
  cleanly under both `bun run` and `bun build`); Drizzle + postgres-js migrates and queries
  correctly against Postgres 16 under Bun.

## `gateway-core`

*Spec: `spec-gateway-core.md`.*

- Monorepo (Bun workspaces + Turborepo) stood up: `packages/core` (guard pipeline types + runner,
  `enforce`/`monitor` mode, per-guard timeout, `fail_open`/`fail_closed`), `packages/db`
  (`api_keys`/`audit_events` schema + migrations), config loader (YAML + Zod, `${VAR}`
  interpolation), `apps/mock-upstream` (`mock-echo` scenario, streaming + non-streaming),
  `apps/gateway` (API-key auth, `/v1/chat/completions` passthrough in both modes, `/v1/models`,
  health checks, async non-blocking audit queue, minimal admin key create/revoke).
- Verified end-to-end with the real `openai` npm SDK against really-bound servers — non-streaming,
  streaming, audit rows landing in Postgres, model-allowlist rejection, bad-key rejection all pass.
- DB-outage behavior scoped deliberately: only the audit path is required to survive the DB being
  down; auth still needs it and fails with a distinguishable `503` (`docs/decisions/0004`).

## `pii-guard`

*Spec: `spec-pii-guard.md`.*

- `packages/guards/pii-id`: detectors + validators for all v0.1 entity types (NIK, NPWP,
  PHONE_ID, EMAIL, CARD), mask (`InputGuard`) and restore (`OutputGuard`) with a per-request
  placeholder vault; standalone-usable per decision 0002.
- Real stream processor (`apps/gateway/src/stream/`): holdback buffer + tool-call assembler,
  replacing `gateway-core`'s straight-through relay stub. `mock-split-placeholder` deliberately
  splits placeholders across SSE chunks to exercise it.
- `pii-id` wired into the real gateway pipeline for both streaming and non-streaming
  (config-driven per tenant); non-streaming reuses the same guard-call helpers as streaming.
- Verified end-to-end: random-chunk-split property test (50 trials), a real round trip against a
  really-bound `mock-split-placeholder` server, and the real `openai` SDK against a really-bound
  gateway with an audit row inspected directly for raw PII.
- Reviewed after implementation (`code-review` skill, findings independently reproduced): 9 real
  bugs found and fixed — audit event id didn't fit the `uuid` column (audit had silently never
  persisted for real traffic), streaming audit recorded the wrong outcome on a mid-stream guard
  block, a phone-number regex swallowed emails sharing its prefix shape, the holdback buffer could
  release a half-formed placeholder, monitor-mode guards could still block on timeout/error, usage
  chunks bypassed output guards, no flush on early stream exit, the admin-token timing-safe compare
  leaked length via early return, and tool calls could be emitted out of order.
- Open question carried to `tool-policy`: whether output PII matching a value already in the
  input's vault should be flagged as a leak (it currently isn't — see `spec-pii-guard.md`'s open
  questions).

## `injection-guard`

*Spec: `spec-injection-guard.md`. Decision: `docs/decisions/0005`. Report:
`evals/results/2026-09-28-9576c75-dirty-fp32.md`.*

- `packages/guards/injection`: normalization (NFKC, zero-width/bidi strip, base64 decode) and
  EN/ID L1 heuristics, plus an `InjectionClassifier` interface (score = max(L1, L2));
  standalone-usable per decision 0002.
- L2 classifier (`protectai/deberta-v3-base-prompt-injection-v2`, fp32, sliding windows capped at
  8 × 512 tokens) in `apps/gateway/src/classifier/`. Missed TSD's latency budget by ~9–16× on an
  M1, so it's opt-in per tenant and the L2 budget was withdrawn (0005); int8 was rejected for
  losing most of its recall.
- Wired into the gateway after `pii-id` (scans masked text only), default `monitor`, optional
  `timeout_ms`; the gateway refuses to boot if an enabled model can't load; `judge.enabled: true`
  is rejected until L3 exists.
- `evals/`: injection dev/test datasets with disjoint phrasing, a 550-sample synthetic PII dataset,
  and one `bun run eval` report (injection per layer/language/category; PII precision/recall per
  entity, streaming restore round trip, `restore_miss`). Held-out test, flag threshold: L1 recall
  48.3% / FPR 22.9%, combined 92.4% / 39.9% — `monitor` is the intended mode.
- PII eval findings recorded for later (`spec-injection-guard.md`): `PHONE_ID` matching inside
  longer digit runs (carried into `tool-policy`), any 15 digits read as `NPWP`, Luhn/NIK
  collisions.
- Also fixed two `gateway-core` audit-queue bugs found on the way: fractional latencies rejected by
  the integer columns (events silently dropped) and flush/shutdown not waiting for in-flight
  inserts.

## `tool-policy`

*Spec: `spec-tool-policy.md`.*

- `packages/guards/tool-policy`: glob rules (first match wins, else `default`), strict typed
  argument constraints on dot paths — a failed constraint blocks with no fall-through — and
  malformed arguments blocked; findings never carry argument values. Constraint types and regexes
  are validated at config load.
- `packages/guards/canary`: token injected into the system message, checked case-insensitively in
  output text and tool-call arguments (`block` terminates, `flag` strips). Stored on
  `ctx.metadata`, since the pipeline runner hands guards a copy of ctx.
- Output PII: `pii-id` now detects on the model's raw text before restore, in one pass — closes
  `pii-guard`'s open question about raw values that match the vault.
- Holdback buffer only cuts at safe whitespace, so canaries, emails and grouped numbers reach
  output guards whole — before this, streaming `OUTPUT_PII` detection effectively never fired.
- `PHONE_ID` no longer matches inside longer or grouped digit runs (PII eval: `PHONE_ID`
  precision 77.4% → 100%, `CARD` recall 72.4% → 98.1%).
- Acceptance (TSD §15 M4): `mock-tool-call` and `mock-leak-canary` blocked/flagged as configured,
  streaming and non-streaming, enforce and monitor (16 e2e cases).

## `admin-api`

*Spec: `spec-admin-api.md`. First of the three features TSD M5 was split into.*

- The rest of the admin API: stats (totals, time buckets, flag/block by guard, top block reasons,
  latency percentiles), cursor-paginated and filterable events, event detail with stored content,
  tenants, key list, effective config — upstream API keys always redacted.
- `/metrics` in hand-rolled Prometheus text format, behind the admin token.
- Audit `content_mode` actually stored; `redacted` masks raw PII and the canary regardless of guard
  config and stores the model's raw output before restore (64 KB cap). Retention job at boot and
  daily.
- One recorder per finished request (audit + metrics + a content-free pino log line).
- Fixed `final_action` never being `flag`; request body limit (413), upstream header timeout (504),
  `ttft_ms` recorded. Verified with a real gateway boot as well as e2e tests.

## `dashboard`

*Spec: `spec-dashboard.md`. Second of the three features TSD M5 was split into.*

- `apps/dashboard`: Next.js 16 + Tailwind 4 + shadcn/ui + Recharts, standalone output (43 MB).
  Overview, Events (filters, cursor pagination, detail drawer with redacted content), API keys
  (created key shown once, revoke with confirmation), read-only Config.
- Password login with an HMAC session cookie keyed off the admin token; `proxy.ts` redirects and
  every data read and Server Action re-verifies. The admin token never reaches the browser.
- Verified against a real stack (gateway + mock upstream + Postgres), including the login form and
  key creation as no-JS form posts.

## README and first-run setup

*Cross-cutting, ahead of `launch`.*

- `README.md`: what Palang is and why, a from-scratch getting-started guide, architecture, guards,
  configuration, in-process usage, eval results, known limitations.
- One root `.env` read by the gateway, dashboard and migrations; `.env.example` documents every
  variable; `bun run setup` creates `.env` (generated secrets) and `palang.yaml`; root scripts
  `db:migrate`, `mock`, `gateway`, `dashboard`. The guide was run end to end on a fresh clone.

## `restructure`

*Spec: `spec-restructure.md`. Decision: `docs/decisions/0007`.*

- Flat layout: eight workspaces became five (`gateway/`, `dashboard/`, `guards/`, `mock-upstream/`,
  `evals/`); `packages/core` merged into `guards/`, `packages/db` into `gateway/`,
  `packages/config` into a root `tsconfig.base.json`; Turborepo and `spike/` removed.
- Behavior unchanged: the same 331 tests pass, the PII eval numbers are identical, and the
  getting-started flow was re-run on a fresh copy.
- README rewritten for setting Palang up in front of a real app (own tenant, guards starting in
  `monitor`, monitor-to-enforce), with a production checklist; YAML examples validated against the
  config schema.

## Platform foundation

*Cross-cutting — not owned by a single feature spec.*

- Planning workflow established: `docs/plans/{overview,roadmap}.md` and per-feature
  `spec-<feature>.md` files (format modeled on an existing project, `baskit-os`), replacing TSD's
  M0–M5 milestone codes with feature names. `docs/decisions/` added for scope calls outside TSD.
- Project renamed to **Palang AI**, npm scope `@palang-ai/*` (`docs/decisions/0003`) — TSD's own
  draft left this as an open question.

---

## Shipped, by commit

Same history as above, dated against the actual commit that shipped it (`git log`), newest first.

### 2026-09-28

**`230205d` — refactor: flatten the repo into five workspaces and rewrite the README for real use**
The whole `restructure` feature and the README rewrite.

**`d65961f` — docs: add README and one-command setup with a single root .env**
The README, the single root `.env` with `.env.example`, `bun run setup`, and root scripts.

**`1f1b01d` — feat: implement dashboard — Next.js admin UI with overview, events, keys, and
config**
The whole `dashboard` feature, plus logging `admin-api` as done.

**`19d077d` — feat: implement admin-api — read endpoints, metrics, audit content, and gateway
hardening**
The whole `admin-api` feature: admin read endpoints, `/metrics`, audit content + retention, pino
logging, body limit, upstream timeout, `ttft_ms`, and the `final_action = flag` fix. Also records
the TSD M5 split and the MIT license decision (0006).

**`72d3a67` — feat: implement tool-policy — tool-call policy, canary, and streaming-safe output
PII**
The whole `tool-policy` feature (TSD §15 M4): tool-call policy with constraints, canary, output PII
provenance, the holdback buffer's safe cut, and the `PHONE_ID` boundary fix.

**`19bef40` — feat: implement injection-guard — L1 heuristics, opt-in L2 classifier, gateway
wiring, and eval harness**
The whole `injection-guard` feature (TSD §15 M3): normalization + L1 heuristics, the opt-in L2
classifier (0005), gateway wiring, and the `evals/` harness with the first injection + PII report.
Includes the two audit-queue fixes above and stops tracking `CLAUDE.md`.

### 2026-09-18

**`9576c75` — feat: implement pii-guard — NIK/NPWP/phone/email/card detection, mask, and
streaming restore**
The whole `pii-guard` feature (TSD §15 M2): detectors/validators, mask/restore with a per-request
vault, the real stream processor (holdback buffer + tool-call assembler), and wiring into the
gateway pipeline for both streaming and non-streaming. Includes 9 bug fixes from a post-implementation
review (audit id/uuid mismatch, streaming audit outcome, phone/email regex overlap, holdback buffer
half-formed release, monitor-mode error handling, usage-chunk guard bypass, no flush on early stream
exit, timing-safe compare length leak, tool-call ordering).

### 2026-09-17

**`ca541dd` — feat: implement gateway-core — passthrough proxy, auth, audit, admin keys**
The whole `gateway-core` feature (TSD §15 M1): Bun workspaces monorepo scaffold + CI,
`packages/core` (pipeline runner), `packages/db` (`api_keys`/`audit_events`), config loader,
`apps/mock-upstream` (`mock-echo`), `apps/gateway` (auth, passthrough proxy, audit queue, minimal
admin key endpoints). Verified end-to-end with the real `openai` SDK. Also renamed the project to
Palang AI / `@palang-ai` scope (decision 0003) and scoped the DB-outage acceptance criterion
(decision 0004).

**`fe8df4a` — docs: bootstrap planning workflow and complete runtime-spike**
Initial commit. Planning docs (`CLAUDE.md`, `docs/plans/overview.md`, `docs/plans/roadmap.md`,
`docs/decisions/0001-lint-tooling.md`, `docs/decisions/0002-in-process-guards-v0.1.md`) plus the
full `runtime-spike` feature (spec: `spec-runtime-spike.md`, results: `docs/spike-results.md`,
throwaway code under `spike/`).
