# Launch — spec

Feature entry: `docs/plans/roadmap.md`. The last v0.1 feature (TSD §15 M5, the part left after
`admin-api` and `dashboard`): make Palang runnable in minutes, measured, and tagged. Decisions
agreed 2026-09-29.

## Scope

1. **`docker compose up` with a working demo.** Postgres, a one-shot migration, gateway,
   dashboard and mock-upstream, with a seeded `demo` tenant, a fixed demo API key and sample
   traffic so the dashboard isn't empty. Target: TSD's quickstart under 5 minutes.
2. **Gateway benchmark report.** Guard overhead p95 and added time-to-first-token (gateway vs.
   mock-upstream directly), against TSD §10.1's budgets (≤ 10 ms and ≤ 100 ms p95).
3. **Dependency audit in CI** (TSD §10.2).
4. **`examples/`**: `openai-sdk.ts` (through the gateway, runs against the compose demo) and
   `in-process.ts` (`@palang-ai/guards` used directly).
5. **`docs/deployment.md`**: the known limitations (TSD §10.3) and a production checklist,
   including that the admin API and the dashboard must not be publicly exposed (TSD §10.2).
   README gets one line linking to it.
6. **`@palang-ai/guards` ready for npm**: built to JavaScript + type declarations, publishable
   metadata. The user now has an npm account (2026-09-29, reversing the earlier deferral) and runs
   `npm publish` themselves.
7. **Release `v0.1.0`**: versions bumped, tag, release notes drafted by the agent and published by
   the user.

Out of scope: publishing container images, a CHANGELOG file, the demo video and blog post (the user's own).

## Design

| # | Decision | Why |
|---|---|---|
| 1 | Images are **built locally** by `docker compose up --build`; nothing is pushed to a registry. The README keeps saying images are coming. | Avoids multi-arch builds of `onnxruntime-node` (slow under QEMU) and the LGPL distribution obligations for `sharp`/libvips that come with publishing images. |
| 2 | Migrations run in a **one-shot `migrate` service** using `drizzle-orm`'s built-in migrator; `bun run db:migrate` switches to the same script. `drizzle-kit` stays for `generate` only. | No `drizzle-kit` in the image, and the gateway never changes the schema at boot (no race with several instances). |
| 3 | Debian-slim base images: `oven/bun` for the gateway, mock-upstream and migrate; `node:22-slim` for the dashboard (Next standalone). | `onnxruntime-node` needs glibc, so no Alpine. Matches TSD §3's container choices. |
| 4 | The injection classifier is **imported lazily**, only when a tenant enables it. The model is not in the image. | Today `@huggingface/transformers` loads at boot even with the classifier off. |
| 5 | Demo seed: tenant `demo` (config) pointing only at mock-upstream, a **fixed, documented demo API key** inserted into the DB, and a small script sending ~10 requests (PII, injection, a denied tool call, a canary leak). | The dashboard shows every guard working on first open. The fixed key is only usable against the mock. |
| 6 | Inside compose, the admin API and mock-upstream bind `0.0.0.0` on the internal network; **only 8080 (gateway) and 3000 (dashboard) are published** to the host. | The dashboard container must reach `gateway:8081`, but the admin port stays off the host. |
| 7 | CI runs `bun audit --audit-level=high`. | Today's only finding is moderate and dev-only (esbuild via `drizzle-kit`), so CI stays green. |
| 8 | Benchmark results go to `evals/results/`, with a summary in the README's Evaluation section. | Same place and pattern as the detection eval. |
| 9 | Release: every workspace to `0.1.0`, tag `v0.1.0`, GitHub Release notes. No CHANGELOG file. | The roadmap already logs history; release notes cover users. |

## Risks

- **Next standalone with Bun's `linker = "isolated"`** hasn't been tried in Docker; output tracing
  may not follow the `node_modules/.bun` symlinks. Checked first, before the rest of the images.
- **Gateway image size:** `onnxruntime-node` alone is 287 MB (binaries for every platform). Fine
  for a local build; one more reason not to publish images yet.
- **Quickstart time** depends on image build time on a cold Docker cache; measured once built.

## Engineering tasks

- [x] Spike: dashboard Next standalone build in Docker with the isolated linker.
- [x] Lazy classifier import.
- [x] Programmatic migrator script; `db:migrate` uses it.
- [x] Dockerfiles (gateway, dashboard, mock-upstream/migrate) and `docker-compose.yml`, demo config
      and env.
- [x] Demo seed: fixed key + sample traffic script.
- [x] Gateway benchmark script + first report in `evals/results/`.
- [x] `bun audit --audit-level=high` in CI.
- [x] `examples/openai-sdk.ts`, `examples/in-process.ts`.
- [x] `docs/deployment.md` (limitations + production checklist); README: Docker quickstart first,
      link to deployment doc, benchmark summary.
- [x] `@palang-ai/guards` build (JS + `.d.ts`) and publishable `package.json`.
- [x] Versions to `0.1.0`; draft release notes.
- [x] Verify: fresh clone → `docker compose up --build` → demo works within the quickstart target.

## Implementation notes

Decided while building, not separately discussed — flagged for the user to confirm or overrule:
- **The classifier is an optional dependency.** Inside Docker, `bun install` downloaded the npm
  registry slowly (~50 s for an 8 MB tarball), and `@huggingface/transformers` pulls in
  `onnxruntime-node` (287 MB) and sharp/libvips. With the import already lazy, it became an
  `optionalDependency` of the gateway and the image installs with `--omit optional`: the Bun image
  installs 46 packages in ~7 s and is 326 MB. Enabling the classifier on an install without it
  fails at boot with a clear error. This also means the Docker image ships no LGPL code.
- **One Bun image** serves the gateway, mock-upstream, migrations and the demo seed (different
  commands); the dashboard has its own Node image (431 MB).
- **Ports**: the gateway and dashboard are published on `127.0.0.1` only, not all interfaces, since
  the demo's secrets are public. The admin API isn't published at all.
- **Demo seed** (`gateway/src/demo/seed.ts`) inserts the demo key and sends the sample traffic only
  on the first run, so restarting the stack doesn't duplicate events.
- **`@palang-ai/guards` exports** use a `bun` condition pointing at `src/`, plus `types`/`default`
  pointing at `dist/`. The repo, Docker and Bun consumers keep running the TS source with no build
  step; `tsconfig.base.json` sets `customConditions: ["bun"]` so typechecking follows the same path.
  `src/` (minus tests) ships in the package for Bun users. `prepublishOnly` builds and tests.
- **`examples/` is a sixth workspace**, so its imports resolve and CI typechecks it. `CLAUDE.md`
  updated accordingly.
- **Benchmark** runs in-process (like the e2e tests) against mock-upstream with no delay. Guard
  overhead is the sum of every guard decision's `latencyMs` from the audit rows; added TTFT is
  gateway p95 minus direct p95. The gateway got `./app`, `./audit`, `./auth`, `./config` and
  `./db` exports for it.

## Results

- All 382 tests pass against Postgres 16 (this also covered the earlier refactor commit, whose DB
  tests hadn't run). One full run hit a Bun crash *after* all tests passed (`panic: A C++
  exception occurred` at exit, after loading `onnxruntime-node`); it didn't reproduce in the next
  six runs. A Bun bug, but it could turn CI red occasionally.
- Benchmark (Apple M1, `evals/results/gateway-2026-09-29-095abcb-dirty.md`): guard overhead p95
  1.10 ms (budget 10 ms), added TTFT p95 5.27 ms (budget 100 ms).
- `docker compose up --build` from an empty volume: demo ready in 3 min 49 s on this machine; the
  seed's 10 requests show up in the dashboard (2 injections flagged, 1 canary leak and 2 tool calls
  blocked); `examples/openai-sdk.ts` works against it; the admin port is unreachable from the host.
- `@palang-ai/guards` builds, imports and masks/restores on plain Node from `dist/`;
  `npm pack --dry-run`: 178 files, 39 kB, no tests.
- `bun audit --audit-level=high` passes (one moderate, dev-only finding: esbuild via `drizzle-kit`).
