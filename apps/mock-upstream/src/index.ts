import { createApp } from "./app.js";

const port = Number(process.env.MOCK_UPSTREAM_PORT ?? 9090); // TSD §2.2

Bun.serve({ port, fetch: createApp().fetch });
console.log(`[mock-upstream] listening on :${port}`);
