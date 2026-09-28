# 0007 — Flat repo layout: five workspaces, no Turborepo

`docs/TSD.md` §4 lays the repo out as `apps/{gateway,dashboard,mock-upstream}` +
`packages/{core,guards,db}` + `evals`, driven by Turborepo, and `gateway-core` added
`packages/config` (a shared tsconfig). Decided 2026-09-28, before `launch`, after the user found
the repo read like "a project inside a project inside a project" — eight workspaces, each with its
own `package.json`, tsconfig, `node_modules` and `.turbo`.

**Decision:**
- **Flat layout** at the repo root: `gateway/`, `dashboard/`, `guards/`, `mock-upstream/`,
  `evals/`. No `apps/` or `packages/` level.
- **`packages/core` merges into `guards/`**: one library and one npm package,
  `@palang-ai/guards`, holding the types, the pipeline runner and every guard.
- **`packages/db` moves into `gateway/src/db`** (schema, migrations, drizzle config) — the gateway
  is its only user.
- **`packages/config` becomes a root `tsconfig.base.json`.**
- **Turborepo is removed**; root scripts use `bun run --filter '*' <script>`. Nothing builds
  across packages (everything imports TypeScript source), so turbo's task graph and cache had
  nothing to do. Verified: a failure in one workspace fails the whole command (exit 2).
- **`spike/` is deleted**; its results stay in `docs/spike-results.md`.

**What stays separate, and why:** the dashboard (Next.js on Node, its own build), the guards
library (its own npm package, decision 0002), the mock upstream (used by gateway tests, evals and
`bun run mock`), and evals (datasets, reports, the model).

**Not changed:** `linker = "isolated"` — each workspace keeps its own `node_modules`, which stops
phantom dependencies; with five workspaces instead of eight there are fewer of them.

Feature specs written before this keep their original paths; they record what was true then.
