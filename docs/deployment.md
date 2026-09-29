# Deploying Palang

The `docker compose` setup in the repo root is a **demo**: fixed secrets, a mock model, and every
port bound to `127.0.0.1`. This page covers what changes for a real deployment, and what Palang
can't do yet.

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
- [ ] None of the demo values from `docker-compose.yml` are reused.

**Guards**

- [ ] Every guard started in `monitor` and was switched to `enforce` only after reviewing
      would-blocks in the dashboard.
- [ ] `tool-policy` uses `default: deny` and lists every tool your agents call.
- [ ] `failure_mode` is a deliberate choice per tenant (`pii-id` fails closed regardless).

**Data**

- [ ] `audit.content_mode` fits your data policy: `redacted` (default) stores content with PII
      and the canary masked, `hash` stores only hashes, `none` stores nothing.
- [ ] `audit.retention_days` matches your retention policy, and Postgres is backed up.
- [ ] Migrations run before the gateway starts (`bun run db:migrate`, or the compose `migrate`
      service).

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
- **Any 15-digit number is read as an NPWP.**
- **Dashboard sign-in is rate-limited globally**, not per IP (client IPs can be forged without a
  trusted proxy). Someone guessing nonstop can lock the real admin out too.
- **Only OpenAI-compatible providers** are supported.
- **`logprobs` are dropped** from requests and responses, since they'd expose unguarded output.
  The legacy `functions`/`function_call` API is rejected with a 400; use `tools`.
- **Config is read at startup**; changing `palang.yaml` needs a gateway restart.
