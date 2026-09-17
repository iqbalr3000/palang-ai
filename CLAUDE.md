# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Palang is an OpenAI-compatible LLM security gateway (Bun + TypeScript). Full technical spec:
`docs/TSD.md` — read the relevant section before implementing anything.

**This file stays high-level on purpose**: project structure, coding conventions, and the workflow
below. Feature-level detail (scope, design, engineering tasks) lives in `docs/plans/spec-*.md`, one
per feature — see `docs/plans/overview.md` for the index. `docs/plans/roadmap.md` is a log of what's
shipped, confirmed by the user — not a plan.

**Current state:** spec-only, no code written yet. `runtime-spike` is the active feature (spec at
`docs/plans/spec-runtime-spike.md`) — see `docs/plans/roadmap.md` for full feature order.

## Architecture

Palang is a reverse proxy: apps change only `base_url`, and every request/response passes through a configurable pipeline of guards (TSD §2, §5–6).

```
Client → [Auth + tenant] → [Input pipeline: canary inject → PII mask → injection scan]
       → [Upstream adapter] → LLM provider
       → [Stream processor: SSE parse → holdback buffer → tool-call assembly]
       → [Output pipeline: canary check → PII restore → tool-call policy] → Client
                                    └─(async, non-blocking)─► Audit queue → Postgres
```

Guards run sequentially in configured order (PII mask must precede the LLM judge); each has an
independent `enforce`/`monitor` mode and a `fail_open`/`fail_closed` timeout behavior — see TSD §5.1
before touching the pipeline runner.

## Project layout

Bun workspaces + Turborepo monorepo (TSD §4). Unlike a single-service layout, this split is
justified here: `apps/gateway` (Bun), `apps/dashboard` (Next.js/Node), and `apps/mock-upstream` are
genuinely separate deployables on different runtimes — this isn't premature abstraction.

- `apps/gateway` — Hono app serving both the public API (`/v1/*`, port 8080) and admin API
  (`/admin/*`, port 8081, separate for firewalling) from one process. `stream/` (SSE holdback buffer
  + tool-call assembler) is the hardest part; `audit/` is the async batch writer.
- `apps/dashboard` — Next.js, Server Components only, talks to the admin API server-side (admin
  token never reaches the browser).
- `apps/mock-upstream` — scriptable fake OpenAI server, selected by model name (`mock-echo`,
  `mock-split-placeholder`, `mock-tool-call`, `mock-leak-canary`), used by both tests and the demo.
- `packages/core` — guard types, pipeline runner, decision aggregation. Runtime-agnostic.
- `packages/guards` — `pii-id`, `injection`, `tool-policy`, `canary`. Runtime-agnostic.
- `packages/db` — Drizzle schema + migrations.
- `evals/` — the project's headline artifact: reproducible detection-rate/FPR/latency reports via
  `bun run eval` (TSD §11).

**No filename suffixes** (no `.service.ts`/`.guard.ts`) unless two files would otherwise collide on
the same base name within a module — only then does the concept get its own subfolder. E.g.
`packages/guards/src/pii-id/{detector,validator,mask,restore,index}.ts`, not `pii-id.service.ts`.

Config flows through `apps/gateway/src/config/` only — the YAML+Zod loader (TSD §8). No scattered
`process.env` reads elsewhere in `apps/`; `packages/core`/`packages/guards` can't do this at all
(see Working rule 3).

## Commands

- Install: `bun install`
- Dev (all apps): `bun run dev`
- Typecheck: `bun run typecheck`
- Test: `bun test` (or `bun run test` for all workspaces via Turborepo)
- Lint: `bun run lint` / Format: `bun run format` (ESLint + Prettier, see `docs/decisions/0001-lint-tooling.md`)
- Eval: `bun run eval`
- DB migration: `bun run --filter @palang/db migrate`

## AI coding workflow

1. **Brainstorm.** Research real constraints first (not just TSD prose), consolidate into one
   proposal — design + risks + a recommended default per open point — and batch the consequential
   decisions into one question round.
2. **Spec.** Once decisions settle, write/update `docs/plans/spec-<feature>.md` — scope, design,
   engineering tasks. It's a record of what was actually discussed and agreed (notulen), never
   drafted or invented inside the file.
3. **Confirm start.** Ask whether to start now, and whether to build the feature all at once or staged.
4. **Code.** Implement against the agreed spec.
5. **Review & test.** The user reviews and tests the actual change.
6. **Commit message.** Once the user confirms manual testing passes, draft the commit message —
   message only, no extra commentary, don't run the commit unless asked.
7. **Log it.** Only once the user confirms it's actually done does `docs/plans/roadmap.md` get
   updated — the agent doesn't mark its own work done there.

## Working rules

1. Work one feature at a time (`docs/plans/roadmap.md`). Do not start the next until the current one's acceptance criteria pass.
2. Before finishing any task, run `bun run typecheck && bun test`. Both must pass.
3. `packages/core` and `packages/guards` must stay runtime-agnostic: no `Bun.*`, no Hono, no `node:*` imports. Web Standard APIs only.
4. Never log, persist, or return raw message content or PII vault values. Log decisions, not payloads.
5. The request path must never await database writes. Audit goes through the async queue.
6. Guards: write tests first. Validators (NIK, NPWP, Luhn) need both valid and invalid cases.
7. Stream processor changes require the random-chunk-split test to pass.
8. All PII in tests and datasets must be synthetic.
9. TypeScript strict. No `any`; use `unknown` and narrow. Validate external input with Zod.
10. Keep dependencies minimal. Ask before adding a new dependency not listed in TSD §3.
11. If the spec is ambiguous or conflicts with reality (e.g. a library does not work on Bun), stop and explain the options instead of silently deviating. Record decisions in `docs/decisions/`.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- File names: kebab-case. Types/interfaces: PascalCase. No default exports except Next.js pages.
- Error codes (`reason`) are snake_case strings, listed in `packages/core/src/reasons.ts`.
- ESLint + Prettier, Husky pre-commit running `lint-staged` — see `docs/decisions/0001-lint-tooling.md`.
- Comments: minimal — only where intent genuinely isn't obvious (a gotcha, a magic number, a non-obvious seam). Don't restate what the code already says.
