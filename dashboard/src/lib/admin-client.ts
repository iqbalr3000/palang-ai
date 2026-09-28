import { z } from "zod";

// Response shapes of the gateway's admin API (gateway/src/admin). Validated, not trusted.

const actionSchema = z.enum(["allow", "flag", "block"]);
export type Action = z.infer<typeof actionSchema>;

const decisionSchema = z
  .object({
    guard: z.string(),
    action: z.enum(["allow", "block", "modify", "flag"]),
    reason: z.string().optional(),
    score: z.number().optional(),
    wouldBlock: z.boolean().optional(),
    latencyMs: z.number(),
    findings: z
      .array(z.object({ type: z.string(), meta: z.record(z.unknown()).optional() }).passthrough())
      .optional(),
  })
  .passthrough();
export type Decision = z.infer<typeof decisionSchema>;

export const statsSchema = z.object({
  from: z.string(),
  to: z.string(),
  tenant: z.string().nullable(),
  bucket: z.enum(["hour", "day"]),
  totals: z.record(z.number()),
  buckets: z.array(z.object({ start: z.string(), action: actionSchema, count: z.number() })),
  by_guard: z.array(z.object({ guard: z.string(), action: z.string(), count: z.number() })),
  top_block_reasons: z.array(z.object({ reason: z.string().nullable(), count: z.number() })),
  latency_ms: z.object({
    total_p50: z.number().nullable(),
    total_p95: z.number().nullable(),
    guards_p50: z.number().nullable(),
    guards_p95: z.number().nullable(),
  }),
  guard_latency_p95_ms: z.record(z.number()),
});
export type Stats = z.infer<typeof statsSchema>;

const eventSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  api_key_id: z.string().nullable(),
  created_at: z.string(),
  model: z.string(),
  stream: z.boolean(),
  final_action: actionSchema,
  blocked_by: z.string().nullable(),
  status_code: z.number(),
  decisions: z.array(decisionSchema),
  latency_total_ms: z.number(),
  latency_guards_ms: z.number(),
  latency_upstream_ms: z.number().nullable(),
  ttft_ms: z.number().nullable(),
  usage: z.unknown(),
  // Optional: a gateway older than the dashboard doesn't send it.
  api_key: z
    .object({ id: z.string(), name: z.string(), prefix: z.string(), revoked: z.boolean() })
    .nullish(),
});
export type AuditEvent = z.infer<typeof eventSchema>;

const eventPageSchema = z.object({
  events: z.array(eventSchema),
  next_cursor: z.string().nullable(),
});
export type EventPage = z.infer<typeof eventPageSchema>;

const eventDetailSchema = eventSchema.extend({
  request_content: z.unknown(),
  response_content: z.unknown(),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;

const tenantSchema = z
  .object({
    id: z.string(),
    failure_mode: z.string(),
    allowed_models: z.array(z.string()),
    guards: z.record(z.unknown()),
  })
  .passthrough();
export type Tenant = z.infer<typeof tenantSchema>;

const keySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  prefix: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
export type ApiKey = z.infer<typeof keySchema>;

const createdKeySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  prefix: z.string(),
  key: z.string(),
});
export type CreatedKey = z.infer<typeof createdKeySchema>;

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface EventQuery {
  tenant?: string;
  action?: Action;
  guard?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function createAdminClient(options: { baseUrl: string; token: string; fetch?: Fetch }) {
  const doFetch = options.fetch ?? fetch;

  async function request<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${options.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${options.token}`, ...init?.headers },
      cache: "no-store",
    });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "message" in body.error &&
        typeof body.error.message === "string"
          ? body.error.message
          : `admin API responded ${res.status}`;
      throw new AdminApiError(res.status, message);
    }
    return schema.parse(res.status === 204 ? null : await res.json());
  }

  return {
    stats: (params: { from?: string; to?: string; tenant?: string }) =>
      request(statsSchema, `/admin/stats${query(params)}`),
    events: (params: EventQuery) =>
      request(eventPageSchema, `/admin/events${query({ ...params })}`),
    event: (id: string) => request(eventDetailSchema, `/admin/events/${encodeURIComponent(id)}`),
    tenants: () =>
      request(z.object({ tenants: z.array(tenantSchema) }), "/admin/tenants").then(
        (r) => r.tenants,
      ),
    keys: (tenantId: string) =>
      request(
        z.object({ keys: z.array(keySchema) }),
        `/admin/tenants/${encodeURIComponent(tenantId)}/keys`,
      ).then((r) => r.keys),
    createKey: (tenantId: string, name: string) =>
      request(createdKeySchema, `/admin/tenants/${encodeURIComponent(tenantId)}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    revokeKey: (keyId: string) =>
      request(z.null(), `/admin/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" }),
    config: () => request(z.record(z.unknown()), "/admin/config"),
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;
