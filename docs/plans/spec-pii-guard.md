# PII guard — spec

Feature entry: `docs/plans/roadmap.md`. Source of scope/acceptance criteria: `docs/TSD.md` §15 M2,
§6.1 (`pii-id` guard spec), §7.3 (stream processor). This records decisions on top of those
sections, not a restatement of them.

## Scope

Covers, per TSD §15 M2:
- `packages/guards/pii-id` — detectors + validators for all v0.1 entity types (NIK, NPWP,
  PHONE_ID, EMAIL, CARD — TSD §6.1's table), mask (`InputGuard`) and restore
  (`OutputGuard.checkText`/`checkToolCall`) with consistent per-request placeholders. Standalone-
  usable per `docs/decisions/0002-in-process-guards-v0.1.md`.
- `apps/gateway/src/stream/` — the real holdback buffer + tool-call assembler (TSD §7.3),
  replacing `gateway-core`'s straight-through relay stub now that there's a real output guard to
  build it against.
- `apps/mock-upstream`'s `mock-split-placeholder` scenario (TSD §12) — deliberately splits
  placeholders across SSE chunks, the vehicle TSD ties to this feature's own acceptance criteria.
- Wiring `pii-id` into the real gateway pipeline (config-driven, replacing the empty guard list
  from `gateway-core`), for both streaming and non-streaming.

Explicitly out of scope: `mock-tool-call`/`mock-leak-canary` scenarios (`tool-policy`'s); the
formal eval harness / synthetic dataset generators (`injection-guard`'s, TSD §11) — this feature's
own test suite covers per-entity valid/invalid cases via `bun:test`, informally, not the `bun run
eval` harness itself; `injection`/`tool-policy`/`canary` guards.

## Design

| Point | Decision | Why |
|---|---|---|
| NIK province whitelist | Static TS module (`data/provinces.ts`, a `const` set of the 38 valid 2-digit codes per Kepmendagri 300/2022, including the post-2022 Papua split provinces), imported normally — not read from disk at runtime. | TSD §6.1 says "loaded from a data file (not hardcoded in regex)" — but `packages/guards` must stay runtime-agnostic (no `node:*`, Working rule 3), so an `fs` read is out. A separate, statically-imported data module satisfies "not hardcoded in regex" (the data is external to the pattern, not inlined) while staying portable. |
| NPWP (15-digit legacy format) validation | Format/length only (`99.999.999.9-999.999` or plain 15 digits) — no checksum algorithm. | TSD §6.1's validation column for NPWP only says 16-digit values that pass NIK validation are typed NIK; it doesn't ask for a legacy-format checksum. Not adding one beyond what's specified. |
| Entity type priority when a span matches multiple patterns | Check NIK/NPWP (16 and 15 digit) before PHONE_ID/EMAIL/CARD. | A real NIK is also a syntactically valid 13–19 digit span (CARD's pattern). Checking the more specific/structurally-validated types first avoids mis-tagging a real NIK as CARD. |
| Eval harness | Not built here. This feature's correctness is covered by `bun:test` cases per entity (valid + invalid), not a `bun run eval` report. | TSD §11's harness (dataset generators, `evals/src/`) is grouped under `injection-guard` in our own feature split (`docs/plans/overview.md`) — building it here would duplicate that scope. |
| One guard, two objects | `createPiiIdInputGuard(config)` and (stage 3) `createPiiIdOutputGuard(config)` are separate factory functions returning separate guard objects, both closing over the same `PiiIdConfig` and operating on the same `ctx.piiVault` at request time. | `packages/core`'s `InputGuard`/`OutputGuard` types each pin `phase` to a single literal (`"input"` / `"output"`) — one object can't satisfy both. The gateway's input and output guard lists each register their own of the two; TSD's architecture already implies this split (separate input/output pipelines). |
| Vault stores the normalized value, not the as-typed text | Dedup ("same value → same placeholder") and restoration both use `PiiMatch.normalized` (e.g. `+6281234567890`, not `0812-3456-7890` as the user typed it). | Two different original spellings of the same underlying value need to collapse to one placeholder; normalized form is the unambiguous identity to key on. Restoring to a canonical form is a minor, acceptable side effect. |
| `preserve_hint` with no existing system message | A new system message carrying just the hint is unshifted to the front of `ctx.messages`, rather than skipping the hint. | TSD assumes "append one line to the system message" without addressing the no-system-message case; silently dropping the hint would defeat the point of turning it on. |
| Decision `action` for the mask guard | `"modify"` when anything was masked, `"allow"` when nothing was found. | Matches TSD §5's `Action` union — masking changes content, which is exactly what `"modify"` is for. |
| `OutputGuard.holdback` value | Fixed at `32` (the documented cap), not computed per-request. | TSD §6.1 says holdback should be "computed from vault," but `holdback` is a static `number` set once on the guard object, before any request's vault exists — the two don't fit together. Using the cap directly is the one value that's always safe regardless of how many same-type placeholders a request ends up with. |
| Decision `action` for the restore guard | `"allow"` when every placeholder restored cleanly, `"flag"` only on `UNKNOWN_PLACEHOLDER`/`OUTPUT_PII`. Never `"modify"`, even though restoring literally changes the text. | Restoring known placeholders back to their real values is the expected happy path, not a policy-relevant change the way masking is — `"modify"` should mean "this guard intervened," not "the guard's ordinary job touched the string." |
| `restore_miss` | Only the raw data is produced here (`ctx.metadata.piiRestoredPlaceholders`, a `Set` of placeholders actually seen in output, accumulated across `checkText`/`checkToolCall` calls within one request). Computing/reporting the metric itself is not built. | Same eval-harness scope boundary as above — `restore_miss` is explicitly "for eval reporting" (TSD §11.2), which is `injection-guard`'s job. |
| Stream processor: no holdback buffer + tool-call assembler in `gateway-core` | Deferred to this feature (contrast: `gateway-core`'s stub was a straight-through relay). | Already decided in `spec-gateway-core.md` — noted here as the reason the stub exists to replace, not a new decision. |
| Stream processor: decoupled from Hono | `processStream(upstreamBody, deps, write)` takes a plain `write: (chunk: string) => Promise<void>` callback rather than a Hono `StreamingApi` or `Context`. | Keeps the whole processor testable with constructed fake SSE streams and a plain array-collecting `write`, no HTTP framework needed in tests — same reasoning as `holdback-buffer.ts` being pure (TSD: "must be unit-tested in isolation"). |
| Guard instances built once per tenant, at boot | `public/guards.ts`'s `buildAllTenantGuards()` runs once when `createPublicApp()` is called, producing a `Map<tenantId, TenantGuards>` — not rebuilt per request. | TSD §8: no hot reload, tenant config is fixed for the process lifetime. Guard construction is cheap (pure closures, no I/O) but there's no reason to redo it on every request either. |
| Non-streaming reuses `runOutputGuardText`/`runOutputGuardToolCall` | `apply-output-guards.ts` calls the exact same helpers `apps/gateway/src/stream/run-output-guard.ts` exports for the stream processor, just once per choice instead of per released chunk. | Directly implements TSD §7.3's closing line ("non-streaming responses reuse the same guard calls on the complete message") — one code path for mode/timeout/failure-mode handling, not two. |

## Execution order

Staged, agreed 2026-09-17 — each stage produces something checkable before the next starts:
1. `packages/guards/pii-id` detectors + validators (NIK, NPWP, PHONE_ID, EMAIL, CARD) — pure
   functions, tests written first (Working rule 6), no masking yet. **Done.**
2. Masking (`InputGuard`) — placeholder generation, per-request vault, `preserve_hint`, role
   scoping. **Done.**
3. Restoring (`OutputGuard.checkText` + `checkToolCall`) — placeholder restore,
   `UNKNOWN_PLACEHOLDER`/`OUTPUT_PII` findings, `mask_new_output_pii`. **Done.**
4. Real stream processor (`apps/gateway/src/stream/`): holdback buffer + tool-call assembler (TSD
   §7.3), plus `mock-split-placeholder` in `apps/mock-upstream`. **Done.**
5. Wire `pii-id` into the real gateway pipeline (config-driven), non-streaming reuse, the
   random-chunk-split property test (Working rule 7). **Done.**

## Engineering tasks

Matches TSD §15 M2 checklist:
- [x] Validators and detectors for all v0.1 entity types (NIK, NPWP, PHONE_ID, EMAIL, CARD) —
      `packages/guards/src/pii-id/`, 44 tests, including a free-text orchestrator
      (`detect.ts`) with type-priority overlap resolution.
- [x] Mask/restore with consistent per-request placeholders. Mask (`mask.ts`,
      `createPiiIdInputGuard`) — vault, dedup, role scoping, tool-call arguments,
      `preserve_hint`. Restore (`restore.ts`, `createPiiIdOutputGuard`) — known-placeholder
      restore, `UNKNOWN_PLACEHOLDER`/`OUTPUT_PII` findings, `mask_new_output_pii`,
      `restore_miss` tracking data (`ctx.metadata.piiRestoredPlaceholders` — the eval-report
      aggregation itself is `injection-guard`'s scope, not built here). 67 tests total.
- [x] Holdback buffer + tool-call assembler per TSD §7.3 —
      `apps/gateway/src/stream/{holdback-buffer,tool-call-assembler,processor}.ts`. Includes the
      random-chunk-split property test (Working rule 7, 50 trials) and a real end-to-end round
      trip against a really-bound `mock-split-placeholder` server
      (`apps/gateway/test/pii-round-trip.e2e.test.ts`) — mask → send (echoed one char at a time)
      → restore, byte for byte.
- [x] Acceptance (TSD §15 M2): `mock-echo` and `mock-split-placeholder` round-trip correctly under
      random chunk splits — done (stage 4). `pii-id` wired into the real
      `/v1/chat/completions` pipeline (config-driven per tenant, `public/guards.ts`),
      non-streaming reuses the same `checkText`/`checkToolCall` calls (`apply-output-guards.ts`,
      TSD §7.3's last line). "No raw PII in ... audit rows" asserted end to end via the real
      `openai` SDK against a really-bound gateway + mock-upstream
      (`apps/gateway/test/pii-guard-wiring.e2e.test.ts`) — non-streaming round-trip with an audit
      row inspected directly for raw PII, and a streaming round-trip through
      `mock-split-placeholder`.
