# 0003 — Project name and npm scope

`docs/TSD.md` §16 open question #1: "Final project name and npm scope" — explicitly left undecided
in the original spec (`docs/TSD.md`'s own header even flags "Palang" as a working name, "check
npm/GitHub availability before first publish"). Resolved 2026-09-17, during `gateway-core`
scaffolding.

**Decision:** project name is **Palang AI**. npm scope is `@palang-ai` (not the shorter `@palang`
used in the TSD draft and in `gateway-core`'s initial scaffold).

**Concrete effect:** every package under `packages/`/`apps/` is named `@palang-ai/<name>`
(`@palang-ai/core`, `@palang-ai/db`, `@palang-ai/config`, `@palang-ai/gateway`,
`@palang-ai/mock-upstream`, and later `@palang-ai/guards`). Root `package.json` name is
`palang-ai`. `docs/TSD.md` §4.1 still shows the old `@palang/*` scope from the original draft —
this decision supersedes it; TSD.md is left as-is (historical draft), not edited in place, per
Working rule 11.

**Why:** user's own words: "namanya itu palang ai" — confirmed full rename (not just the display
name) to `@palang-ai` when asked, since npm scope is far more disruptive to change after publish
than before.
