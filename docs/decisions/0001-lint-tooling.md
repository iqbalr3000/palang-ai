# 0001 — Lint/format tooling

`docs/TSD.md` §3 (tech stack) doesn't list a linter or formatter. Decided 2026-09-17, during
`runtime-spike` brainstorming, prompted by the user asking to model Palang's coding style on an
existing project (`baskit-os`).

**Decision:** ESLint + Prettier + Husky (`lint-staged` on pre-commit), matching `baskit-os`'s setup.
Exact ESLint config (airbnb-typescript vs. another base) is decided when `gateway-core` starts and
there's real code to lint against — not speculated here.

**Why:** Consistency with the user's other TypeScript/Bun projects; all three tools are Bun-compatible.
