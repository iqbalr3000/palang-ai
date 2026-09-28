# 0006 — Repo license: MIT instead of Apache-2.0

`docs/TSD.md` §3 lists Apache-2.0, but `spec-injection-guard.md` recorded that as a placeholder:
no `LICENSE` file or `license` field existed. Decided 2026-09-28, while planning
`dashboard-launch`'s split, since the npm publish in `launch` needs it settled.

**Decision:** the repo and the published `@palang-ai/*` packages are MIT-licensed.

**Offered alternative:** Apache-2.0 (recommended at the time for its explicit patent grant and
matching TSD §3 and the default classifier model's license). The user chose MIT.

**Consequences, handled in `launch`:**
- Add `LICENSE` (MIT) and a `license` field to every published `package.json`.
- Third-party attribution still needs a place (README or NOTICE-style section): the L2 model and
  its CC-BY-3.0 training data (`spec-injection-guard.md`), and the LGPL `sharp`/libvips pulled in by
  `@huggingface/transformers`. The model weights are downloaded at setup, not shipped in the repo.
- Every dependency checked so far is permissive, so MIT is compatible.
