# Hardening — spec

Feature entry: `docs/plans/roadmap.md`. Fixes every finding of the whole-project security review
and code review run on 2026-09-28, before the repo goes public and before `launch`. Decisions
agreed 2026-09-28; one of them is `docs/decisions/0008`.

## Scope

All fifteen findings (numbering from the review):

1. ReDoS in `detectPii` — the email pattern (and `PHONE_ID`'s `@` lookahead) is quadratic on long
   runs without `@`; ~1.3 s at 40 KB, minutes at the 1 MB body limit, blocking every tenant.
2. A malformed `messages[].tool_calls` makes `pii-id` throw mid-masking; under `fail_open` the rest
   goes upstream unmasked. `tool_calls` isn't Zod-validated (Working rule 9).
3. The holdback buffer's forced cut (no safe boundary within 256 chars) can split a canary or PII
   across two released segments, so output guards never see it whole.
4. Streaming isn't SDK-compatible: the `role` delta (and `refusal`/`logprobs`) is dropped, and
   streamed tool calls carry no `index` — `finalChatCompletion()` throws `missing role for
   choice 0` in the official SDK.
5. Both servers bind every interface; the admin API should default to loopback.
6. An unclosed `[` holds all later output until the stream ends, and rescanning is quadratic.
7. Streaming responses carry no `Content-Type: text/event-stream`.
8. `last_used_at` is never written (drizzle queries are lazy; `void` never runs them).
9. Audit gaps: an aborted stream gets no row; a tool-argument overflow is recorded as `allow`;
   streamed `usage` is never stored.
10. A malformed JSON body returns 500 instead of 400.
11. Upstream error responses are forwarded with all their headers (mismatched `content-encoding`,
    leaked provider headers).
12. Dashboard login has no rate limit.
13. `bun run setup` writes `.env` world-readable (0644).
14. The dashboard sends no anti-framing / hardening headers.
15. Logout doesn't revoke the session (stateless cookie, valid for 12 h).

Explicitly out of scope: new features; the other known limitations in the README.

## Design

| # | Decision | Why |
|---|---|---|
| 1 | Bound the email pattern (local part ≤ 64, domain ≤ 253, per RFC 5321) and `PHONE_ID`'s `@` lookahead; a regression test runs worst-case 1 MB inputs within a time budget. | Linear time on any input; the bounds are the real limits of an address. |
| 2 | Zod-validate `tool_calls` (and message shape) in the request schema → 400 on malformed input. **`pii-id` errors and timeouts always block**, whatever `failure_mode` (decision 0008). | Agreed. Validation stops the known trigger; failing closed covers the unknown ones. |
| 3 | Keep the forced cut; the `canary` and `pii-id` output guards keep the last ~32 characters of the previous segment (on `ctx.metadata`) and scan *carry + segment*. A token found across the boundary ends the response (already-sent text can't be recalled). | Agreed over "never cut": legitimate long unspaced output (base64, URLs) keeps streaming. |
| 4 | Forward non-content delta fields (`role`, `refusal`, …) as they arrive; emit each assembled tool call with its `index`. Verified with the official SDK's `finalChatCompletion()`. | OpenAI's streaming contract. |
| 5 | `server.admin_host` (default `127.0.0.1`) and `server.public_host` (default `0.0.0.0`). | The admin API is private by default; containers set it explicitly. |
| 6 | Hold from an unclosed `[` only when it's within the last 32 characters (the longest placeholder); bound the bracket scan. | A `[` further back can't start a placeholder. |
| 7 | `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` on streams. | SSE clients and nginx. |
| 8 | Actually execute the `last_used_at` update, with a `.catch()` that logs. | Without the catch, a rejection would crash Bun (it exits on unhandled rejections — verified). |
| 9 | Record streams in a `finally`: a client disconnect is recorded with status 499; a tool-argument overflow as `block` (`tool_arguments_too_large`); streamed `usage` stored. | Every request leaves exactly one audit row. |
| 10 | Malformed JSON → 400 `invalid_request`; a JSON `onError` handler for anything unexpected. | Correct status; no retry storms. |
| 11 | Forward only `content-type`, `retry-after` and `x-ratelimit-*` from upstream error responses. | Clients keep rate-limit info; nothing else leaks or mismatches. |
| 12 | Global progressive delay on failed logins (grows with recent failures, capped at ~30 s; never a lockout); `DASHBOARD_PASSWORD` must be ≥ 12 characters (checked at startup). | Agreed: not spoofable like per-IP limits, and the admin can always get in. |
| 13 | `bun run setup` writes `.env` with mode 0600. | Secrets readable by the owner only. |
| 14 | `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` on every dashboard response. | Anti-clickjacking and basic hardening. |
| 15 | Session tokens get a random ID; logout records it in an in-memory denylist until the token's expiry, and verification rejects denylisted IDs. | Agreed. No new storage; a dashboard restart forgets the list (tokens still expire within 12 h). |

Every fix comes with a regression test that fails on the old code.

## Engineering tasks

- [x] 1 ReDoS bounds + worst-case timing test.
- [x] 2 Request schema for messages/`tool_calls`; `pii-id` always fails closed.
- [x] 3 Cross-boundary carry in `canary` and `pii-id` output guards.
- [x] 4 Forward role/other delta fields; tool-call `index`; SDK helper test.
- [x] 5 `admin_host` / `public_host`.
- [x] 6 Bracket hold bound.
- [x] 7 SSE headers.
- [x] 8 `last_used_at` executed with `.catch()`.
- [x] 9 Stream recording in `finally`, 499, overflow as block, streamed usage.
- [x] 10 400 on malformed JSON, JSON `onError`.
- [x] 11 Upstream error header allowlist.
- [x] 12 Progressive login delay; password minimum length.
- [x] 13 `.env` mode 0600.
- [x] 14 Dashboard security headers.
- [x] 15 Session IDs + logout denylist.
- [x] 16 (found while building) Tool-call assembler size check made linear.
- [x] README: document the new config keys, the password minimum and the behavior changes.

## Found while building

16. **The tool-call assembler re-encoded all arguments so far on every delta** to check the size
    cap, which is quadratic: 300 KB streamed 4 bytes at a time took ~18 s of event-loop time. Same
    class as #1, reachable by prompting the model into a long tool call, so it was fixed here
    (bytes counted per delta).

## Implementation notes

Decided while building, not separately discussed — flagged for the user to confirm or overrule:
- **#1:** besides the length bounds, a lookbehind makes the email pattern start only at the
  beginning of a run, and overlap checking in `detectPii` uses a claimed-character map (the
  per-candidate scan of every accepted span was also quadratic: `1-1-1-…` produces ~31k valid
  NIKs). Worst-case 1 MB inputs now take under 200 ms; before, the test didn't finish in 10 min.
- **#2:** implemented as a per-guard `failClosed` runtime option in the pipeline runner. It
  overrides `monitor` mode as well as `fail_open`, since monitor would otherwise also downgrade a
  masking error and send the request on (decision 0008 updated to say so).
- **#3:** `pii-id` carries 128 characters, not ~32, so realistic emails straddling a cut are still
  found. A canary straddling a cut always blocks, even with `on_detect: flag`, because its start
  was already sent. Straddling PII is flagged like any output PII, and blocks
  (`output_pii_detected`) only when `mask_new_output_pii` is on, since the masking can no longer
  happen. Tested at every cut position from 200 to 520.
- **#4:** delta fields other than `content`/`tool_calls` are forwarded as they arrive; tool calls
  get their position as `index`.
- **#9:** a stream that throws without the client having disconnected is recorded as 502. The
  overflow block is recorded with `blocked_by = "stream"` and reason `tool_arguments_too_large`.
  `mock-upstream` now sends a usage chunk when `stream_options.include_usage` is set, like OpenAI.
- **#12:** the first live test showed a burst of parallel attempts all got a free slot before any
  of them failed; attempts still being checked now count toward the spacing. Live: 40 parallel
  guesses → 8 checked, 32 turned away; the real password still works afterwards. A failed attempt
  still takes at least 500 ms.
- **#15:** the session token is now `expiresAt.id.signature`, so existing dashboard sessions are
  signed out once on upgrade.

## Results

- 362 tests pass (was 331), each fix with a regression test that failed on the old code.
- PII eval on supported formats unchanged (precision 93.0%, recall 99.7%).
- Verified on a live gateway + dashboard: the admin port listens on `127.0.0.1` only, the four
  security headers are sent, a copied cookie is rejected after logout, and the throttle holds
  under parallel guessing.
