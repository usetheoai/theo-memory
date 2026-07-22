CREATE TABLE "routing_policies" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"default_scope" text DEFAULT 'session' NOT NULL,
	"llm_routing" boolean DEFAULT false NOT NULL,
	"confirmation_threshold" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_policies_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "routing_policies_scope_check" CHECK ("routing_policies"."default_scope" IN ('session', 'global'))
);
