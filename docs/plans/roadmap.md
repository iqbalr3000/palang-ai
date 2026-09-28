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
