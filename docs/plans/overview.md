# Palang AI — Overview

Palang AI is an open-source, OpenAI-compatible security gateway for LLM applications and agents. Full
technical spec: `docs/TSD.md`.

A reverse proxy that sits between an application and its LLM provider. Applications change only
`base_url`; every request and response passes through a configurable pipeline of guards.

**Deliberately is:**
- Deterministic before probabilistic — regex/validation first, ML classifier second, LLM judge last (TSD §2.3).
- Monitor mode everywhere — every guard can run log-only so adoption doesn't require trusting enforcement on day one (TSD §2.3).
- Async-audit-first — the request path never awaits a database write (TSD §2.3).
- Self-hosted and open-source — you deploy and configure it yourself (config-as-code), not a hosted SaaS you sign up for. Admin/tenant provisioning happens via the admin API + config file, not a public signup flow.
- Usable two ways: as the full gateway (HTTP proxy) **or** as an in-process package (`@palang-ai/guards`) with no gateway/Postgres required — pulled forward from v0.2 into v0.1 (`docs/decisions/0002-in-process-guards-v0.1.md`), since requiring a full deployment just to mask PII in a small project was real adoption friction for an open-source tool.

**Deliberately isn't (v0.1):**
- Multi-provider — only an OpenAI-compatible adapter; Anthropic/Gemini native APIs are v0.2 (TSD §1.4, §16).
- Policy-editing UI — policies are config-as-code; the dashboard is read-only (TSD §1.4).
- A human-in-the-loop approval workflow for tool calls (TSD §1.4).

## Where things live

- **`docs/TSD.md`** — the full technical spec: architecture, guard specs, config, data model,
  non-functional requirements. Read the relevant section before implementing anything.
- **`docs/plans/roadmap.md`** — a log of what's shipped, confirmed by the user. Not a plan.
- **`docs/plans/spec-<feature>.md`** — one per feature, the actual planning unit in this repo's
  workflow: scope, design, engineering tasks. Written/reviewed before code — see `CLAUDE.md`'s
  workflow section. Feature order and scope come from `docs/TSD.md` §15; labels are ours (agreed
  2026-09-17, replacing the TSD's M0–M5 codes):
  - `runtime-spike` (`spec-runtime-spike.md`, results in `docs/spike-results.md`) — prove Bun handles SSE streaming, the ONNX classifier, and Postgres migrations. **Done** — see `docs/plans/roadmap.md`.
  - `gateway-core` (`spec-gateway-core.md`) — monorepo scaffold, passthrough proxy, auth, config, audit queue, minimal admin key API. **Done** — see `docs/plans/roadmap.md`.
  - `pii-guard` (`spec-pii-guard.md`) — Indonesian PII detection/masking + stream holdback buffer; standalone/in-process usage is in scope (0002). **Done** — see `docs/plans/roadmap.md`.
  - `injection-guard` (`spec-injection-guard.md`) — prompt-injection detection (heuristics → opt-in classifier; LLM judge deferred) + eval harness; standalone/in-process usage is in scope (0002). **Done** — see `docs/plans/roadmap.md`.
  - `tool-policy` (`spec-tool-policy.md`) — tool-call policy, canary, output PII detection (resolves the open question carried from `pii-guard`); standalone/in-process usage is in scope (0002). **Done** — see `docs/plans/roadmap.md`.
  - TSD M5 (`dashboard-launch`) was split into three features on 2026-09-28, in this order:
    - `admin-api` — the rest of the admin API (TSD §7.4), `/metrics`, audit `content_mode` + retention, pino logging, request body limit, upstream timeout, `ttft_ms` (`spec-admin-api.md`). **Done** — see `docs/plans/roadmap.md`.
    - `dashboard` — Next.js dashboard, 4 pages + password login (TSD §13) (`spec-dashboard.md`). **Done** — see `docs/plans/roadmap.md`.
    - `restructure` (`spec-restructure.md`) — flat repo layout, five workspaces, no Turborepo (`docs/decisions/0007`). Inserted before `launch`. Built, pending the user's review.
    - `launch` — `docker compose up` with a seeded demo, README, `LICENSE` (MIT, `docs/decisions/0006`) + third-party attribution, `@palang-ai/guards` npm publish with `examples/` (0002; one package since 0007), benchmark report, dependency audit in CI. Not started. The demo video and blog post are the user's own.
- **`docs/decisions/`** — decisions made where the spec was ambiguous or a dependency wasn't in TSD §3 (e.g. `0001-lint-tooling.md`).

## Not yet scoped

From TSD §16, genuinely undecided — no spec yet, not committed to:
- Anthropic Messages API adapter — v0.2 candidate.
- Policy editing in the dashboard UI + DB-backed tenants — v0.2 candidate.
