# Eval report — e9fab6a (uncommitted changes)

Generated 2026-10-03T08:36:55.195Z. Reproduce with `bun run eval`.

## Injection

L2 model protectai/deberta-v3-base-prompt-injection-v2 (fp32). Predicted `injection` when score ≥ threshold (flag 0.5, block 0.85).

- Samples are synthetic and template-generated (`evals/src/generate/injection/`), not real traffic.
- L1 patterns were tuned against **dev** only. **test** is held out and its phrasing is disjoint from dev's.
- The patterns and the samples were written by the same author, so test numbers are still optimistic compared with unseen real-world attacks.
- `benign_hard` is benign text that deliberately resembles attacks (security discussion, legitimate uses of trigger words); it is where false positives are expected.
- Slices are `lang/register`: formal Indonesian and English, informal Indonesian (slang, abbreviations, leetspeak), and EN-ID code-mixed chat.

### Fixed false-positive rate

Threshold = the lowest score whose **dev** FPR stays within the target, applied unchanged to **test**. `unreachable` means too many benign dev samples share the top score.

| Layer | Target FPR | Threshold | dev recall | dev FPR | test recall | test FPR | test recall id/formal | test recall en/formal | test recall id/informal | test recall mixed/informal |
|---|---|---|---|---|---|---|---|---|---|---|
| l1 | 5.0% | 0.916 | 11.4% | 0.0% | 4.0% | 0.0% | 9.4% | 9.4% | 0.0% | 0.0% |
| l1 | 10.0% | 0.500 | 50.9% | 8.9% | 25.7% | 11.5% | 51.6% | 41.7% | 5.2% | 12.5% |
| l2 | 5.0% | 1.000 | 37.9% | 4.9% | 36.6% | 5.8% | 4.7% | 81.3% | 16.1% | 66.7% |
| l2 | 10.0% | 0.999 | 49.6% | 9.8% | 50.3% | 9.5% | 20.8% | 92.7% | 28.6% | 80.2% |
| combined | 5.0% | 0.999 | 28.8% | 4.9% | 46.3% | 6.1% | 15.1% | 70.8% | 30.2% | 81.3% |
| combined | 10.0% | 0.996 | 34.6% | 9.8% | 52.2% | 9.4% | 25.0% | 70.8% | 37.0% | 85.4% |

### dev (896 samples)

#### l1

| Threshold | n | Precision | Recall | FPR | F1 | TP/FP/TN/FN |
|---|---|---|---|---|---|---|
| flag (≥0.5) | 896 | 85.1% | 50.9% | 8.9% | 63.7% | 228/40/408/220 |
| block (≥0.85) | 896 | 81.0% | 33.3% | 7.8% | 47.2% | 149/35/413/299 |

| Threshold | Slice | n | Recall | FPR benign | FPR benign_hard | Precision | F1 |
|---|---|---|---|---|---|---|---|
| flag | id/formal | 256 | 94.5% | 0.0% | 39.6% | 86.4% | 90.3% |
| flag | en/formal | 128 | 90.6% | 0.0% | 25.0% | 90.6% | 90.6% |
| flag | id/informal | 256 | 0.0% | 0.0% | 14.6% | 0.0% | n/a |
| flag | mixed/informal | 256 | 38.3% | 0.0% | 16.7% | 86.0% | 53.0% |
| block | id/formal | 256 | 60.9% | 0.0% | 29.2% | 84.8% | 70.9% |
| block | en/formal | 128 | 54.7% | 0.0% | 25.0% | 85.4% | 66.7% |
| block | id/informal | 256 | 0.0% | 0.0% | 14.6% | 0.0% | n/a |
| block | mixed/informal | 256 | 28.1% | 0.0% | 16.7% | 81.8% | 41.9% |

| Threshold | Category | n | Metric |
|---|---|---|---|
| flag | direct | 224 | recall 54.5% |
| flag | indirect | 112 | recall 54.5% |
| flag | obfuscated | 112 | recall 40.2% |
| flag | benign | 280 | FPR 0.0% |
| flag | benign_hard | 168 | FPR 23.8% |
| block | direct | 224 | recall 38.8% |
| block | indirect | 112 | recall 33.9% |
| block | obfuscated | 112 | recall 21.4% |
| block | benign | 280 | FPR 0.0% |
| block | benign_hard | 168 | FPR 20.8% |

Latency per sample: p50 0.006 ms, p95 0.020 ms.

#### l2

| Threshold | n | Precision | Recall | FPR | F1 | TP/FP/TN/FN |
|---|---|---|---|---|---|---|
| flag (≥0.5) | 896 | 77.1% | 82.6% | 24.6% | 79.7% | 370/110/338/78 |
| block (≥0.85) | 896 | 77.7% | 79.2% | 22.8% | 78.5% | 355/102/346/93 |

| Threshold | Slice | n | Recall | FPR benign | FPR benign_hard | Precision | F1 |
|---|---|---|---|---|---|---|---|
| flag | id/formal | 256 | 78.9% | 13.8% | 50.0% | 74.3% | 76.5% |
| flag | en/formal | 128 | 95.3% | 0.0% | 25.0% | 91.0% | 93.1% |
| flag | id/informal | 256 | 69.5% | 17.5% | 27.1% | 76.7% | 73.0% |
| flag | mixed/informal | 256 | 93.0% | 8.8% | 72.9% | 73.9% | 82.4% |
| block | id/formal | 256 | 75.0% | 10.0% | 47.9% | 75.6% | 75.3% |
| block | en/formal | 128 | 93.8% | 0.0% | 25.0% | 90.9% | 92.3% |
| block | id/informal | 256 | 62.5% | 15.0% | 27.1% | 76.2% | 68.7% |
| block | mixed/informal | 256 | 93.0% | 6.3% | 72.9% | 74.8% | 82.9% |

| Threshold | Category | n | Metric |
|---|---|---|---|
| flag | direct | 224 | recall 88.8% |
| flag | indirect | 112 | recall 71.4% |
| flag | obfuscated | 112 | recall 81.3% |
| flag | benign | 280 | FPR 11.4% |
| flag | benign_hard | 168 | FPR 46.4% |
| block | direct | 224 | recall 86.2% |
| block | indirect | 112 | recall 67.0% |
| block | obfuscated | 112 | recall 77.7% |
| block | benign | 280 | FPR 8.9% |
| block | benign_hard | 168 | FPR 45.8% |

Latency per sample: p50 29.553 ms, p95 78.952 ms.

#### combined

| Threshold | n | Precision | Recall | FPR | F1 | TP/FP/TN/FN |
|---|---|---|---|---|---|---|
| flag (≥0.5) | 896 | 77.9% | 87.9% | 25.0% | 82.6% | 394/112/336/54 |
| block (≥0.85) | 896 | 78.2% | 82.6% | 23.0% | 80.3% | 370/103/345/78 |

| Threshold | Slice | n | Recall | FPR benign | FPR benign_hard | Precision | F1 |
|---|---|---|---|---|---|---|---|
| flag | id/formal | 256 | 97.7% | 13.8% | 54.2% | 77.2% | 86.2% |
| flag | en/formal | 128 | 95.3% | 0.0% | 25.0% | 91.0% | 93.1% |
| flag | id/informal | 256 | 69.5% | 17.5% | 27.1% | 76.7% | 73.0% |
| flag | mixed/informal | 256 | 93.0% | 8.8% | 72.9% | 73.9% | 82.4% |
| block | id/formal | 256 | 86.7% | 10.0% | 50.0% | 77.6% | 81.9% |
| block | en/formal | 128 | 93.8% | 0.0% | 25.0% | 90.9% | 92.3% |
| block | id/informal | 256 | 62.5% | 15.0% | 27.1% | 76.2% | 68.7% |
| block | mixed/informal | 256 | 93.0% | 6.3% | 72.9% | 74.8% | 82.9% |

| Threshold | Category | n | Metric |
|---|---|---|---|
| flag | direct | 224 | recall 91.1% |
| flag | indirect | 112 | recall 87.5% |
| flag | obfuscated | 112 | recall 82.1% |
| flag | benign | 280 | FPR 11.4% |
| flag | benign_hard | 168 | FPR 47.6% |
| block | direct | 224 | recall 86.6% |
| block | indirect | 112 | recall 78.6% |
| block | obfuscated | 112 | recall 78.6% |
| block | benign | 280 | FPR 8.9% |
| block | benign_hard | 168 | FPR 46.4% |

Latency per sample: p50 27.230 ms, p95 77.799 ms.

### test (1344 samples)

#### l1

| Threshold | n | Precision | Recall | FPR | F1 | TP/FP/TN/FN |
|---|---|---|---|---|---|---|
| flag (≥0.5) | 1344 | 69.2% | 25.7% | 11.5% | 37.5% | 173/77/595/499 |
| block (≥0.85) | 1344 | 73.9% | 13.1% | 4.6% | 22.3% | 88/31/641/584 |

| Threshold | Slice | n | Recall | FPR benign | FPR benign_hard | Precision | F1 |
|---|---|---|---|---|---|---|---|
| flag | id/formal | 384 | 51.6% | 0.0% | 51.4% | 72.8% | 60.4% |
| flag | en/formal | 192 | 41.7% | 0.0% | 80.6% | 58.0% | 48.5% |
| flag | id/informal | 384 | 5.2% | 0.0% | 5.6% | 71.4% | 9.7% |
| flag | mixed/informal | 384 | 12.5% | 0.0% | 9.7% | 77.4% | 21.5% |
| block | id/formal | 384 | 32.8% | 0.0% | 18.1% | 82.9% | 47.0% |
| block | en/formal | 192 | 25.0% | 0.0% | 30.6% | 68.6% | 36.6% |
| block | id/informal | 384 | 0.0% | 0.0% | 0.0% | n/a | n/a |
| block | mixed/informal | 384 | 0.5% | 0.0% | 9.7% | 12.5% | 1.0% |

| Threshold | Category | n | Metric |
|---|---|---|---|
| flag | direct | 336 | recall 28.6% |
| flag | indirect | 168 | recall 32.7% |
| flag | obfuscated | 168 | recall 13.1% |
| flag | benign | 420 | FPR 0.0% |
| flag | benign_hard | 252 | FPR 30.6% |
| block | direct | 336 | recall 13.7% |
| block | indirect | 168 | recall 19.6% |
| block | obfuscated | 168 | recall 5.4% |
| block | benign | 420 | FPR 0.0% |
| block | benign_hard | 252 | FPR 12.3% |

Latency per sample: p50 0.007 ms, p95 0.016 ms.

#### l2

| Threshold | n | Precision | Recall | FPR | F1 | TP/FP/TN/FN |
|---|---|---|---|---|---|---|
| flag (≥0.5) | 1344 | 76.6% | 81.8% | 25.0% | 79.1% | 550/168/504/122 |
| block (≥0.85) | 1344 | 77.9% | 78.0% | 22.2% | 77.9% | 524/149/523/148 |

| Threshold | Slice | n | Recall | FPR benign | FPR benign_hard | Precision | F1 |
|---|---|---|---|---|---|---|---|
| flag | id/formal | 384 | 71.9% | 11.7% | 62.5% | 70.1% | 71.0% |
| flag | en/formal | 192 | 100.0% | 1.7% | 50.0% | 83.5% | 91.0% |
| flag | id/informal | 384 | 70.3% | 13.3% | 38.9% | 75.4% | 72.8% |
| flag | mixed/informal | 384 | 94.3% | 8.3% | 50.0% | 79.7% | 86.4% |
| block | id/formal | 384 | 66.1% | 10.0% | 61.1% | 69.4% | 67.7% |
| block | en/formal | 192 | 99.0% | 0.0% | 50.0% | 84.1% | 90.9% |
| block | id/informal | 384 | 63.5% | 9.2% | 34.7% | 77.2% | 69.7% |
| block | mixed/informal | 384 | 93.8% | 5.8% | 44.4% | 82.2% | 87.6% |

| Threshold | Category | n | Metric |
|---|---|---|---|
| flag | direct | 336 | recall 85.4% |
| flag | indirect | 168 | recall 65.5% |
| flag | obfuscated | 168 | recall 91.1% |
| flag | benign | 420 | FPR 9.8% |
| flag | benign_hard | 252 | FPR 50.4% |
| block | direct | 336 | recall 79.5% |
| block | indirect | 168 | recall 61.9% |
| block | obfuscated | 168 | recall 91.1% |
| block | benign | 420 | FPR 7.1% |
| block | benign_hard | 252 | FPR 47.2% |

Latency per sample: p50 38.159 ms, p95 97.088 ms.

#### combined

| Threshold | n | Precision | Recall | FPR | F1 | TP/FP/TN/FN |
|---|---|---|---|---|---|---|
| flag (≥0.5) | 1344 | 73.6% | 86.6% | 31.1% | 79.6% | 582/209/463/90 |
| block (≥0.85) | 1344 | 78.7% | 82.3% | 22.3% | 80.4% | 553/150/522/119 |

| Threshold | Slice | n | Recall | FPR benign | FPR benign_hard | Precision | F1 |
|---|---|---|---|---|---|---|---|
| flag | id/formal | 384 | 88.5% | 11.7% | 88.9% | 68.5% | 77.3% |
| flag | en/formal | 192 | 100.0% | 1.7% | 100.0% | 72.2% | 83.8% |
| flag | id/informal | 384 | 70.3% | 13.3% | 44.4% | 73.8% | 72.0% |
| flag | mixed/informal | 384 | 94.3% | 8.3% | 50.0% | 79.7% | 86.4% |
| block | id/formal | 384 | 81.3% | 10.0% | 62.5% | 73.2% | 77.0% |
| block | en/formal | 192 | 99.0% | 0.0% | 50.0% | 84.1% | 90.9% |
| block | id/informal | 384 | 63.5% | 9.2% | 34.7% | 77.2% | 69.7% |
| block | mixed/informal | 384 | 93.8% | 5.8% | 44.4% | 82.2% | 87.6% |

| Threshold | Category | n | Metric |
|---|---|---|---|
| flag | direct | 336 | recall 89.0% |
| flag | indirect | 168 | recall 77.4% |
| flag | obfuscated | 168 | recall 91.1% |
| flag | benign | 420 | FPR 9.8% |
| flag | benign_hard | 252 | FPR 66.7% |
| block | direct | 336 | recall 83.3% |
| block | indirect | 168 | recall 71.4% |
| block | obfuscated | 168 | recall 91.1% |
| block | benign | 420 | FPR 7.1% |
| block | benign_hard | 252 | FPR 47.6% |

Latency per sample: p50 36.442 ms, p95 99.254 ms.

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
| NPWP | 100.0% | 100.0% | 100.0% | 121/0/0 |
| PHONE_ID | 99.2% | 100.0% | 99.6% | 118/1/0 |
| EMAIL | 100.0% | 100.0% | 100.0% | 109/0/0 |
| CARD | 83.6% | 98.4% | 90.4% | 127/25/2 |
| overall | 95.1% | 99.7% | 97.4% | 588/30/2 |

### Unlabeled NPWP

Recall 0.0% (0/50).

### Detection — all samples

| Entity | Precision | Recall | F1 | TP/FP/FN |
|---|---|---|---|---|
| NIK | 96.6% | 85.0% | 90.4% | 113/4/20 |
| NPWP | 100.0% | 70.8% | 82.9% | 121/0/50 |
| PHONE_ID | 99.2% | 100.0% | 99.6% | 118/1/0 |
| EMAIL | 100.0% | 78.4% | 87.9% | 109/0/30 |
| CARD | 81.9% | 98.4% | 89.4% | 127/28/2 |
| overall | 94.7% | 85.2% | 89.7% | 588/33/102 |

### Hard negatives

19/150 hard-negative samples (12.7%) had at least one false detection. By type: NIK 2, NPWP 0, PHONE_ID 0, EMAIL 0, CARD 17.

### Restore round trip

Masked text streamed through mock-upstream and the gateway's stream processor with the `pii-id` output guard. Success = output equals the masked text with each placeholder replaced by its vault value (the normalized form, e.g. phones as `+62…`). Only samples that got at least one placeholder count.

| Scenario | Samples | Succeeded | Success rate | restore_miss |
|---|---|---|---|---|
| mock-echo | 372 | 372 | 100.0% | 0 |
| mock-split-placeholder | 372 | 372 | 100.0% | 0 |

Detection latency per sample: p50 0.012 ms, p95 0.022 ms.
