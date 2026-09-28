# Tool policy — spec

Feature entry: `docs/plans/roadmap.md`. Source of scope/acceptance criteria: `docs/TSD.md` §15 M4,
§6.3 (`canary`), §6.4 (`tool-policy`), §7.3 (stream processor), §12 (mock scenarios). This records
decisions on top of those sections, not a restatement of them. Decisions agreed 2026-09-28.

## Scope

Covers, per TSD §15 M4:
- `packages/guards/src/tool-policy/` — tool-call policy (`OutputGuard.checkToolCall`) with glob
  rules and argument constraints. Standalone-usable per `docs/decisions/0002`.
- `packages/guards/src/canary/` — canary inject (`InputGuard`) and leak check (`OutputGuard`).
- Output PII detection — reworking `pii-id`'s existing `OUTPUT_PII` path so it actually works in
  streaming and closes the open question carried from `spec-pii-guard.md`.
- A boundary-aware cut in `apps/gateway/src/stream/holdback-buffer.ts` (see Design).
- `apps/mock-upstream`: `mock-tool-call` and `mock-leak-canary` scenarios.
- Wiring `canary` and `tool-policy` into the gateway pipeline (config-driven per tenant), streaming
  and non-streaming.
- Fixing the `PHONE_ID` boundary bug found by the stage 5 PII eval (`spec-injection-guard.md`),
  then re-running `bun run eval --suite pii`.

Explicitly out of scope: the other stage 5 PII findings (any 15 digits read as `NPWP`, Luhn/NIK
collisions) — recorded, not fixed; human-in-the-loop tool approval (TSD §1.4); dashboard and
packaging (`dashboard-launch`).

**Acceptance (TSD §15 M4):** `mock-tool-call` and `mock-leak-canary` are blocked/flagged as
configured, streaming and non-streaming.

## Design

| Point | Decision | Why |
|---|---|---|
| Streaming cut splits tokens | `HoldbackBuffer` moves its release point back to the nearest safe boundary: whitespace that isn't between two digits (so `0812 3456 7890` and `4111 1111 1111 1111` stay whole). If there's no safe boundary within a cap (256 chars), it cuts at the normal point. The existing unclosed-`[` rule still applies. | Verified before deciding: with 8-char chunks, a canary or an email is always split across two `checkText` calls, so neither the canary check nor streaming `OUTPUT_PII` could ever see one whole. Guard-agnostic, no `packages/core` type change; the alternative (a per-guard `holdFrom` hook) was rejected as more surface for the same result. The random-chunk-split property test must still pass. |
| Output PII provenance | `pii-id`'s output guard detects PII on the model's **raw** text (before restore), in one pass that restores known placeholders and flags/masks raw PII. A raw value that equals a vault value is flagged `OUTPUT_PII` too. | Closes `spec-pii-guard.md`'s open question. Placeholders aren't PII-shaped, and input was masked, so raw PII in the output was written by the model itself (system prompt, memorization, unmasked context). One pass means a masked value can't be restored right back. |
| Constraint fails on a matching allow rule | Block with `tool_constraint_violated`. The matching rule still wins; there's no fall-through to later rules or `default`. | Predictable, and a broader allow rule further down can't silently let through what a constraint meant to stop. |
| Rule matching | Glob on the tool name, first match wins, else `default` (TSD §6.4). `matchGlob` moves from `apps/gateway/src/util/` to `packages/core` so gateway and guards share it. | `packages/guards` can't import from `apps/`. |
| Argument parsing | Every tool call's arguments are JSON-parsed; failure blocks with `invalid_tool_arguments` (TSD §6.4). | As specified. |
| Constraint semantics | All constraints on a rule must pass. `path` is a dot path; numeric segments index arrays (`items.0.id`). Types are strict: `lt/lte/gt/gte` need numbers, `regex` needs a string (compiled at config load), `in/not_in` take an array (`===` membership), `eq/neq` compare primitives. A missing path or a type mismatch fails the constraint. | Fail closed on anything ambiguous; a numeric string `"1000"` is not coerced. |
| Reason codes | Add `tool_call_denied`, `tool_constraint_violated`, `invalid_tool_arguments`, `canary_leaked` to `packages/core/src/reasons.ts`. A rule's own `reason` from config overrides the default. | TSD §6.4 shows rule-level custom reasons (`destructive_tool`). |
| Canary inject | Only when a system message exists (TSD §6.3). Token `plg-canary-<16 hex>`, guaranteed to contain a letter so no PII detector can read it as a number. Web Crypto only. | Follows TSD; the letter guarantee costs nothing. |
| Canary check | Case-insensitive, in output text **and** tool-call arguments. `block` terminates the stream; `flag` strips the token. The token never appears in findings or audit. | Tool-call arguments are an exfiltration channel too. |
| Pipeline order | Input: canary → pii-id → injection. Output: canary → pii-id → tool-policy (TSD §2), so policy constraints see restored values. | As specified. |
| `mock-tool-call` | Last user message is JSON `{ "name", "arguments" }`; streamed as small argument fragments, and returned as `tool_calls` when not streaming. | Scriptable per test, no per-case scenario needed. |
| `mock-leak-canary` | Replies with text containing the canary found in the system message. | Direct vehicle for the acceptance criterion. |

Known limitation (document in README with `dashboard-launch`): in streaming, text already sent
can't be recalled — a block terminates the stream after whatever was already released.

## Engineering tasks

- [x] `PHONE_ID` leading boundary fix, with tests (card/order numbers no longer yield phones);
      re-run `bun run eval --suite pii` and record the new numbers.
- [x] `HoldbackBuffer` safe-boundary cut; property test still passes; new tests for canary,
      email, and space-grouped numbers never being split.
- [x] `pii-id` output guard: single-pass restore + raw-PII detection; tests for the vault-match
      case, `mask_new_output_pii`, and streaming.
- [x] `matchGlob` moved to `packages/core`.
- [x] `tool-policy` guard: rules, constraints, parsing, reason codes; tests first (Working rule 6).
- [x] `canary` guard: inject + check (text and tool calls); tests first.
- [x] Config schema: constraint `regex` validated at load; canary/tool-policy wired in
      `public/guards.ts` in pipeline order.
- [x] `mock-tool-call` and `mock-leak-canary` scenarios.
- [x] e2e: acceptance scenarios, streaming and non-streaming, enforce and monitor.

## Implementation notes

Decided while building, not separately discussed — flagged for the user to confirm or overrule:
- **The canary lives on `ctx.metadata`, not `ctx.canary`.** The pipeline runner calls each guard
  with a shallow copy (`{ ...ctx, signal }`), so a canary assigned to `ctx.canary` by the input
  guard never reached the output guard. `ctx.metadata` is shared (the same pattern
  `piiRestoredPlaceholders` uses). The now-dead `canary?` field was removed from `GuardContext`;
  TSD §5 still lists it.
- **`PHONE_ID` lookbehind is `(?<!\d[\s.-]?)`**, not just `(?<!\d)`: after the first fix, one
  false positive remained — a phone read from a group in the middle of a space-grouped voucher
  (`7953 0806 4480 8778`). Same bug class, so it was fixed here too, with a test.
- **Mock `Scenario.reply` returns `{ content } | { toolCall }`** instead of a string, so a scenario
  can answer with a tool call; `mock-echo`/`mock-split-placeholder` were adapted.
- **Empty tool arguments (`""`) are invalid JSON and get blocked** (`invalid_tool_arguments`), per
  TSD §6.4's literal rule. Some providers send `""` for no-parameter tools; if that shows up in
  practice it needs a decision.
- **`tool-policy` findings** carry the tool name, rule index, and the failed constraint's
  index/path/op — never argument values.

## Results

- PII eval after the `PHONE_ID` fix (`bun run eval --suite pii`, supported formats): `PHONE_ID`
  precision 77.4% → 100%, `CARD` recall 72.4% → 98.1%; overall precision 87.2% → 93.0%, recall
  94.9% → 99.7%; hard negatives with a false detection 23.3% → 17.3%. Restore round trip still
  100% with zero `restore_miss`. The published report (`evals/results/2026-09-28-*`) predates the
  fix and wasn't regenerated.
- Remaining false positives are the recorded, out-of-scope ones (15 digits as `NPWP`, Luhn/NIK
  collisions).

## Open questions

None yet.
