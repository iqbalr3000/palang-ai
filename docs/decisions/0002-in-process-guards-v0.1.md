# 0002 — Pull in-process `@palang/guards` usage into v0.1

`docs/TSD.md` §16 open question #5 listed "Publishing `@palang/guards` to npm for in-process use" as
a v0.2 candidate. Decided 2026-09-17, during pre-`runtime-spike` discussion, after confirming Palang
is a self-hosted open-source tool (not a hosted SaaS).

**Decision:** pulled forward into v0.1. Requiring a full gateway deployment + Postgres just to use,
say, PII masking in a small project is real adoption friction for an open-source tool — and
`packages/core`/`packages/guards` are already runtime-agnostic, Web-Standard-only by design (Working
rule 3), so supporting standalone/in-process usage now is low-cost, not a retrofit.

**Concrete scope change:**
- `packages/core` and `packages/guards` must expose a public API callable without any HTTP
  gateway/tenant/auth machinery — calling a guard directly must not require standing up a request
  context.
- Each guard feature (`pii-guard`, `injection-guard`, `tool-policy`; `canary` TBD — it's more
  tightly coupled to a request/response cycle, revisit when that feature is spec'd) now includes
  standalone usage in its scope/acceptance criteria, not just wiring into the gateway pipeline.
- The actual npm publish (buildable `package.json` exports instead of raw-TS-source-only, semver,
  README, an in-process usage example under `examples/`) is a task under `dashboard-launch` (TSD's
  original M5 packaging/launch scope), alongside the gateway's own release.

**Not decided yet** (deferred to each guard's own spec): the exact standalone API shape — e.g.
whether a caller constructs a lightweight context themselves or calls a flat function like
`maskPii(messages)`. Not needed until `pii-guard` is spec'd.

**Why:** user's own words: "kita tarik maju aja deh" (pull it forward), after weighing "harus deploy
service terpisah + Postgres cuma buat mask NIK" as real friction for a side project.
