import { expect, test } from "bun:test";
import { AdminApiError, createAdminClient } from "./admin-client";

function recordingFetch(response: Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return response.clone();
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("sends the bearer token and drops empty query params", async () => {
  const f = recordingFetch(json({ events: [], next_cursor: null }));
  const client = createAdminClient({ baseUrl: "http://gw:8081/", token: "t0k", fetch: f.fetch });

  await client.events({ tenant: "demo", action: undefined, guard: "", limit: 20 });

  expect(f.calls[0]?.url).toBe("http://gw:8081/admin/events?tenant=demo&limit=20");
  expect(f.calls[0]?.init?.headers).toMatchObject({ Authorization: "Bearer t0k" });
});

test("surfaces the admin API's own error message with its status", async () => {
  const f = recordingFetch(json({ error: { message: 'Unknown tenant "x"' } }, 404));
  const client = createAdminClient({ baseUrl: "http://gw", token: "t", fetch: f.fetch });

  const error = await client.keys("x").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AdminApiError);
  expect(error).toMatchObject({ status: 404, message: 'Unknown tenant "x"' });
});

test("rejects a response that doesn't match the expected shape", async () => {
  const f = recordingFetch(json({ events: "nope" }));
  const client = createAdminClient({ baseUrl: "http://gw", token: "t", fetch: f.fetch });
  await expect(client.events({})).rejects.toThrow();
});

test("revoke accepts the API's empty 204", async () => {
  const f = recordingFetch(new Response(null, { status: 204 }));
  const client = createAdminClient({ baseUrl: "http://gw", token: "t", fetch: f.fetch });
  await expect(client.revokeKey("k1")).resolves.toBeNull();
  expect(f.calls[0]?.init?.method).toBe("DELETE");
});
