CREATE TABLE "memory_entities" (
	"memory_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "memory_entities_memory_id_entity_id_pk" PRIMARY KEY("memory_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "normalized_key" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_entities_entity_id_idx" ON "memory_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_scope_type_key_uq" ON "entities" USING btree ("workspace_id",COALESCE("user_id", ''),COALESCE("session_id", ''),COALESCE("agent_id", ''),COALESCE("type", ''),COALESCE("normalized_key", ''));