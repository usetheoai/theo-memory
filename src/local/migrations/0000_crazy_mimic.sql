CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"memory_id" uuid NOT NULL,
	"event" text NOT NULL,
	"prev_text" text,
	"new_text" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"messages" jsonb
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"hash" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"payload" jsonb NOT NULL,
	"user_id" text,
	"session_id" text,
	"agent_id" text,
	"t_valid" timestamp with time zone DEFAULT now(),
	"t_invalid" timestamp with time zone,
	"text_lemmatized" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "history" ADD CONSTRAINT "history_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_name_idx" ON "entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "entities_embedding_hnsw_idx" ON "entities" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "history_memory_id_idx" ON "history" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "history_timestamp_idx" ON "history" USING btree ("timestamp" DESC, "id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "memories_hash_unique_idx" ON "memories" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "memories_user_id_idx" ON "memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memories_session_id_idx" ON "memories" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "memories_agent_id_idx" ON "memories" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);