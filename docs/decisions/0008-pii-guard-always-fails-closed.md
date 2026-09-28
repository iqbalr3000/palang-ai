# 0008 — `pii-id` always fails closed

`docs/TSD.md` §5.1 applies the tenant's `failure_mode` to every guard: on a timeout or error,
`fail_closed` blocks the request and `fail_open` lets it through with a flag. Decided 2026-09-28
during `hardening`, after a code review found that a malformed `tool_calls` value made the
`pii-id` input guard throw halfway through masking — under `fail_open` the rest of the messages,
PII included, went to the model provider unmasked.

**Decision:** errors and timeouts in the `pii-id` guard (input masking and output restore) always
block, whatever the tenant's `failure_mode` — and in `monitor` mode too, which would otherwise
downgrade the error to a flag and send the request on. Every other guard keeps following
`failure_mode` and `mode`. Implemented as a per-guard `failClosed` runtime option.

**Why:** `fail_open` makes sense for detectors — a broken injection scanner shouldn't take an app
down. `pii-id` is a data-protection step: failing open means sending exactly the data it exists
to keep in, so it isn't a safe fallback for any tenant.

**Offered alternative:** keep following `failure_mode` (consistent with TSD §5.1). Not chosen.
