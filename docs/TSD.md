# Palang — Technical Specification Document

> **Palang** (Indonesian: *boom gate*) is an open-source, OpenAI-compatible security gateway for LLM applications and agents.
> Working name — check npm/GitHub availability before first publish.

| Field | Value |
|---|---|
| Version | 0.1 (draft) |
| Author | Muhammad Iqbal Ramadhan (@iqbalr3000) |
| Status | Ready for implementation |
| Target release | v0.1.0 |

---

## 1. Overview

### 1.1 Problem

Applications and agents send prompts, documents, and tool results to LLM providers with little control over:

- **Prompt injection**, both direct (user input) and indirect (instructions hidden in web pages, emails, RAG documents, and tool results).
- **PII leakage** to third-party providers, especially Indonesian identifiers (NIK, NPWP, phone numbers) that generic tools do not recognize.
- **Unsafe tool calls** issued by agents (deleting data, transferring money, calling unapproved tools).
- **No audit trail** of what was sent, what was blocked, and why.

### 1.2 Solution

A reverse proxy that sits between the application and the LLM provider. Applications change only `base_url`. Every request and response passes through a configurable pipeline of **guards**.

### 1.3 Goals (v0.1)

1. OpenAI-compatible `POST /v1/chat/completions`, streaming and non-streaming.
2. Indonesian-aware PII redaction with round-trip restore, including across streaming chunks.
3. Layered prompt injection detection (heuristics → classifier → optional LLM judge), applied to user **and** tool messages.
4. Declarative tool-call policy (allow/deny + argument constraints), enforced before the tool call reaches the client.
5. System prompt leak detection via canary tokens.
6. Asynchronous audit log that never blocks the request path.
7. Read-only dashboard (events, stats) plus API key management.
8. Reproducible evaluation harness with published metrics (detection rate, false positive rate, latency).
9. `docker compose up` demo that works without any provider API key (mock upstream).

### 1.4 Non-goals (v0.1)

- Anthropic Messages API, Gemini native API, embeddings, audio, images (design must allow adding provider adapters later).
- Policy editing through the UI (policies are config-as-code in v0.1).
- Human-in-the-loop approval workflows for tool calls.
- Rate limiting, caching, cost tracking, load balancing across providers.
- Multi-instance guarantees for audit delivery (in-memory queue; see §10.3).
- Bank account number detection (too ambiguous to validate reliably).

---

## 2. Architecture

### 2.1 Request flow

```
Client (OpenAI SDK)
  │  POST /v1/chat/completions  (Authorization: Bearer plg_...)
  ▼
[Auth + tenant resolution]
  ▼
[Input pipeline]   canary inject → PII mask → injection scan
  ▼
[Upstream adapter] ──► LLM provider
  ▼
[Stream processor] SSE parse → holdback buffer → tool-call assembly
  ▼
[Output pipeline]  canary check → PII restore → tool-call policy
  ▼
Client
  │
  └─(async)─► [Audit queue] ─batch─► PostgreSQL ◄── Admin API ◄── Dashboard
```

### 2.2 Processes and ports

| Process | Runtime | Port | Exposure |
|---|---|---|---|
| Gateway public API (`/v1/*`, health) | Bun | 8080 | Public |
| Gateway admin API (`/admin/*`) | Bun (same process) | 8081 | Internal only |
| Dashboard | Node (Next.js) | 3000 | Internal / behind auth |
| PostgreSQL 16 | — | 5432 | Internal |
| Mock upstream (dev/demo) | Bun | 9090 | Internal |

The admin API is served on a **separate port** so it can be firewalled independently of the public proxy.

### 2.3 Design principles

1. **Guards are framework-agnostic.** `packages/core` and `packages/guards` use only Web Standard APIs. No `Bun.*`, no Hono, no Node-only modules.
2. **The request path never waits on the database.** Audit writes are async and lossy under pressure, by design.
3. **Deterministic before probabilistic.** Regex + validation first, ML second, LLM last.
4. **Monitor mode everywhere.** Every guard can run in `monitor` (log only) or `enforce` mode so users can adopt it safely.
5. **Secrets never persist in plaintext.** The PII vault lives in memory for one request only and is never logged.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Bun (latest stable) | Gateway, mock upstream, evals, tests |
| Language | TypeScript, `strict` | See tsconfig rules §4.2 |
| Monorepo | Bun workspaces + Turborepo | `linker = "isolated"` in `bunfig.toml` |
| HTTP framework | Hono | `hono/streaming` for SSE |
| Validation | Zod | Request bodies, config file, admin API |
| SSE parsing (upstream) | `eventsource-parser` | |
| DB | PostgreSQL 16 | |
| ORM / migrations | Drizzle ORM + drizzle-kit, `postgres` (postgres-js) driver | |
| Logging | pino (JSON) | Redact auth headers and message content |
| ML inference | `@huggingface/transformers` (ONNX) | Fallback: `onnxruntime-web` (WASM). Verify in M0 |
| Config | YAML (`yaml` package) + Zod | Env var interpolation `${VAR}` |
| Dashboard | Next.js (App Router), Tailwind, shadcn/ui, Recharts | Runs on Node runtime; Bun only as package manager |
| Testing | `bun test` | Integration tests use official `openai` npm SDK |
| Containers | `oven/bun` (gateway), `node` slim (dashboard) | |
| CI | GitHub Actions + `oven-sh/setup-bun` | `bun install --frozen-lockfile` |
| License | Apache-2.0 | |

---

## 4. Repository structure

```
palang/
├── apps/
│   ├── gateway/                 # Hono app: public + admin servers
│   │   ├── src/
│   │   │   ├── index.ts         # boots both servers
│   │   │   ├── public/          # /v1 routes, health
│   │   │   ├── admin/           # /admin routes
│   │   │   ├── upstream/        # provider adapters (openai-compatible)
│   │   │   ├── stream/          # SSE processor, holdback buffer, tool-call assembler
│   │   │   ├── audit/           # async queue + batch writer
│   │   │   └── config/          # YAML loader + Zod schema
│   │   └── test/
│   ├── dashboard/               # Next.js
│   └── mock-upstream/           # Scriptable fake OpenAI server for tests & demo
├── packages/
│   ├── core/                    # Guard types, pipeline runner, decision aggregation
│   ├── guards/                  # pii-id, injection, tool-policy, canary
│   ├── db/                      # Drizzle schema + migrations
│   └── config/                  # shared tsconfig
├── evals/
│   ├── datasets/                # JSONL (see §11)
│   ├── src/                     # harness
│   └── results/                 # generated reports (committed per release)
├── examples/                    # openai-sdk, langchain, curl
├── models/                      # downloaded ONNX models (gitignored)
├── palang.example.yaml
├── docker-compose.yml
├── bunfig.toml
├── turbo.json
└── package.json
```

### 4.1 Package naming

`@palang/core`, `@palang/guards`, `@palang/db`. Internal dependencies use `"workspace:*"`. Internal packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`) until publishing.

### 4.2 TypeScript rules

- Base config: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: Preserve`, `moduleResolution: bundler`, `types: []`.
- Only `apps/gateway`, `apps/mock-upstream`, and `evals` add `"types": ["bun"]`.
- `packages/core` and `packages/guards` must pass `tsc` with `types: []`. This enforces the runtime-agnostic rule.

---

## 5. Core domain model (`packages/core`)

```ts
export type Action = "allow" | "block" | "modify" | "flag";
export type GuardMode = "enforce" | "monitor";
export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string | null;           // v0.1: text only; array content is flattened for scanning
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Decision {
  guard: string;
  action: Action;
  reason?: string;                  // machine-readable code, e.g. "prompt_injection_detected"
  detail?: string;                  // human-readable, must not contain raw PII
  score?: number;                   // 0..1 when applicable
  findings?: Finding[];
  latencyMs: number;
}

export interface Finding {
  type: string;                     // "NIK", "PHONE_ID", "INJECTION_HEURISTIC", ...
  messageIndex?: number;
  start?: number;
  end?: number;
  meta?: Record<string, unknown>;   // never raw values
}

export interface GuardContext {
  requestId: string;
  tenantId: string;
  model: string;
  stream: boolean;
  messages: ChatMessage[];          // input guards may mutate
  piiVault: Map<string, string>;    // placeholder -> original; NEVER log or persist
  canary?: string;
  signal: AbortSignal;
  metadata: Record<string, unknown>;
}

export interface InputGuard {
  name: string;
  phase: "input";
  check(ctx: GuardContext): Promise<Decision>;
}

export interface OutputGuard {
  name: string;
  phase: "output";
  /** Called on text segments released by the holdback buffer. May return modified text. */
  checkText?(text: string, ctx: GuardContext): Promise<{ decision: Decision; text: string }>;
  /** Called once per fully assembled tool call. May return a modified call. */
  checkToolCall?(call: ToolCall, ctx: GuardContext): Promise<{ decision: Decision; call: ToolCall }>;
  /** Max characters this guard needs held back to detect split patterns. */
  holdback?: number;
}
```

### 5.1 Pipeline runner

- Guards execute **sequentially** in configured order (order matters: PII mask must run before the LLM judge).
- Each guard runs with its configured `mode`. In `monitor` mode, `block` is downgraded to `flag` and recorded as `wouldBlock: true`.
- First enforced `block` short-circuits the pipeline.
- Guard timeout is configurable per guard. On timeout or exception, apply tenant `failure_mode`:
  - `fail_closed` → block with reason `guard_error`.
  - `fail_open` → flag with reason `guard_error` and continue.
- Runner returns `{ decisions: Decision[], blocked: Decision | null }`.

---

## 6. Guard specifications (`packages/guards`)

### 6.1 `pii-id` (input: mask, output: restore)

**Entity types (v0.1):**

| Type | Detection | Validation |
|---|---|---|
| `NIK` | 16 digits, optional separators | Province code (digits 1–2) in whitelist loaded from a data file (not hardcoded in regex); day (digits 7–8) in 01–31 or 41–71; month (digits 9–10) in 01–12; serial (digits 13–16) ≠ `0000` |
| `NPWP` | 15 digits, formatted `99.999.999.9-999.999` or plain; 16-digit NPWP | 16-digit values that pass NIK validation are typed `NIK` |
| `PHONE_ID` | `+62`, `62`, or `0` followed by `8` and 8–11 more digits; allow spaces, dots, dashes | Normalize before length check |
| `EMAIL` | Standard pattern | — |
| `CARD` | 13–19 digits with separators | Luhn check |

**Masking rules:**

- Placeholder format: `[TYPE_N]`, e.g. `[NIK_1]`, `[PHONE_ID_2]`. `N` is per-request, per-type.
- The same original value maps to the same placeholder within a request.
- Scan roles configurable; default: `user`, `tool`, `assistant` (history). `system` excluded by default.
- Optional `preserve_hint`: append one line to the system message instructing the model to keep placeholders verbatim.
- Tool call arguments in assistant history are masked too.

**Restore rules:**

- Text segments: replace known placeholders with vault values.
- Tool call arguments: restore **before** tool-call policy evaluation so constraints see real values.
- Placeholders that appear in output but are not in the vault are left as-is and recorded as finding `UNKNOWN_PLACEHOLDER`.
- If the model output contains a *new* PII value not present in input, record finding `OUTPUT_PII` (flag; optionally mask via config `mask_new_output_pii`).
- Metric: count vault entries never restored (`restore_miss`) for eval reporting.

`holdback` = length of the longest possible placeholder (compute from vault; cap at 32).

### 6.2 `injection` (input)

**Scan targets:** roles from config; default `user` and `tool`. Tool messages are the primary vector for indirect injection and must be covered.

**Normalization before scanning:** Unicode NFKC, lowercase, remove zero-width and bidi control characters, collapse whitespace. Detect and decode base64 segments ≥ 24 chars and scan decoded text as well.

**Layer 1 — heuristics** (target < 5 ms per 4k chars)
- Pattern sets in data files, English and Indonesian (e.g. "ignore previous instructions", "abaikan instruksi sebelumnya", role-play jailbreak markers, fake system/role delimiters, "you are now", markdown/HTML exfiltration patterns such as image URLs with query placeholders).
- Output: score 0..1 from weighted matches.

**Layer 2 — classifier** (target p95 < 60 ms for 512 tokens on CPU)
- ONNX text-classification model via `@huggingface/transformers`, loaded once at startup from `models/`.
- Long inputs: sliding windows of 512 tokens with 64 overlap; score = max window score.
- Candidate models (verify license + ONNX availability in M0): `protectai/deberta-v3-base-prompt-injection-v2`, `meta-llama/Llama-Prompt-Guard-2-22M`.
- Known limitation to measure: candidates are English-centric; Indonesian performance must be reported in evals.

**Layer 3 — LLM judge** (optional, off by default)
- Invoked only when combined score is within `[judge_low, judge_high]`.
- Receives PII-masked text only. Uses a configured upstream model with a strict JSON output contract `{ "injection": boolean, "confidence": number }`.
- Timeout default 3 s; on failure use `failure_mode`.

**Decision:** `score = max(L1, L2, L3?)`. `score >= block_threshold` → block; `score >= flag_threshold` → flag.

### 6.3 `canary` (input + output)

- Input: when enabled and a system message exists, append a random token (`plg-canary-<16 hex>`) inside an instruction not to reveal it. Store in `ctx.canary`.
- Output: if the canary appears in output text → action per config (`block` terminates the stream; `flag` strips the token).
- Limitation (document it): in streaming mode, text already sent cannot be recalled; detection terminates the stream.
- `holdback` = canary length.

### 6.4 `tool-policy` (output)

Evaluated per fully assembled tool call, after PII restore.

```yaml
tool_policy:
  default: deny            # allow | deny
  rules:
    - tool: "search_*"     # glob
      action: allow
    - tool: "delete_*"
      action: deny
      reason: destructive_tool
    - tool: transfer_funds
      action: allow
      constraints:
        - path: amount       # JSON pointer-like dot path
          op: lte            # eq | neq | lt | lte | gt | gte | in | not_in | regex
          value: 1000000
        - path: currency
          op: in
          value: [IDR]
```

- First matching rule wins; otherwise `default`.
- Arguments that fail JSON parsing → block with reason `invalid_tool_arguments`.
- Constraint referencing a missing path → constraint fails.

---

## 7. Gateway (`apps/gateway`)

### 7.1 Public API

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | OpenAI-compatible, streaming and non-streaming |
| GET | `/v1/models` | Models allowed for the tenant (from config) |
| GET | `/healthz` | Liveness |
| GET | `/readyz` | DB reachable, models loaded, config valid |

**Auth:** `Authorization: Bearer plg_<env>_<random>`. Resolves to a tenant. Unknown or revoked key → `401`.

**Response headers:** `x-palang-request-id`, `x-palang-decision` (`allow` | `flag`).

**Block response (non-streaming):** HTTP `400`, OpenAI error shape:

```json
{
  "error": {
    "message": "Request blocked by Palang: prompt_injection_detected",
    "type": "palang_policy_violation",
    "code": "prompt_injection_detected",
    "param": null
  },
  "palang": { "request_id": "req_...", "guard": "injection" }
}
```

**Block during streaming:** emit one SSE event `data: {"error": {...same shape...}}`, then `data: [DONE]`, then close. If blocked before any upstream call, respond with the non-streaming error and HTTP 400.

**Passthrough:** unknown request fields are forwarded unchanged. `stream_options.include_usage` is honored.

### 7.2 Upstream adapter

```ts
interface UpstreamAdapter {
  chat(req: ChatRequest, opts: { signal: AbortSignal }): Promise<Response>; // raw fetch Response
}
```

- v0.1 implements `openai-compatible` (OpenAI, OpenRouter, Groq, vLLM, Ollama, etc.) with configurable `base_url` and API key.
- Client disconnect must abort the upstream request.
- Upstream errors are forwarded with original status and body (after PII restore is **not** applied to error bodies; they are forwarded as-is).

### 7.3 Stream processor (`src/stream`)

The hardest component. Must be unit-tested in isolation.

1. Parse upstream SSE with `eventsource-parser`.
2. For each chunk, split `choices[i].delta` into:
   - **content** → append to per-choice holdback buffer.
   - **tool_calls deltas** → accumulate per `index` (id, name, arguments string). Do not emit.
3. Holdback buffer: release all text except the last `H` characters, where `H = max(holdback of active output guards)`. Additionally, if an unclosed `[` exists within the tail, hold from that `[`. Released text passes through output guards `checkText`, then is emitted as a synthesized chunk preserving the upstream `id`, `model`, and `created` fields.
4. On `finish_reason` for a choice: flush the holdback buffer; if tool calls were accumulated, run `checkToolCall` for each, then emit them as delta chunks (single chunk per tool call is acceptable), followed by the finish chunk.
5. Forward usage chunks unchanged.
6. Memory bound: tool-call argument accumulation capped (`max_tool_args_bytes`, default 256 KB) → block `tool_arguments_too_large`.

Non-streaming responses reuse the same guard calls on the complete message.

### 7.4 Admin API (port 8081)

Auth: `Authorization: Bearer ${PALANG_ADMIN_TOKEN}` (v0.1 single admin token).

| Method | Path | Description |
|---|---|---|
| GET | `/admin/stats?from&to&tenant` | Totals by action, by guard, latency percentiles, time buckets |
| GET | `/admin/events?cursor&limit&tenant&action&guard` | Cursor-paginated audit events |
| GET | `/admin/events/:id` | Event detail |
| GET | `/admin/tenants` | Tenants from config (secrets redacted) |
| GET | `/admin/tenants/:id/keys` | List keys (prefix, created, last used, revoked) |
| POST | `/admin/tenants/:id/keys` | Create key; returns plaintext **once** |
| DELETE | `/admin/keys/:id` | Revoke key |
| GET | `/admin/config` | Effective config, secrets redacted |

### 7.5 Audit queue (`src/audit`)

- In-memory bounded queue (default 10,000 events).
- Flush every 1 s or every 200 events, batch insert.
- When full: drop the new event and increment `palang_audit_dropped_total`. Never block or await in the request path.
- Graceful shutdown (SIGTERM): stop accepting requests, flush queue with a 5 s deadline.

---

## 8. Configuration

Single YAML file, path from `PALANG_CONFIG` (default `./palang.yaml`). Validated with Zod at startup; invalid config → process exits with a readable error. `${ENV_VAR}` interpolation supported. Hot reload is out of scope.

```yaml
server:
  public_port: 8080
  admin_port: 8081

audit:
  content_mode: redacted     # none | redacted | hash
  retention_days: 30

models:
  path: ./models

tenants:
  - id: demo
    failure_mode: fail_closed
    upstream:
      type: openai-compatible
      base_url: ${UPSTREAM_BASE_URL}
      api_key: ${UPSTREAM_API_KEY}
    allowed_models: ["gpt-4o-mini", "mock-*"]
    guards:
      canary:
        mode: enforce
        on_detect: block
      pii-id:
        mode: enforce
        entities: [NIK, NPWP, PHONE_ID, EMAIL, CARD]
        roles: [user, tool, assistant]
        preserve_hint: true
        mask_new_output_pii: false
      injection:
        mode: monitor
        roles: [user, tool]
        flag_threshold: 0.5
        block_threshold: 0.85
        classifier:
          enabled: true
          model: prompt-injection-classifier
        judge:
          enabled: false
          model: gpt-4o-mini
          low: 0.4
          high: 0.85
          timeout_ms: 3000
      tool-policy:
        mode: enforce
        default: deny
        rules: []
```

**Environment variables:** `PALANG_CONFIG`, `DATABASE_URL`, `PALANG_ADMIN_TOKEN`, `LOG_LEVEL`, plus any referenced by the config.

**`content_mode`:**
- `none` → store no message content.
- `redacted` (default) → store PII-masked messages. The vault is never stored.
- `hash` → store SHA-256 of each message only.

---

## 9. Data model (`packages/db`)

Tenants live in config in v0.1; the DB references them by string id.

```ts
// api_keys
id            uuid pk
tenant_id     text not null
name          text not null
prefix        text not null            // first 12 chars, for display
key_hash      text not null unique     // sha256(full key), hex
created_at    timestamptz not null default now()
last_used_at  timestamptz
revoked_at    timestamptz

// audit_events
id              uuid pk                 // = request id
tenant_id       text not null
api_key_id      uuid
created_at      timestamptz not null default now()
model           text not null
stream          boolean not null
final_action    text not null           // allow | flag | block
blocked_by      text                    // guard name
status_code     integer not null
decisions       jsonb not null          // Decision[] without raw values
latency_total_ms   integer not null
latency_guards_ms  integer not null
latency_upstream_ms integer
ttft_ms         integer
usage           jsonb                   // prompt/completion tokens if available
request_content jsonb                   // per content_mode
response_content jsonb                  // per content_mode

index (tenant_id, created_at desc)
index (final_action, created_at desc)
```

- `last_used_at` updates are debounced (at most once per minute per key, in memory).
- Retention: daily job deletes events older than `retention_days`.

---

## 10. Non-functional requirements

### 10.1 Performance budgets (single instance, 2 vCPU)

| Metric | Budget |
|---|---|
| Guard overhead p95, L1 + PII + tool policy | ≤ 10 ms |
| Guard overhead p95 including L2 classifier | ≤ 80 ms |
| Added time-to-first-token (streaming, no judge) | ≤ 100 ms p95 |
| Memory per active stream | bounded by holdback + tool arg cap |

Benchmark scripts live in `evals/` and results are published per release.

### 10.2 Security requirements

- API keys: ≥ 32 bytes of randomness, stored as SHA-256 hash only; compare with constant-time comparison.
- Logs: pino redaction for `authorization`, `api_key`, and all message content. Log decisions, not payloads.
- PII vault: request-scoped `Map`, dropped after response; never serialized.
- Upstream API keys only from config/env; never returned by any endpoint.
- Request body size limit (default 1 MB) and upstream timeout (default 120 s).
- Admin API on a separate port; documentation must state it must not be publicly exposed.
- Dashboard calls the admin API server-side only; the admin token never reaches the browser.
- Dependency audit in CI.

### 10.3 Known limitations (document in README)

- Audit events can be lost on crash or overload (in-memory queue).
- Streaming blocks cannot recall text already sent.
- The model may paraphrase placeholders, causing restore misses (measured in evals).
- Classifier accuracy on Indonesian text is bounded by the chosen model (measured in evals).

### 10.4 Observability

- Structured JSON logs with `request_id`.
- `GET /metrics` on admin port (Prometheus text format): request counts by action, guard latency histograms, audit dropped/flushed counters, upstream errors.

---

## 11. Evaluation harness (`evals/`)

This is the project's headline artifact. Results must be reproducible with one command: `bun run eval`.

### 11.1 Datasets (JSONL)

Injection:
```json
{"id":"inj-id-0001","text":"...","role":"user","label":"injection","lang":"id","category":"direct","source":"handmade"}
```
- `label`: `injection` | `benign`
- `category`: `direct` | `indirect` | `obfuscated` | `benign_hard` (benign text that looks suspicious, e.g. security discussions)
- `lang`: `id` | `en`

PII:
```json
{"id":"pii-0001","text":"...","spans":[{"type":"NIK","start":10,"end":26}]}
```

Rules:
- All PII in datasets must be **synthetic** and generated by a script in `evals/src/generate/`.
- Public datasets: verify license before committing; otherwise add a download script instead of committing the data.
- Target v0.1: ≥ 300 Indonesian injection samples, ≥ 300 Indonesian benign samples, ≥ 500 PII samples.

### 11.2 Metrics and report

- Injection: precision, recall (TPR), FPR, F1, per layer (L1, L2, combined) and per language and category.
- PII: precision/recall per entity type; restore success rate using mock-upstream echo scenarios.
- Latency: p50/p95 per guard.
- Output: `evals/results/<date>-<git-sha>.json` and `.md`; README links the latest report.

---

## 12. Mock upstream (`apps/mock-upstream`)

OpenAI-compatible fake server used by integration tests and the demo.

- Scenario selected by model name, e.g. `mock-echo`, `mock-split-placeholder`, `mock-tool-call`, `mock-leak-canary`, `mock-slow`.
- `mock-echo` returns the last user message (proves masking/restore round-trip).
- `mock-split-placeholder` deliberately splits placeholders across SSE chunks (e.g. `[NI` + `K_1]`).
- `mock-tool-call` streams tool-call argument deltas in small fragments.
- Configurable chunk delay for latency tests.

---

## 13. Dashboard (`apps/dashboard`)

v0.1 pages:
1. **Overview** — requests, blocked, flagged over time; top block reasons; guard latency p95.
2. **Events** — filterable table (tenant, action, guard, date); detail drawer showing decisions and redacted content.
3. **API keys** — list, create (show once), revoke.
4. **Config** — read-only view of effective config.

Rules: Server Components + route handlers call the admin API with `PALANG_ADMIN_URL` and `PALANG_ADMIN_TOKEN`. Protect the dashboard with a simple login backed by `DASHBOARD_PASSWORD` in v0.1.

---

## 14. Testing strategy

| Level | Scope | Tool |
|---|---|---|
| Unit | Each guard, NIK/NPWP validators, holdback buffer, tool-call assembler, pipeline runner | `bun test` |
| Property-style | Holdback buffer: random chunk splits of the same text must produce identical restored output | `bun test` with generated splits |
| Integration | Gateway + mock upstream using the official `openai` SDK, streaming and non-streaming | `bun test` |
| DB | Migrations + audit writer against real Postgres (docker in CI) | `bun test` |
| Eval | §11 | `bun run eval` |

Definition of done for any task: `bun run typecheck && bun test` passes, no new `any`, new behavior covered by tests.

---

## 15. Milestones

### M0 — Spike (1–2 days)
Prove the risky parts work on Bun before building features.
- [ ] Hono on Bun proxies streaming SSE from a real or mock OpenAI endpoint; chunks arrive incrementally (verified with timestamps).
- [ ] `@huggingface/transformers` loads a candidate injection model and classifies text under Bun. Record latency. If it fails, test `onnxruntime-web`.
- [ ] Drizzle + postgres-js connects and runs a migration under Bun.
- [ ] Write findings to `docs/spike-results.md`.

### M1 — Foundation
- [ ] Monorepo scaffold per §4, CI (typecheck, test, lint).
- [ ] `packages/core`: types, pipeline runner, modes, timeouts, failure modes.
- [ ] Config loader + Zod schema.
- [ ] Mock upstream with `mock-echo` and streaming.
- [ ] `/v1/chat/completions` passthrough (stream + non-stream), `/v1/models`, health endpoints.
- [ ] API key auth, `db` package, audit queue + writer.
- **Acceptance:** `openai` SDK works against the gateway in both modes; audit rows appear; killing the DB does not break proxying.

### M2 — PII guard + stream processor
- [ ] Validators and detectors for all v0.1 entity types.
- [ ] Mask/restore with consistent placeholders.
- [ ] Holdback buffer + tool-call assembler per §7.3.
- **Acceptance:** `mock-echo` and `mock-split-placeholder` round-trip correctly under random chunk splits; no raw PII in logs or audit rows (asserted by test).

### M3 — Injection guard + eval harness
- [ ] Normalization, L1 heuristics (EN + ID), L2 classifier, optional L3 judge.
- [ ] Dataset generators and initial datasets.
- [ ] `bun run eval` produces the report.
- **Acceptance:** first published report with per-language metrics.

### M4 — Tool policy + canary + output PII
- [ ] Tool-policy guard with constraints.
- [ ] Canary guard.
- [ ] Output PII detection.
- **Acceptance:** `mock-tool-call` and `mock-leak-canary` scenarios blocked/flagged as configured, streaming and non-streaming.

### M5 — Dashboard, packaging, launch
- [ ] Admin API complete, `/metrics`.
- [ ] Dashboard pages per §13.
- [ ] `docker compose up` runs Postgres, gateway, dashboard, mock upstream with seeded demo tenant and key.
- [ ] README (quickstart < 5 min, architecture, limitations), examples, benchmark report, demo video, blog post.

---

## 16. Open questions

1. Final project name and npm scope.
2. Which classifier model ships as default (decided after M0/M3 based on license and Indonesian metrics).
3. Anthropic Messages API adapter: v0.2 candidate.
4. Policy editing in UI and DB-backed tenants: v0.2 candidate.
5. Publishing `@palang/guards` to npm for in-process use: v0.2 candidate.
