# 0005 — L2 classifier: keep protectai fp32, make it opt-in, drop the L2 latency budget

`docs/TSD.md` §6.2 targets p95 < 60 ms per 512-token window for the L2 classifier, and §10.1
budgets p95 ≤ 80 ms for guard overhead "including L2". Decided 2026-09-21, during
`injection-guard` stage 3, after the benchmark (`evals/src/bench.ts`) missed it by roughly an order
of magnitude. `spec-injection-guard.md` had already named the two ways out: quantize to int8, or
revise the budget through a record like this one.

**Decision:**
- L2 stays `protectai/deberta-v3-base-prompt-injection-v2` in fp32.
- L2 is **opt-in per tenant**: `classifier.enabled` defaults to `false`. With it off, the guard is
  L1-only and inside the ≤ 10 ms budget.
- TSD §10.1's "including L2 ≤ 80 ms" row is withdrawn rather than met. It is replaced by the
  measured numbers below, documented as a known limitation (TSD §10.3) once the README exists.
- int8 (dynamic quantization) is **not** adopted. The `dtype: "q8"` option stays in the classifier
  and eval tooling only so the comparison below can be reproduced.

**Evidence** (Apple M1, Bun 1.3.12; reports in `evals/results/`):

| One 512-token window | p50 | p95 |
|---|---|---|
| fp32, 2 threads | 812 ms | 962 ms |
| fp32, default threads | 594 ms | 620 ms |
| int8, 2 threads | 455 ms | 524 ms |

A short chat message (~48 tokens) takes ~50–117 ms in fp32. int8 was only ~1.8× faster and cost
most of the accuracy (held-out test, flag ≥ 0.5):

| | Recall | FPR | Recall ID | Recall EN |
|---|---|---|---|---|
| L1 | 48.3% | 22.9% | 51.6% | 41.7% |
| L2 fp32 | 81.2% | 27.1% | 71.9% | 100% |
| L2 int8 | 31.6% | 2.4% | 41.7% | 11.5% |
| combined fp32 | 92.4% | 39.9% | 88.5% | 100% |

Other things the eval turned up, relevant to how far to trust L2:
- FPR is high on Indonesian (30.7% vs 19.8% EN) and on `benign_hard` (58%); plain benign text is
  8.3%. The combined layer's FPR (39.9%) is too high for `enforce` mode — `monitor` is the intended
  use.
- The model scores long, low-entropy benign text as an injection: one benign sentence repeated 26×
  scores 0.96, and templated prose climbs from 0.02 (250 tokens) to 0.97 (1000 tokens). Real long
  documents were not tested; it matters because tool output is the long text indirect injection
  lives in.

**Caveats on the numbers:** measured on an M1, not a 2 vCPU x86 container (real numbers are
probably worse); the dataset is synthetic and skewed toward `benign_hard`, so absolute FPR is not
production-representative.

**Not decided / explicitly deferred:**
- Running L2 off the critical path (async, monitor-only) instead of inline.
- Measuring on a 2 vCPU Linux container.
- Better quantization (static/calibrated, per-channel, or keeping attention in fp32) — only naive
  `quantize_dynamic` was tried.
- A smaller or multilingual model, or fine-tuning one on Indonesian data.
- Mitigations for the length bias. `maxWindows = 8` / `maxInputChars = 16,384` are provisional.

**How the int8 model was produced** (not scripted in the repo):
`onnxruntime.quantization.quantize_dynamic("model.onnx", "model_quantized.onnx",
weight_type=QuantType.QInt8)`, onnxruntime 1.30.0, output placed next to the fp32 file under
`models/<model-id>/onnx/`.

**Why:** user's choice, from the options presented after the benchmark: "Pertahankan, opt-in,
revisi budget."
