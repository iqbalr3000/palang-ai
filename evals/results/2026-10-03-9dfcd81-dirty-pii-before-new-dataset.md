# Eval report — 9dfcd81 (uncommitted changes)

Generated 2026-10-03T08:07:56.588Z. Reproduce with `bun run eval`.

## PII

600 samples: 350 positive, 50 unsupported_format, 50 unlabeled, 150 hard_negative.

- Samples are synthetic and template-generated (`evals/src/generate/pii/`), not real data.
- A detection counts only on an exact type + start + end match with the gold span.
- `unsupported_format` holds real-world spellings the detector doesn't claim to handle (spaced NIK, `[at]` emails); it's excluded from the first table.
- `unlabeled` holds plain NPWPs with no NPWP keyword before them. The detector requires one for plain NPWPs, so these measure what that rule costs; they're excluded from the first table.
- The detectors were not tuned against this dataset.

### Detection — supported formats

| Entity | Precision | Recall | F1 | TP/FP/FN |
|---|---|---|---|---|
| NIK | 96.6% | 100.0% | 98.3% | 113/4/0 |
| NPWP | 78.9% | 86.8% | 82.7% | 105/28/16 |
| PHONE_ID | 99.0% | 82.2% | 89.8% | 97/1/21 |
| EMAIL | 100.0% | 100.0% | 100.0% | 109/0/0 |
| CARD | 84.1% | 98.4% | 90.7% | 127/24/2 |
| overall | 90.6% | 93.4% | 92.0% | 551/57/39 |

### Unlabeled NPWP

Recall 52.0% (26/50).

### Detection — all samples

| Entity | Precision | Recall | F1 | TP/FP/FN |
|---|---|---|---|---|
| NIK | 96.6% | 85.0% | 90.4% | 113/4/20 |
| NPWP | 82.4% | 76.6% | 79.4% | 131/28/40 |
| PHONE_ID | 99.0% | 82.2% | 89.8% | 97/1/21 |
| EMAIL | 100.0% | 78.4% | 87.9% | 109/0/30 |
| CARD | 82.5% | 98.4% | 89.8% | 127/27/2 |
| overall | 90.6% | 83.6% | 87.0% | 577/60/113 |

### Hard negatives

34/150 hard-negative samples (22.7%) had at least one false detection. By type: NIK 2, NPWP 16, PHONE_ID 0, EMAIL 0, CARD 16.

### Restore round trip

Masked text streamed through mock-upstream and the gateway's stream processor with the `pii-id` output guard. Success = output equals the masked text with each placeholder replaced by its vault value (the normalized form, e.g. phones as `+62…`). Only samples that got at least one placeholder count.

| Scenario | Samples | Succeeded | Success rate | restore_miss |
|---|---|---|---|---|
| mock-echo | 400 | 400 | 100.0% | 0 |
| mock-split-placeholder | 400 | 400 | 100.0% | 0 |

Detection latency per sample: p50 0.010 ms, p95 0.017 ms.

