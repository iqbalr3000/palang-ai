import { createApp } from "./app.js";

const port = Number(process.env.MOCK_UPSTREAM_PORT ?? 9090);
const hostname = process.env.MOCK_UPSTREAM_HOST ?? "127.0.0.1";

Bun.serve({ hostname, port, fetch: createApp().fetch });
console.log(`[mock-upstream] listening on ${hostname}:${port}`);
