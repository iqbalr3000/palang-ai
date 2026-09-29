# @palang-ai/guards

LLM security guards for Indonesian data, usable in-process without the
[Palang gateway](https://github.com/iqbalr3000/palang-ai):

- **PII masking** — NIK, NPWP, phone numbers, emails and card numbers become placeholders like
  `[NIK_1]` before a prompt leaves your app, and are restored in the reply.
- **Prompt-injection detection** — English and Indonesian heuristics, with an optional ML
  classifier you plug in.
- **Tool-call policy** — allow-list tools by glob, with typed constraints on their arguments.
- **Canary** — catches your system prompt showing up in the output.

No dependencies. Runs on Node 20.3+, Bun, Deno and the edge.

```sh
npm install @palang-ai/guards
```

```ts
import {
  DEFAULT_PII_ID_CONFIG,
  createPiiIdInputGuard,
  createPiiIdOutputGuard,
  type GuardContext,
} from "@palang-ai/guards";

const ctx: GuardContext = {
  requestId: crypto.randomUUID(),
  tenantId: "local",
  model: "gpt-4o-mini",
  stream: false,
  messages: [{ role: "user", content: "NIK saya 3171011506900001" }],
  piiVault: new Map(),
  signal: new AbortController().signal,
  metadata: {},
};

await createPiiIdInputGuard(DEFAULT_PII_ID_CONFIG).check(ctx);
ctx.messages[0]?.content; // "NIK saya [NIK_1]"

const reply = await createPiiIdOutputGuard(DEFAULT_PII_ID_CONFIG).checkText!(
  "Data [NIK_1] sudah kami cek.",
  ctx,
);
reply.text; // "Data 3171011506900001 sudah kami cek."
```

The vault (`ctx.piiVault`) holds the real values for one request only. Never log or persist it.

More examples and evaluation results are in the
[repository](https://github.com/iqbalr3000/palang-ai).

## License

MIT
