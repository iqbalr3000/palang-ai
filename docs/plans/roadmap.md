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

### 2026-09-17

**`fe8df4a` — docs: bootstrap planning workflow and complete runtime-spike**
Initial commit. Planning docs (`CLAUDE.md`, `docs/plans/overview.md`, `docs/plans/roadmap.md`,
`docs/decisions/0001-lint-tooling.md`, `docs/decisions/0002-in-process-guards-v0.1.md`) plus the
full `runtime-spike` feature (spec: `spec-runtime-spike.md`, results: `docs/spike-results.md`,
throwaway code under `spike/`).
