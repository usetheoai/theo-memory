CREATE TABLE "entity_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'default' NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"normalized_relation" text NOT NULL,
	"source_memory_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"session_id" text,
	"agent_id" text
);
--> statement-breakpoint
ALTER TABLE "entity_edges" ADD CONSTRAINT "entity_edges_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_edges" ADD CONSTRAINT "entity_edges_target_entity_id_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_edges" ADD CONSTRAINT "entity_edges_source_memory_id_memories_id_fk" FOREIGN KEY ("source_memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_edges_source_idx" ON "entity_edges" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "entity_edges_target_idx" ON "entity_edges" USING btree ("target_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_edges_scope_triple_uq" ON "entity_edges" USING btree ("workspace_id",COALESCE("user_id", ''),COALESCE("session_id", ''),COALESCE("agent_id", ''),"source_entity_id","normalized_relation","target_entity_id",COALESCE("source_memory_id"::text, ''));