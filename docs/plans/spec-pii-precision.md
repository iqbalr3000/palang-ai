# PII precision — spec

Feature entry: `docs/plans/roadmap.md`. First post-v0.1 feature: cut `pii-id`'s false positives
without hiding any recall cost, and close two recall gaps found on the way. Decisions agreed
2026-10-03.

## Baseline

`bun run eval --suite pii` at `9dfcd81` (not yet committed to `evals/results/`), supported formats:
precision 93.0%, recall 99.7%, 572 TP / 43 FP / 2 FN. The 43 false positives:

- **35 NPWP** — every one a plain 15-digit transaction ID; the detector accepts any 15 digits.
- **6 CARD** — 16-digit order numbers that happen to pass Luhn (~10% of random numbers do).
- **2 NIK** — real card numbers that also pass NIK validation; still masked, only mistyped.

Recall gaps: the 16-digit NPWP of companies and government institutions isn't detected at all, and
parenthesized phone numbers are listed as unsupported (19 misses).

## Scope

1. **Plain 15-digit NPWP needs a keyword nearby.** Formatted `XX.XXX.XXX.X-XXX.XXX` stays
   always-on.
2. **Detect the 16-digit company NPWP** (`0` + the old 15 digits), same keyword rule.
3. **Detect parenthesized Indonesian phone numbers** (`(0812) 3456-7890`, `+62 (812) 3456 7890`).
4. **Dataset changes** so the cost of 1 is measured, plus new look-alike negatives.
5. **Eval + bench before and after**, report committed, README numbers updated with sample counts.

Out of scope: CARD false positives, the NIK/CARD type collision, spaced NIKs, obfuscated emails.

## Design

| # | Decision | Why |
|---|---|---|
| 1 | A plain 15-digit run is NPWP only if an NPWP keyword appears within ~40 characters **before** it, case-insensitive: `npwp` (also `n.p.w.p`), `nomor pokok wajib pajak`, `tax id`, `tax number`, `taxpayer`. A JSON key like `"npwp":` counts. The formatted pattern needs no keyword. | Every NPWP false positive is an unlabeled 15-digit ID. Structural validation isn't available: the check-digit algorithm isn't publicly documented (sources only call it a "security code"), and the taxpayer-code ranges come from blogs, not DJP. Accepted cost: an unlabeled plain NPWP is no longer masked. |
| 2 | A 16-digit run starting with `0` is a company NPWP under the same keyword rule; normalized as the 16 digits. Only the plain form — a formatted 16-digit variant is added only once its display format is confirmed from an official source. | PMK 112/PMK.03/2022: companies and government institutions registered before it convert by prefixing `0` to the 15-digit NPWP; individuals' 16-digit NPWP is their NIK (already typed `NIK`). A leading `0` never passes NIK validation, so the two can't collide. The comment in `validators/npwp.ts` claiming every 16-digit NPWP is a NIK gets corrected. |
| 3 | `PHONE_ID` accepts the area/operator prefix in parentheses, with the same separators and length bounds as today, and the same "not inside a longer digit run / not an email" guards. | A common real-world spelling; cheap, same detector. |
| 4 | Dataset: positives gain plain NPWPs **without** a keyword (a new slice, so the recall loss from 1 is reported, not hidden) and company 16-digit NPWPs; parenthesized phones move from `unsupported_format` to positives; hard negatives gain unix-millisecond timestamps, virtual-account numbers, bank transfer references and SKU codes. | Today every NPWP template says "NPWP", so recall would stay at 100% and say nothing about 1. |
| 5 | CARD stays as is. | Luhn false positives are inherent; gating cards on a keyword would trade a cheap false positive (a masked order ID, restored on output) for a leaked card number. |
| 6 | Before/after: full `bun run eval` and `bun run bench:gateway` on the old code first (baseline report committed), then after. README's PII line and eval tables gain `n` and are updated only from the committed report. | `docs/plans/constraints.md` § Evaluation. |

## Risks

- **Recall cost of 1 is real** — NPWPs in tables, CSV rows or form dumps without a nearby label
  will pass through unmasked. The new keyword-less slice makes the size of this visible; if it's
  large in practice, the keyword window is the knob to revisit.
- **Keyword list written by the same author as the dataset**, so the keyword-less slice is the only
  honest signal; the positive templates will keep matching the list by construction.
- **Regenerating the dataset changes every PII number**, not just NPWP's. The baseline is run on
  both the old and the new dataset so the before/after comparison is like for like.

## Engineering tasks

- [x] Baseline: full eval + bench on the current code, report committed.
- [x] Tests first: keyword-gated plain NPWP (with/without keyword, keyword after the number, JSON
      key, window edge), formatted NPWP unaffected, company 16-digit NPWP, NIK unaffected,
      parenthesized phones (valid and invalid).
- [x] Detector: keyword rule for plain 15-digit and 16-digit company NPWP; parenthesized phones;
      fix the `npwp.ts` comment.
- [x] Dataset generator: keyword-less NPWP slice, company NPWP, parenthesized phones as
      positives, new hard negatives; report shows the new slice separately.
- [x] After: full eval + bench, report committed; README PII numbers and `n` updated.
- [x] `bun run typecheck && bun run test`.

## Implementation notes

Decided while building, not separately discussed — flagged for the user to confirm or overrule:

- **The parenthesized-phone "not after a digit" check runs in code, not in the regex.** A leading
  lookbehind is evaluated at every position: the first version cost ~25 µs per call and raised
  guard overhead p95 from 1.09 to 1.54 ms in the bench. Without it the regex costs ~0.6 µs and the
  overhead is back at baseline.
- **New dataset category `unlabeled`** (50 samples, plain NPWPs, no NPWP keyword anywhere in the
  text), excluded from the "supported formats" table and reported as its own recall line. The
  report's "including unsupported formats" table became "all samples" (field `withUnsupported` →
  `all`).
- **Before/after reports** use a `-before` suffix, since both runs share a commit and date:
  `2026-10-03-9dfcd81-dirty-fp32-before.*` (old code, old dataset),
  `2026-10-03-9dfcd81-dirty-pii-before-new-dataset.md` (old code, new dataset, PII only),
  `gateway-2026-10-03-9dfcd81-dirty-before.md`.
- `docs/deployment.md`'s "any 15-digit number is read as an NPWP" limitation was replaced by the
  keyword rule and the Luhn card false positives.

## Results

PII, supported formats (injection numbers are unchanged):

| | Old code, old dataset | Old code, new dataset | New code, new dataset |
|---|---:|---:|---:|
| Precision | 93.0% | 90.6% | **95.1%** |
| Recall | 99.7% | 93.4% | **99.7%** |
| NPWP precision / recall | 77.0% / 100% | 78.9% / 86.8% | **100% / 100%** |
| PHONE_ID recall | 100% | 82.2% | **100%** |
| Unlabeled NPWP recall | — | 52.0% | **0%** (by design) |
| Hard negatives with any detection | 17.3% | 22.7% | **12.7%** |
| Restore round trip | 100% | 100% | 100% |

- Precision misses the 97% target the improvement plan set: the new negatives (transfer
  references, timestamps, virtual accounts) add Luhn-passing CARD false positives — 25 of the 30
  remaining. CARD was kept out of scope (design #5).
- The remaining 4 NIK false positives: 3 card numbers that also pass NIK validation (still masked)
  and 1 virtual account starting `8277` (province 82 is valid).
- Old code's 52% on the unlabeled slice was its plain 15-digit NPWPs; it never detected the 16-digit
  company ones.
- Bench (Apple M1): guard overhead p95 1.09–1.13 ms before, 1.14–1.15 ms after; added TTFT p95
  4.8–5.3 ms before, 5.1–5.6 ms after (run-to-run noise). All 393 tests pass.

Found on the way, not fixed (out of scope): `PHONE_ID` matches the first 12 digits of a
space-grouped voucher starting `08` (`0805 6856 5531 2…`), because the end of the match is only
guarded against a digit, not a separator + digit (1 false positive, pre-existing). And the main
`PHONE_ID` regex has the same leading-lookbehind cost (~23 µs per call), so moving it to code would
cut guard overhead further.
