# Deploying Palang

`docker compose up` in the repo root runs Palang with your own `.env` and `palang.yaml` (see the
README). This page covers what to check before real traffic goes through it; what Palang can't do yet
is in the README's [known limitations](../README.md#known-limitations). The demo (`docker/demo.compose.yml`) has public secrets and is never meant to be deployed.

## Production checklist

**Network**

- [ ] Only the gateway's public port (`8080`) is reachable by your apps.
- [ ] The admin API (`8081`) is **never** exposed publicly. It's loopback-only by default
      (`server.admin_host`); if the dashboard runs on another host, open it to that host only.
- [ ] The dashboard (`3000`) is **not** on the public internet. Put it behind a VPN or an
      authenticating proxy (see [sign-in limits](../README.md#known-limitations)).
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

See [Known limitations](../README.md#known-limitations) in the README.
