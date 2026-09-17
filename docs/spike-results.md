# Runtime spike — results

Spec: `docs/plans/spec-runtime-spike.md`. Bun 1.3.12, macOS arm64 (spike host — not the eventual
Linux container target; native-binding results should be re-checked there before `gateway-core`
ships).

## 1. Transformers.js / ONNX — GO (native backend, not WASM)

**Original plan:** force the WASM (`onnxruntime-web`) backend. **Dropped.**

`device: "wasm"` throws `Unsupported device: "wasm". Should be one of: coreml, webgpu, cpu.` under
Bun, regardless of whether `@huggingface/transformers`'s Node or web dist bundle is imported. Root
cause, found in `src/backends/onnx.js`:

```js
const IS_NODE_ENV = process?.release?.name === 'node';
if (IS_NODE_ENV) { ONNX = ONNX_NODE; /* wasm never added to supportedDevices */ }
else             { ONNX = ONNX_WEB;  supportedDevices.push('wasm'); }
```

Bun reports `process.release.name === "node"` (Node-compat shim: `bun -e "console.log(process.release)"`
→ `{ name: "node", ... }`), so transformers.js always takes the native-`onnxruntime-node` branch on
Bun — the library has no separate Bun detection. Confirmed (diagnostically only, not for production)
by monkeypatching `process.release` before import: the WASM branch then activates and progresses
past the device check, to a model-file-404 error unrelated to the device itself — proving the WASM
path is mechanically reachable, just not through transformers.js's supported public API on Bun.

**Decision:** use the native backend as-is; see `docs/plans/spec-runtime-spike.md` Design table for
the full reasoning (native works, is portable enough via prebuilt binaries, and is the expected
choice for `@palang-ai/guards`'s future Node.js npm consumers per decision 0002).

**Model note:** `meta-llama/Llama-Prompt-Guard-2-22M` (the spec's original pick) has no
transformers.js-ready community ONNX mirror — `gravitee-io/Llama-Prompt-Guard-2-22M-onnx` uses a
Python/optimum file layout (`model.quant.onnx` at repo root), not the `onnx/model.onnx` layout
`@huggingface/transformers` expects, and 404s on load. `protectai/deberta-v3-base-prompt-injection-v2`
(TSD's other candidate) has the right layout but is `onnx/model.onnx` fp32 only, 739MB, no quantized
variant — too heavy to pull for a mechanics-only spike. Substituted
`Xenova/distilbert-base-uncased-finetuned-sst-2-english` (small, known-good transformers.js example,
proper `onnx/` layout with a quantized variant) purely to prove the runtime mechanics. **Final
classifier model choice remains an open `injection-guard` decision** (TSD §16 open question #2), and
must now also weigh file-layout availability and size, not just license/accuracy.

**Results (`bun run`, native backend, no device override):**
- Load (cold, includes model download): 89.5s.
- Inference, first pass: 12.8–15.5ms per sample.
- Inference, warm pass: 10.7–11.2ms per sample.

**Results (`bun build --target bun`, then run the bundled output):**
- `bun build` succeeded with zero errors or warnings — no `--external` needed for
  `onnxruntime-node`, contradicting the bundler issue found in prior research (likely specific to a
  different build target/flag combination, not `--target bun`).
- Bundled output ran correctly, exit code 0. Load: 81.2s (includes download again — cache reuse
  across the two runs wasn't verified, not a spike blocker). Inference: 5.4–14.4ms per sample.

Both comfortably clear TSD §10.1's p95 < 60ms/512-token budget, though these are short single
sentences, not full 512-token windows — a real latency benchmark against that exact budget is
`injection-guard` work, not this spike's.

## 2. SSE streaming (Hono on Bun) — GO

Method: mock upstream (`Bun.serve`) emits 5 SSE chunks, 300ms apart, each stamped with
`Date.now()`. A Hono route (`hono/streaming`'s `stream(c, cb)` + `StreamingApi.pipe()`) relays the
upstream `Response.body` to the client without buffering it. Client reads via
`response.body.getReader()` and timestamps each chunk on arrival.

**Result:** inter-chunk deltas on the client were 289.1–307.5ms — matching the injected 300ms delay
almost exactly, not clustered at the end. Confirms Bun + Hono's `stream()`/`pipe()` genuinely streams
the response; nothing in the gateway layer buffers it. This is the literal mechanism
`apps/gateway/src/stream/` will sit on top of for the real holdback buffer.

```
[client] +366.7ms chunk-0
[client] +655.9ms chunk-1  (Δ 289.1ms)
[client] +955.2ms chunk-2  (Δ 299.3ms)
[client] +1255.7ms chunk-3 (Δ 300.5ms)
[client] +1563.2ms chunk-4 (Δ 307.5ms)
```

Not separately tested under `bun build` — the risk `bun build` posed for item 1 was specific to
`onnxruntime-node`'s native binding, which doesn't apply to Hono/Web Streams.

## 3. Drizzle + postgres-js migration — GO

Ad hoc `docker run postgres:16` (no compose file, per spec). `drizzle-kit generate` produced a SQL
migration from a one-table dummy schema; `drizzle-orm/postgres-js/migrator`'s `migrate()` applied it
under Bun, then an insert + read-back through the same `postgres-js` driver confirmed the connection
works end to end, not just the migration step.

**Result:** migration applied in 67.3ms. Insert/read-back round-tripped correctly (UUID default,
`timestamp with time zone` default, both handled as expected). No Bun-specific issues encountered —
matches the research finding from before this spike started (postgres-js has been Bun-compatible
since Bun v0.5).

## Overall: GO for `gateway-core`

All three items cleared, none blocked. Two scope corrections came out of this spike, both recorded
in `docs/plans/spec-runtime-spike.md`'s Design table:
1. Drop "force WASM" for the classifier — use the native `onnxruntime-node` backend as-is.
2. Final `injection-guard` classifier model choice now also needs to account for ONNX file-layout
   availability and file size, not just license/accuracy (TSD §16 open question #2) — the two
   candidates named in TSD §6.2 both had real friction (wrong layout / no quantized variant, 739MB).

Spike code lives in `spike/` (three subfolders: `onnx-classifier/`, `sse-streaming/`,
`pg-migration/`) — throwaway, per spec; safe to delete once `gateway-core` scaffolds `apps/`/`packages/`
for real.
