# Deploying Palang

`docker compose up` in the repo root runs Palang with your own `.env` and `palang.yaml` (see the
README). This page covers what to check before real traffic goes through it, and what Palang can't
do yet. The demo (`docker/demo.compose.yml`) has public secrets and is never meant to be deployed.

## Production checklist

**Network**

- [ ] Only the gateway's public port (`8080`) is reachable by your apps.
- [ ] The admin API (`8081`) is **never** exposed publicly. It's loopback-only by default
      (`server.admin_host`); if the dashboard runs on another host, open it to that host only.
- [ ] The dashboard (`3000`) is **not** on the public internet. Put it behind a VPN or an
      authenticating proxy (see [sign-in limits](#known-limitations)).
- [ ] TLS terminates in front of the gateway and the dashboard. If your proxy sets
      `X-Forwarded-Proto: https`, the dashboard session cookie is marked `Secure`.
- [ ] Your reverse proxy doesn't buffer streaming responses (the gateway sends
      `X-Accel-Buffering: no` for nginx).

**Secrets**

- [ ] `PALANG_ADMIN_TOKEN` is at least 32 random bytes (`openssl rand -hex 32`). The dashboard
      session key is derived from it, so rotating it signs everyone out.
- [ ] `DASHBOARD_PASSWORD` is unique and at least 12 characters.
- [ ] Provider API keys come from the environment via `${VAR}` in `palang.yaml`, never written in
      the file itself.
- [ ] None of the demo values from `docker/demo.compose.yml` are reused.

**Guards**

- [ ] Every guard started in `monitor` and was switched to `enforce` only after reviewing
      would-blocks in the dashboard.
- [ ] `tool-policy` uses `default: deny` and lists every tool your agents call.
- [ ] `failure_mode` is a deliberate choice per tenant (`pii-id` fails closed regardless).

**Data**

- [ ] `audit.content_mode` fits your data policy: `redacted` (default) stores content with PII
      and the canary masked, `hash` stores only hashes, `none` stores nothing.
- [ ] `audit.retention_days` matches your retention policy, and Postgres is backed up.
- [ ] Migrations run before the gateway starts (the compose `migrate` service does this, or
      `bun run db:migrate` from source).
- [ ] The compose Postgres has fixed credentials, so it stays unpublished (only the compose
      network can reach it).

**Operations**

- [ ] `/readyz` (checks the database) is your readiness probe; `/healthz` is liveness.
- [ ] Prometheus scrapes `/metrics` on the admin port, with the admin token.
- [ ] The gateway gets `SIGTERM` on shutdown, so in-flight streams finish and the audit queue
      drains.

## Known limitations

- **Audit events can be lost** on a crash or under overload: the queue lives in memory and drops
  events rather than slowing requests down. `palang_audit_dropped_total` counts the losses.
- **A streaming block can't recall text already sent.** Output guards hold back a small window,
  but a block mid-stream ends the response after earlier text reached the client.
- **The model may paraphrase placeholders**, which makes restore miss them. The eval measures this
  as `restore_miss`.
- **Injection detection is weaker in Indonesian** than in English, and its false-positive rate is
  too high to block on; keep `injection` in `monitor`.
- **A plain NPWP is masked only when labeled.** Formatted NPWPs (`01.234.567.8-901.000`) always
  are; a plain 15- or 16-digit one needs a word like "NPWP" or "tax ID" shortly before it, so a bare
  number in a pasted table row passes through.
- **Long numeric IDs can be masked as cards.** Card detection relies on the Luhn check, which
  about one in ten random 13–19-digit numbers (order IDs, virtual accounts, transfer references)
  also passes. They're restored in the reply, but the model sees a placeholder.
- **Dashboard sign-in is rate-limited globally**, not per IP (client IPs can be forged without a
  trusted proxy). Someone guessing nonstop can lock the real admin out too.
- **Only OpenAI-compatible providers** are supported.
- **`logprobs` are dropped** from requests and responses, since they'd expose unguarded output.
  The legacy `functions`/`function_call` API is rejected with a 400; use `tools`.
- **Config is read at startup**; changing `palang.yaml` needs a gateway restart.
