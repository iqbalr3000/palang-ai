# Palang AI — Overview

Palang AI is an open-source, OpenAI-compatible security gateway for LLM applications and agents. Standing rules:
`docs/plans/constraints.md`.

A reverse proxy that sits between an application and its LLM provider. Applications change only
`base_url`; every request and response passes through a configurable pipeline of guards.

**Deliberately is:**
- Deterministic before probabilistic — regex/validation first, ML classifier second, LLM judge last.
- Monitor mode everywhere — every guard can run log-only so adoption doesn't require trusting enforcement on day one.
- Async-audit-first — the request path never awaits a database write.
- Self-hosted and open-source — you deploy and configure it yourself (config-as-code), not a hosted SaaS you sign up for. Admin/tenant provisioning happens via the admin API + config file, not a public signup flow.
- Usable two ways: as the full gateway (HTTP proxy) **or** as an in-process package (`@palang-ai/guards`) with no gateway/Postgres required — pulled forward from v0.2 into v0.1 (`docs/decisions/0002-in-process-guards-v0.1.md`), since requiring a full deployment just to mask PII in a small project was real adoption friction for an open-source tool.

**Deliberately isn't (v0.1):**
- Multi-provider — only an OpenAI-compatible adapter; Anthropic/Gemini native APIs are v0.2.
- Policy-editing UI — policies are config-as-code; the dashboard is read-only.
- A human-in-the-loop approval workflow for tool calls.

## Where things live

- **`docs/plans/constraints.md`** — rules every feature must respect: design principles, pipeline
  semantics, API contract, budgets, dependencies, eval and test rules. Carried over from the
  original technical spec (TSD), which is no longer tracked; older specs and decisions still cite
  its sections.
- **`docs/plans/roadmap.md`** — a log of what's shipped, confirmed by the user. Not a plan.
- **`docs/plans/spec-<feature>.md`** — one per feature, the actual planning unit in this repo's
  workflow: scope, design, engineering tasks. Written/reviewed before code — see `CLAUDE.md`'s
  workflow section. v0.1 feature order came from the TSD's milestones; labels are ours (agreed
  2026-09-17, replacing the TSD's M0–M5 codes):
  - `runtime-spike` (`spec-runtime-spike.md`, results in `docs/spike-results.md`) — prove Bun handles SSE streaming, the ONNX classifier, and Postgres migrations. **Done** — see `docs/plans/roadmap.md`.
  - `gateway-core` (`spec-gateway-core.md`) — monorepo scaffold, passthrough proxy, auth, config, audit queue, minimal admin key API. **Done** — see `docs/plans/roadmap.md`.
  - `pii-guard` (`spec-pii-guard.md`) — Indonesian PII detection/masking + stream holdback buffer; standalone/in-process usage is in scope (0002). **Done** — see `docs/plans/roadmap.md`.
  - `injection-guard` (`spec-injection-guard.md`) — prompt-injection detection (heuristics → opt-in classifier; LLM judge deferred) + eval harness; standalone/in-process usage is in scope (0002). **Done** — see `docs/plans/roadmap.md`.
  - `tool-policy` (`spec-tool-policy.md`) — tool-call policy, canary, output PII detection (resolves the open question carried from `pii-guard`); standalone/in-process usage is in scope (0002). **Done** — see `docs/plans/roadmap.md`.
  - TSD M5 (`dashboard-launch`) was split into three features on 2026-09-28, in this order:
    - `admin-api` — the rest of the admin API (TSD §7.4), `/metrics`, audit `content_mode` + retention, pino logging, request body limit, upstream timeout, `ttft_ms` (`spec-admin-api.md`). **Done** — see `docs/plans/roadmap.md`.
    - `dashboard` — Next.js dashboard, 4 pages + password login (TSD §13) (`spec-dashboard.md`). **Done** — see `docs/plans/roadmap.md`.
    - `restructure` (`spec-restructure.md`) — flat repo layout, five workspaces, no Turborepo (`docs/decisions/0007`). Inserted before `launch`. **Done** — see `docs/plans/roadmap.md`.
    - `hardening` (`spec-hardening.md`) — fixes all 15 findings of the 2026-09-28 security + code review (`docs/decisions/0008`). Before `launch`. **Done** — see `docs/plans/roadmap.md`.
    - `launch` (`spec-launch.md`) — `docker compose up` with a seeded demo, gateway benchmark report, dependency audit in CI, `examples/`, `docs/deployment.md`, `@palang-ai/guards` ready for npm, `v0.1.0` release. **Done** — see `docs/plans/roadmap.md`. The demo video and blog post are the user's own.
- **`docs/decisions/`** — decisions made where the spec was ambiguous or a dependency wasn't in the agreed stack (e.g. `0001-lint-tooling.md`).

## Post-v0.1

Next features, agreed 2026-10-03, in this order. Each goes through the usual brainstorm → spec →
build flow; `docs/improvement-plan.md` is reference input only — its phases, task IDs and working
rules don't bind this repo's workflow; it and the TSD are local-only.
- `pii-precision` (`spec-pii-precision.md`) — keyword-gated plain NPWP (35 of the 43 PII false
  positives), company 16-digit NPWP, parenthesized phones, dataset slices that expose the recall
  cost. **Done** — see `docs/plans/roadmap.md`.
- `injection-id` (`spec-injection-id.md`) — informal and code-mixed Indonesian datasets, per-slice
  and fixed-FPR metrics, L1 normalization and pattern variants; thresholds reported, not changed.
  Built, pending the user's review.
- Deferred: a multilingual classifier, decided from `injection-id`'s numbers. A human-written
  held-out set has no writer yet.

## Not yet scoped

Genuinely undecided — no spec yet, not committed to:
- Anthropic Messages API adapter — v0.2 candidate.
- Policy editing in the dashboard UI + DB-backed tenants — v0.2 candidate.
