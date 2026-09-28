# Injection guard — spec

Feature entry: `docs/plans/roadmap.md`. Source of scope/acceptance criteria: `docs/TSD.md` §15 M3,
§6.2 (`injection` guard spec), §11 (eval harness). This records decisions on top of those sections,
not a restatement of them. Decisions agreed 2026-09-21.

## Scope

Covers, per TSD §15 M3:
- `packages/guards/src/injection/` — input normalization, L1 heuristics (EN + ID), and the guard
  itself (`InputGuard`), standalone-usable per `docs/decisions/0002-in-process-guards-v0.1.md`.
- L2 classifier — a `Classifier` interface consumed by the guard, and its transformers.js/ONNX
  implementation in `apps/gateway`.
- Wiring `injection` into the real gateway pipeline (config-driven per tenant, default `monitor`).
- `evals/` — dataset generators, initial datasets, `bun run eval` report (TSD §11), for both
  injection and PII (PII eval is the last stage, see below).

Explicitly out of scope: L3 LLM judge (deferred, see Design); `tool-policy`, `canary`, output PII
detection; dashboard, packaging, and the npm publish (`dashboard-launch`).

## Design

| Point | Decision | Why |
|---|---|---|
| Where the classifier lives | The guard in `packages/guards` takes a `Classifier` interface (`classify(text): Promise<number>`); without one, only L1 runs. The transformers.js implementation lives in `apps/gateway/src/classifier/`. | `@huggingface/transformers` uses native `onnxruntime-node` (`docs/spike-results.md`) and loading from `models/` needs `fs` — both forbidden in `packages/guards` (Working rule 3). The interface also satisfies standalone use (0002): an npm consumer can supply their own classifier or run L1 only. |
| L2 default model | `protectai/deberta-v3-base-prompt-injection-v2`. Not bundled in the repo — downloaded at setup. | Apache-2.0 (per its model card), not gated, already has the `onnx/` layout transformers.js expects. The alternatives lost: `Llama-Prompt-Guard-2-22M` is gated, under the Llama license rather than Apache-2.0, and its supported languages don't include Indonesian. |
| Model size / latency | The model is fp32 only, 739MB, with no quantized variant. A dedicated benchmark stage measures p95 latency on 2 vCPU against TSD §10.1. If it misses the budget: quantize to int8 ourselves, or revise the budget through a `docs/decisions/` record. | The spike only measured short sentences on DistilBERT, not 512-token windows on DeBERTa-base, so the TSD §6.2 target (p95 < 60ms / 512 tokens) is unproven. |
| Indonesian performance | Model is English-only. Reported as-is in the eval (per-language metrics), not hidden. | TSD §6.2 and §10.3 already list this as a known limitation to measure. |
| L3 LLM judge | Deferred to a later feature. | Off by default, needs an upstream client from inside a guard, and isn't part of the M3 acceptance criteria. |
| Injection dataset sourcing | Template generator + handwritten seeds; the agent drafts, the user spot-checks samples. Public datasets only via a download script after a license check. | Target is ≥300 ID injection + ≥300 ID benign samples (TSD §11.1). |
| Dev/test split | Dataset is split into a dev set (used to tune L1 patterns) and a held-out test set (used for the report). | Patterns and samples are written by the same party; without a held-out set, L1 recall would be inflated. |
| PII eval | In this feature, last stage, after the injection eval works. | `spec-pii-guard.md` explicitly deferred PII precision/recall and `restore_miss` reporting here, and TSD §11.2 wants one `bun run eval` report. |
| Findings content | Findings carry pattern ids and scores only, never matched text. | TSD §5 (`Finding.meta`: never raw values) and Working rule 4. |
| Reason code | `prompt_injection_detected`, added to `packages/core/src/reasons.ts`. | TSD §5 uses it as the example reason; `REASONS` currently has only `guard_error`. |

## Execution order

Staged, agreed 2026-09-21 — each stage produces something checkable before the next starts. The
latency benchmark sits at stage 3 because it's the biggest unproven risk and could change the
model decision.
1. Normalization + L1 heuristics (EN + ID) — pure functions, tests written first (Working rule 6). **Done.**
2. `evals/` skeleton, dev/test injection datasets, L1-only report. **Done.**
3. `Classifier` interface + L2 implementation + latency benchmark + model license check.
   **Done.** The benchmark missed the latency budget; resolved in `docs/decisions/0005`.
4. Wire `injection` into the gateway pipeline and config. **Built, pending user review.**
5. Full injection report, then PII eval. **Built, pending user review.**

## Engineering tasks

Matches TSD §15 M3 checklist, adjusted for the decisions above:
- [x] Normalization: NFKC, lowercase, strip zero-width/bidi controls, collapse whitespace, decode
      base64 segments ≥ 24 chars (`atob` — Web Standard) and scan the decoded text too.
- [x] L1 heuristics: EN + ID pattern sets in data files, weighted score 0..1 (noisy-or; seed
      patterns, then tuned against the dev set in stage 2 — see the stage 2 notes).
- [x] `Classifier` interface (`InjectionClassifier`) + guard combining L1/L2 (`score = max`, `block_threshold` /
      `flag_threshold`); roles from config, default `user` + `tool`.
- [x] L2 implementation in `apps/gateway/src/classifier/` (model loaded once at boot, sliding
      windows of 512 tokens / 64 overlap, score = max window).
- [x] Latency benchmark for L2 against TSD §10.1 (**misses the budget**, see stage 3 findings),
      and the license check on the model (one training dataset unverifiable).
- [x] Wire `injection` into `public/guards.ts` and the config schema (`injectionGuardSchema`
      already exists — verify it matches what's built), add `prompt_injection_detected`.
- [x] `evals/` workspace: injection dataset generators + dev/test datasets, `bun run eval` runner,
      report to `evals/results/<date>-<git-sha>.{json,md}` (precision/recall/FPR/F1 per layer,
      language, category; latency p50/p95 per guard). Stage 2 covers L1 only; L2 and the combined
      layer are added by the layer registry in later stages.
- [x] PII eval: ≥500 synthetic samples via a generator in `evals/src/generate/`, precision/recall
      per entity type, restore success rate via `mock-echo`, `restore_miss` aggregation.
- [ ] Acceptance (TSD §15 M3): first published report with per-language metrics. Report exists
      (`evals/results/2026-09-28-9576c75-dirty-fp32.{json,md}`); regenerated right before the
      commit if code changes after review.

## Stage 2 implementation notes

Decisions made while building stage 2 — not separately discussed, so flagged for the user to
confirm or overrule:
- **Split is by phrasing, not random.** Dev and test draw override/action clauses, indirect
  wrappers, benign templates, hard-benign sentences and obfuscation transforms from disjoint pools
  (`evals/src/generate/injection/pools-*.ts`), so test contains phrasing never seen while tuning.
  Shared across splits: low-signal openers, filler sentences, slot nouns.
- **Obfuscation transforms.** Dev: base64, zero-width, fullwidth, leet. Test: base64, zero-width,
  spaced letters, homoglyph, ROT13, reversed. Test deliberately includes transforms normalization
  doesn't handle.
- **Category `benign` added** to TSD §11.1's enum (`direct|indirect|obfuscated|benign_hard`) so
  ordinary benign samples have a category. About 30% of them are tool-role, to cover
  indirect-style benign text.
- **Sizes.** ID: 320 injection + 320 benign; EN: 160 + 160. Dev ≈ 40%, test ≈ 60%.
- **Metrics at both thresholds** (flag 0.5, block 0.85, from TSD §8's example config), overall and
  per language and category. `bun run eval --split dev [--misses]` prints without writing files,
  so tuning never needs to look at test.
- **Tuning policy.** L1 patterns were changed only for generalizable misses/false positives seen in
  dev; the test set was run once, after tuning. Not changed on purpose: leet-speak decoding (TSD
  §6.2 doesn't list it — scope call) and false positives on quoted attacks / ChatML tags in
  explanations (inherent to pattern matching, and dev has no delimiter-attack samples to justify
  reweighting).
- **Dataset files** are ASCII-escaped JSONL so zero-width and look-alike characters are visible in
  diffs; a test fails if the committed files drift from the generator.

## Stage 3 findings

Built: `InjectionClassifier` interface, `createInjectionInputGuard` / `scoreInjection` in
`packages/guards` (L1 + optional L2, `score = max`, L2 skipped when L1 already ≥ block), the
transformers.js classifier in `apps/gateway/src/classifier/` (sliding windows, `download-model`
script), and `l2` / `combined` layers plus `bun run bench` in `evals/`. Model decision: keep
protectai fp32, opt-in, budget revised — `docs/decisions/0005`.

**Latency (Apple M1, Bun 1.3.12; `evals/results/latency-*.md`).** One 512-token window, p95:
fp32 2 threads 962 ms, fp32 default threads 620 ms, int8 2 threads 524 ms. A short chat message
(~48 tokens) is ~50-117 ms. TSD §10.1's budget is p95 < 60 ms per 512-token window, so it is
missed by roughly 9-16×. int8 (`onnxruntime` dynamic quantization, 739 MB → 244 MB, 7 s to produce)
only gave ~1.8×. Caveats: M1 rather than a 2 vCPU x86 container, so real numbers are probably
worse.

**int8 accuracy (measured afterwards):** L2 recall collapses to 31.6% (EN 11.5%) at FPR 2.4% —
not viable as-is; see 0005.

**Accuracy (fp32, held-out test, flag ≥ 0.5; `evals/results/*-dirty.md`).**

| Layer | Recall | FPR | Recall ID | Recall EN | benign_hard FPR |
|---|---|---|---|---|---|
| L1 | 48.3% | 22.9% | 51.6% | 41.7% | 61.1% |
| L2 | 81.3% | 27.1% | 71.9% | 100% | 58.3% |
| combined | 92.4% | 39.9% | 88.5% | 100% | 92.6% |

L2 alone: plain-benign FPR 8.3% on test (ID clearly worse than EN); on the dev set (which L1 was
tuned to) L2 is worse than L1 on FPR. Obfuscated recall is 100% but that may be the model flagging
anything odd-looking, given its plain-benign FPR.

**Model quirk.** Long, low-entropy benign text scores as injection: the same benign sentence
repeated 26× scores 0.96; templated "varied" prose climbs 0.02 (250 tokens) → 0.14 (440) → 0.55
(520) → 0.97 (1000). Real long documents were not tested. This matters for indirect injection,
where tool output is exactly the long text being scanned.

**Cap (decided while building, not discussed).** `maxWindows = 8` and `maxInputChars = 16,384`
(text beyond either is not scanned); confirmed in the stage 4 decisions.

**License chain, verified via the HuggingFace API on 2026-09-21.** `protectai/deberta-v3-base-
prompt-injection-v2`: Apache-2.0. Base `microsoft/deberta-v3-base`: MIT. Training datasets:
Apache-2.0 ×4 (`alespalla/chatbot_instruction_prompts`, `HuggingFaceH4/grok-conversation-harmless`,
`OpenSafetyLab/Salad-Data`, `jackhhao/jailbreak-classification`), CC-BY-4.0 (`natolambert/xstest-
v2-copy`), CC-BY-3.0 (`VMware/open-instruct`; attribution needed). **Unverifiable:**
`Harelix/Prompt-Injection-Mixed-Techniques-2024` now returns HTTP 401 (removed or private), so its
license — stated as Apache-2.0 on the model card — can't be confirmed. Not checked: the six
"no license" datasets the model card mentions (the seven above are the ones it names).

**Bugs found in `gateway-core` (not from this feature; fixed here at the user's request).**
At the clean HEAD commit, two e2e tests failed on a cold Postgres. Two causes in
`apps/gateway/src/audit/queue.ts`: (1) the latency columns are `integer` but `performance.now()`
deltas are fractional, so Postgres rejected the insert and `AuditQueue` swallowed the error —
audit events were silently dropped; fixed by rounding in `enqueue`. (2) `AuditQueue.flush()` returns immediately
when the 100 ms timer has already spliced the batch but its insert is still in flight, so
`shutdown()` can return with an insert in flight; fixed by chaining inserts. Regression tests
added for both. It is unexplained why these tests passed in stages 1-2.

## Stage 4 decisions

Agreed 2026-09-28, before wiring:
- **Classifier loading.** Loaded in `apps/gateway/src/index.ts` at boot, one instance per model id
  shared across tenants, passed to `createPublicApp` as a dependency (also lets e2e tests inject a
  fake classifier, so CI needs no model). If a tenant enables it and the model fails to load, the
  gateway **fails to boot** with a message pointing at `download-model` — no silent L1-only fallback.
- **Pipeline order.** `injection` runs after `pii-id`, so it scans masked text (TSD §2).
- **Config schema.** `mode` defaults to `monitor`; thresholds default to 0.5 / 0.85; `classifier`
  is optional, `enabled` defaults to `false` (0005), `model` is a HuggingFace model id defaulting to
  `protectai/deberta-v3-base-prompt-injection-v2`. `palang.example.yaml` is fixed to match.
- **`judge`.** Stays optional in the schema but `enabled: true` is rejected at load ("not
  implemented"), so it can't be a silent no-op. Removed from `palang.example.yaml`.
- **Timeout.** Optional `timeout_ms` on the injection config, mapped to the runner's per-guard
  timeout; no default (unset = no timeout, the runner's current behavior). On timeout the tenant's
  `failure_mode` applies.
- **Window cap confirmed** at 8 windows / 16,384 characters, hardcoded in the classifier.
- Not changed: tool-call arguments in `assistant` history are not scanned — only message
  `content` of the configured roles (TSD §6.2).

## Stage 5 decisions

Agreed 2026-09-28, before building:
- **PII dataset.** Generator in `evals/src/generate/pii/` (seeded PRNG, drift test like the
  injection datasets) → `evals/datasets/pii.jsonl`, TSD §11.1 shape (`{id, text, spans}`) plus a
  `category`. ≥ 500 samples: positives with all five entity types (1–3 per text, mostly Indonesian,
  some English) and hard negatives (invalid NIK province/date, Luhn-failing cards, 16-digit
  order/tracking numbers, prices, dates). Synthetic only: `example.com`/`example.org` emails, test
  card BINs.
- **Unsupported real-world formats** (e.g. NIK separated by spaces, phones in parentheses) are
  included as positives in their own `unsupported_format` category; the report shows recall with
  and without it.
- **No dev/test split for PII** — the detectors aren't tuned in this stage, so there's nothing to
  hold out against.
- **Detection metric.** Exact match on type + start + end; precision/recall per entity type, false
  positives on hard negatives, latency p50/p95.
- **Restore round trip** runs in-process through the real streaming path: mask → mock-upstream's
  app via `app.fetch` (`mock-echo`, chunk 8, and `mock-split-placeholder`, chunk 1) → gateway
  `processStream` with the `pii-id` output guard. No ports, no Postgres. `@palang-ai/gateway`
  exports `./stream` for this, like `./classifier`. Success = returned text equals the masked text
  with each placeholder replaced by its *normalized* value (phones come back as `+62…`, per
  `spec-pii-guard.md`). `restore_miss` = vault entries never restored, aggregated per entity type.
- **One report.** `bun run eval` writes injection and PII into the same
  `evals/results/<date>-<sha>.{json,md}`; `--suite injection|pii` runs one side (PII needs no
  model).
- **Detector findings are recorded, not fixed.** Weaknesses the eval turns up go into this spec and
  are raised with the user; fixes are a separate decision, so dataset and detectors aren't written
  to fit each other.
- **Published report goes in the same single commit** as the rest of the feature — generated on
  the working tree just before committing, so it carries the `dirty` flag and the previous sha.
- Stage 3's `-dirty` result files stay as the evidence behind `docs/decisions/0005`.

## Stage 5 findings

**PII detector findings — recorded, not fixed** (per the stage 5 decisions; each needs a separate
call). From `bun run eval --suite pii`, supported formats, exact-span matching; the dataset was
checked sample by sample and the errors below are the detector's, not mislabeled gold:
- **`PHONE_ID` matches inside longer digit runs (a real bug).** The pattern has no leading
  boundary, and phones are checked before cards, so a grouped card like `5200 8283 9981 7031` is
  read as the phone `0 8283 9981 7031` and the card is lost. This one cause accounts for all 29
  missed cards (CARD recall 72.4%) and 28 of the phone false positives in positives; the other 10
  are phones found inside 16-digit order numbers.
- **Any 15-digit number is an `NPWP`** (`validateNpwp15` only checks length): 35 false positives,
  mostly transaction IDs. Inherent to a format with no checksum; would need context to fix.
- **Luhn passes ~10% of random 16-digit numbers**, so some order/registration numbers become
  `CARD` (5 false positives).
- **Mastercard BINs 51–53 overlap NIK province codes**, so an unseparated Mastercard number can
  validate as a `NIK` and win on priority (2 cases).
- Overall on supported formats: precision 87.2%, recall 94.9%; 35 of 150 hard negatives (23.3%)
  get at least one false detection. `unsupported_format` recall is 0% by construction (spaced NIK,
  parenthesized phones, `[at]` emails).
- Restore round trip: 100% success and zero `restore_miss` on both `mock-echo` and
  `mock-split-placeholder` (387 samples with placeholders).

**Built while implementing, not separately discussed:** `createApp` in `apps/mock-upstream` takes
an optional `chunkDelayMs` (default unchanged at 15 ms) so the eval can stream with no delay —
otherwise the 1-char `mock-split-placeholder` run takes ~10 minutes.

## Open questions

- **Repo license.** Not decided: no `LICENSE` file and no `license` field in any `package.json`;
  TSD §3's "Apache-2.0" is only a placeholder. Dependencies checked so far are permissive, so
  either Apache-2.0 or MIT is compatible. Needs a decision record before `dashboard-launch`.
- **LGPL in the dependency chain.** `@huggingface/transformers` pulls `sharp`, which pulls
  `@img/sharp-libvips-*` (LGPL-3.0-or-later). We don't use image processing, but it ships in the
  install/image. Not a blocker; needs a note in README/NOTICE rather than a "all dependencies are
  permissive" claim. Not legal advice — worth a second look before release.
- **Model license chain.** The model card states Apache-2.0, but its training data mixes MIT, CC0,
  Apache-2.0, CC-BY-3.0/4.0 and six "no license (public domain)" datasets. Attribution belongs in
  a NOTICE file. Not verified: `microsoft/deberta-v3-base`'s license text and each training
  dataset's license. Resolve during the benchmark stage before claiming anything stronger than
  "model is Apache-2.0".
