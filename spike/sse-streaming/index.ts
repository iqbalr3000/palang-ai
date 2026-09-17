import { Hono } from "hono";
import { stream } from "hono/streaming";

const UPSTREAM_PORT = 9091;
const GATEWAY_PORT = 8090;
const CHUNK_DELAY_MS = 300;
const NUM_CHUNKS = 5;

// --- Mock upstream: emits SSE chunks on a deliberate delay, proving Bun *sending*
// side can stream without buffering. ---
Bun.serve({
  port: UPSTREAM_PORT,
  fetch(req) {
    if (new URL(req.url).pathname !== "/sse") return new Response("not found", { status: 404 });

    const body = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for (let i = 0; i < NUM_CHUNKS; i++) {
          await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          controller.enqueue(encoder.encode(`data: chunk-${i} t=${Date.now()}\n\n`));
        }
        controller.close();
      },
    });

    return new Response(body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  },
});
console.log(`[mock-upstream] listening on :${UPSTREAM_PORT}`);

// --- Gateway: Hono route that relays the upstream stream via hono/streaming's
// pipe(), the same mechanism TSD's stream processor would sit in front of. ---
const app = new Hono();
app.get("/proxy", async (c) => {
  const upstream = await fetch(`http://localhost:${UPSTREAM_PORT}/sse`);
  c.header("Content-Type", "text/event-stream");
  return stream(c, async (s) => {
    if (upstream.body) await s.pipe(upstream.body);
  });
});
Bun.serve({ port: GATEWAY_PORT, fetch: app.fetch });
console.log(`[gateway] listening on :${GATEWAY_PORT}`);

// --- Client: reads the gateway's response and timestamps each chunk as it
// arrives — this is the actual test. ---
await new Promise((r) => setTimeout(r, 200)); // let servers finish binding

console.log("[client] connecting...");
const clientStart = performance.now();
const res = await fetch(`http://localhost:${GATEWAY_PORT}/proxy`);
const reader = res.body!.getReader();
const decoder = new TextDecoder();
const timestamps: number[] = [];

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const t = performance.now() - clientStart;
  timestamps.push(t);
  console.log(`[client] +${t.toFixed(1)}ms chunk:`, decoder.decode(value).trim());
}

console.log("\n[client] inter-chunk deltas (ms):", timestamps.map((t, i) => (i === 0 ? t : t - timestamps[i - 1]!).toFixed(1)));

const spread = timestamps[timestamps.length - 1]! - timestamps[0]!;
console.log(`[client] first chunk at +${timestamps[0]!.toFixed(1)}ms, last at +${timestamps[timestamps.length - 1]!.toFixed(1)}ms, spread=${spread.toFixed(1)}ms`);
console.log(
  spread > (NUM_CHUNKS - 2) * CHUNK_DELAY_MS
    ? "=> STREAMED: timestamps spread out roughly matching the injected delay, not buffered."
    : "=> BUFFERED: all chunks arrived together — Bun/Hono buffered the response.",
);

process.exit(0);
