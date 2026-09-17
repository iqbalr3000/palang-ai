# 0004 — Scope of "killing the DB does not break proxying"

`docs/TSD.md` §15 M1 acceptance criteria: "killing the DB does not break proxying." Decided
2026-09-17, during `gateway-core` stage 5, after finding this is ambiguous against TSD §9 (API
keys live in the DB, so authentication requires a per-request DB read).

**Decision:** narrow reading. Only the **audit path** is required to survive DB downtime without
crashing the process or blocking requests (TSD §2.3 design principle #2, which literally scopes
this to "audit writes"). **Auth is not** DB-outage-resilient — a request that can't be
authenticated because the DB is unreachable fails, distinguished from an actually-invalid key by a
`503 auth_unavailable` response (vs `401 invalid_api_key`) so an operator can tell the two apart.

**Not decided / explicitly deferred:** an in-memory API-key cache (refreshed periodically, used as
a fallback when the DB is unreachable) would make auth itself outage-resilient. Real scope increase
(cache invalidation, revocation becoming delayed during an outage) — not designed here, revisit
only if this limitation actually causes pain in practice.

**Why:** user's own words, choosing between the two readings presented: "Baca sempit: audit doang
yang harus resilient" (narrow reading — only audit needs to be resilient).
