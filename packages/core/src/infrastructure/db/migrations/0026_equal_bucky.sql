CREATE TABLE "routing_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"chosen_scope" text NOT NULL,
	"attribution" text NOT NULL,
	"decided_by" text NOT NULL,
	"why" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_audit_scope_check" CHECK ("routing_audit"."chosen_scope" IN ('session', 'global')),
	CONSTRAINT "routing_audit_attribution_check" CHECK ("routing_audit"."attribution" IN ('user', 'agent'))
);
--> statement-breakpoint
CREATE INDEX "routing_audit_ws_user_at_idx" ON "routing_audit" USING btree ("workspace_id","user_id","at");