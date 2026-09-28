import { createApp } from "./app.js";

const port = Number(process.env.MOCK_UPSTREAM_PORT ?? 9090);
// A dev tool: loopback unless a container or another machine needs it.
const hostname = process.env.MOCK_UPSTREAM_HOST ?? "127.0.0.1";

Bun.serve({ hostname, port, fetch: createApp().fetch });
console.log(`[mock-upstream] listening on ${hostname}:${port}`);
