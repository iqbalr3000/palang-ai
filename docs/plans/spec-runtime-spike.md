# Runtime spike — spec

Feature entry: `docs/plans/roadmap.md`. Source of acceptance criteria: `docs/TSD.md` §15 M0. This
records decisions on top of that section, not a restatement of it.

## Scope

Covers: proving three risky integration points work on Bun before investing in the `gateway-core`
monorepo scaffold. Nothing here is production code.

1. Hono on Bun proxies streaming SSE with real incremental delivery (not buffered).
2. `@huggingface/transformers` classifies text under Bun. (Originally scoped as "forced onto the
   WASM backend" — dropped after spiking; see Design table below.)
3. Drizzle + postgres-js connects and runs a migration under Bun.

Explicitly out of scope: any code under `apps/` or `packages/`; final classifier model selection
(TSD §16 open question #2, an `injection-guard` decision); `docker-compose.yml` (an
`dashboard-launch`/`gateway-core` concern — writing it now would describe services that don't exist
yet); anything not needed to answer "does this work on Bun."

Output: `docs/spike-results.md` with findings, timings, and a go/no-go per item. If any item fails,
this doc records the fallback taken (e.g. `onnxruntime-web` directly) before `gateway-core` starts.

## Design

| Point | Decision | Why |
|---|---|---|
| Code location | `spike/` at repo root, outside Bun workspaces | Throwaway; deleted or archived once `gateway-core` scaffolds `apps/`/`packages/` for real. Avoids committing to a package layout before this proves the risky parts even work. |
| Transformers.js backend | **Superseded — use the default native backend (`onnxruntime-node`), not WASM.** Original plan was to force WASM; dropped 2026-09-17 after spiking (see `docs/spike-results.md`). | `device: "wasm"` turned out to be structurally unavailable under Bun — `@huggingface/transformers` detects Node-vs-browser via `process.release.name === 'node'`, which Bun reports true for (Node compat), so it always takes the native-`onnxruntime-node` code path and never registers `wasm` as a valid device, regardless of which dist bundle is imported. Forcing it anyway would require monkeypatching `process.release` (confirmed to work as a diagnostic, rejected for production — relies on an undocumented internal check that can silently break on any library update) or bypassing `pipeline()` to call `onnxruntime-web` directly (real option, not needed — see result). Native turned out to just work: no missing-binding errors under `bun run` or `bun build --target bun`, and it's the standard/expected choice for the Node.js consumers of the future `@palang/guards` npm package anyway (decision 0002). |
| How the gateway itself runs | Tested **both** `bun run` (direct execution) and `bun build --target bun` (bundled) against the same classifier code | Confirms the classifier works whichever way `apps/gateway` ends up deployed, and separately de-risks the `@palang/guards` npm-publish build step (decision 0002). Both passed — see `docs/spike-results.md`. |
| Classifier model for spike | `Xenova/distilbert-base-uncased-finetuned-sst-2-english` (mechanics-only), not `meta-llama/Llama-Prompt-Guard-2-22M` as originally planned | The community ONNX mirror tried for Llama-Prompt-Guard-2-22M (`gravitee-io/...`) uses a Python/optimum file layout, not the `onnx/model.onnx` layout `@huggingface/transformers` expects — 404s on load. `protectai/deberta-v3-base-prompt-injection-v2` (TSD's other candidate) does have the right layout but is a 739MB fp32-only ONNX export with no quantized variant, too heavy to pull just to prove runtime mechanics. Swapped to a known-good small transformers.js example model instead, since the spike proves mechanics, not detection quality — final model choice stays an `injection-guard` decision (TSD §16 open question #2), which now also needs to account for this file-layout/size reality when picking. |
| SSE test target | Minimal mock SSE endpoint, no provider API key | Matches TSD goal 1.3.9 (`docker compose up` works without any provider key). Reusable groundwork for `apps/mock-upstream` in `gateway-core`. |
| SSE verification method | Mock server emits chunks on a deliberate delay (e.g. every 300ms); Hono relays without waiting for completion; client logs a timestamp per chunk received | Confirms Bun/Hono actually streams (timestamps spread out) rather than buffering the whole response (timestamps clustered at the end) — the literal thing TSD §15 M0 asks to verify. |
| Postgres for migration test | Ad hoc `docker run postgres:16`, no compose file | `docker-compose.yml` is a later concern; writing it now would describe services (gateway, dashboard) that don't exist yet. |

## Execution order

Staged, not parallel — highest-risk item first so a failure (and its fallback) is known before spending time on the other two:
1. Transformers.js / ONNX (both `bun run` and `bun build`). **Done.**
2. SSE streaming (Hono on Bun). **Done.**
3. Drizzle + postgres-js migration. **Done.**

## Engineering tasks

Matches TSD §15 M0 checklist:
- [x] Transformers.js classifies text on Bun under both `bun run` and `bun build`; latency recorded against TSD §10.1's budget (native backend, WASM dropped — see Design table).
- [x] SSE chunks verified arriving incrementally via timestamps, not buffered.
- [x] Drizzle + postgres-js runs a migration against a real Postgres 16 instance under Bun.
- [x] `docs/spike-results.md` written with findings and a go/no-go per item.
