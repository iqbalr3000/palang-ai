# Restructure — spec

Feature entry: `docs/plans/roadmap.md`. A clean-up between `dashboard` and `launch`, so `launch`
(Dockerfiles, npm publish) builds on the final paths. Decision: `docs/decisions/0007`. Agreed
2026-09-28.

## Scope

- Flat layout: `apps/gateway` → `gateway/`, `apps/dashboard` → `dashboard/`,
  `apps/mock-upstream` → `mock-upstream/`, `packages/guards` → `guards/`; `evals/` stays.
- `packages/core` merged into `guards/` (`@palang-ai/core` imports become `@palang-ai/guards`).
- `packages/db` moved into `gateway/src/db`, including `drizzle/` migrations and
  `drizzle.config.ts`; `bun run db:migrate` keeps working.
- `packages/config/base.json` → root `tsconfig.base.json`.
- Turborepo removed; root `typecheck`/`test`/`lint`/`dev` use `bun run --filter '*'`.
- `spike/` deleted.
- Every path reference updated: root scripts, CI, `.gitignore`/`.prettierignore`/ESLint ignores,
  `next.config.ts` (tracing root, `.env` path), dashboard `start` script, drizzle config, test
  migration paths, README, `CLAUDE.md`, `docs/plans/overview.md`.

Explicitly out of scope: behavior changes of any kind; renaming published package names beyond
dropping `@palang-ai/core`/`db`/`config`; rewriting older feature specs (they keep the paths that
were true when written).

## Design

| Point | Decision | Why |
|---|---|---|
| Moves | `git mv`, one commit, no content edits beyond paths/imports. | Git's rename detection keeps history readable. |
| `guards/` inside | Core's files go to `guards/src/core/` (`types`, `pipeline`, `reasons`, `glob`), re-exported from the package root. | Keeps the runner and the guards apart inside one package. |
| `gateway/src/db` | `schema.ts`, `client.ts`, tests, and `drizzle/`; `drizzle.config.ts` at `gateway/`. | Next to its only user. |
| Verification | Typecheck, lint, format, full test suite (incl. Postgres), `bun run eval --suite pii`, and the README's getting-started flow on a fresh clone. | A pure move should change no numbers and break no user steps. |

## Engineering tasks

- [x] Move workspaces to the flat layout; merge core into guards; move db into gateway.
- [x] Root `tsconfig.base.json`; remove `packages/config` and every `@palang-ai/config` reference.
- [x] Remove turbo (`turbo.json`, dependency, `.turbo` ignores); root scripts via `bun --filter`.
- [x] Update imports, paths, CI, ignores, scripts, README, `CLAUDE.md`, overview.
- [x] Delete `spike/`.
- [x] Verify as in Design.

## Results

- Eight workspaces became five; `apps/`, `packages/`, `turbo.json`, `packages/config` and `spike/`
  are gone. All moves are `git mv` renames.
- Same 331 tests pass as before the move (guards 146 = core 11 + guards 135; gateway 128 = db 2 +
  gateway 126); typecheck, lint and format clean; `bun run eval --suite pii` numbers unchanged.
- The README's getting-started flow (setup → db:migrate → mock/gateway → key → request →
  dashboard) and its in-process example were re-run on a fresh copy of the new layout.
- Six files that had imported from both `@palang-ai/core` and `@palang-ai/guards` now import
  `@palang-ai/guards` twice; the two that were two value imports were merged, the rest are
  `import type` + value pairs and left as they are.
