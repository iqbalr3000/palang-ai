CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"api_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"stream" boolean NOT NULL,
	"final_action" text NOT NULL,
	"blocked_by" text,
	"status_code" integer NOT NULL,
	"decisions" jsonb NOT NULL,
	"latency_total_ms" integer NOT NULL,
	"latency_guards_ms" integer NOT NULL,
	"latency_upstream_ms" integer,
	"ttft_ms" integer,
	"usage" jsonb,
	"request_content" jsonb,
	"response_content" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_events_tenant_created_idx" ON "audit_events" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_action_created_idx" ON "audit_events" USING btree ("final_action","created_at" DESC NULLS LAST);