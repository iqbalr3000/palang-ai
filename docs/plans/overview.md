# Palang — Overview

Palang is an open-source, OpenAI-compatible security gateway for LLM applications and agents. Full
technical spec: `docs/TSD.md`.

A reverse proxy that sits between an application and its LLM provider. Applications change only
`base_url`; every request and response passes through a configurable pipeline of guards.

**Deliberately is:**
- Deterministic before probabilistic — regex/validation first, ML classifier second, LLM judge last (TSD §2.3).
- Monitor mode everywhere — every guard can run log-only so adoption doesn't require trusting enforcement on day one (TSD §2.3).
- Async-audit-first — the request path never awaits a database write (TSD §2.3).
- Self-hosted and open-source — you deploy and configure it yourself (config-as-code), not a hosted SaaS you sign up for. Admin/tenant provisioning happens via the admin API + config file, not a public signup flow.
- Usable two ways: as the full gateway (HTTP proxy) **or** as an in-process package (`@palang/guards`) with no gateway/Postgres required — pulled forward from v0.2 into v0.1 (`docs/decisions/0002-in-process-guards-v0.1.md`), since requiring a full deployment just to mask PII in a small project was real adoption friction for an open-source tool.

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
  - `runtime-spike` (`spec-runtime-spike.md`, results in `docs/spike-results.md`) — prove Bun handles SSE streaming, the ONNX classifier, and Postgres migrations. **All 3 items GO, pending user review.**
  - `gateway-core` — monorepo scaffold, passthrough proxy, auth, config, audit queue. Not started.
  - `pii-guard` — Indonesian PII detection/masking + stream holdback buffer; standalone/in-process usage is in scope (0002). Not started.
  - `injection-guard` — prompt-injection detection (heuristics → classifier → judge) + eval harness; standalone/in-process usage is in scope (0002). Not started.
  - `tool-policy` — tool-call policy, canary, output PII detection; standalone/in-process usage is in scope for tool-policy (0002) — canary's fit TBD, it's more tightly coupled to a request/response cycle. Not started.
  - `dashboard-launch` — dashboard, packaging, `docker compose up`, release, **and** the `@palang/core`/`@palang/guards` npm publish (0002). Not started.
- **`docs/decisions/`** — decisions made where the spec was ambiguous or a dependency wasn't in TSD §3 (e.g. `0001-lint-tooling.md`).

## Not yet scoped

From TSD §16, genuinely undecided — no spec yet, not committed to:
- Final classifier model (decided inside `injection-guard`, based on license + Indonesian-language metrics).
- Anthropic Messages API adapter — v0.2 candidate.
- Policy editing in the dashboard UI + DB-backed tenants — v0.2 candidate.
