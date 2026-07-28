-- Migration 0010: Semantic recall cache table for semantic-recall-cache v1.5.0
--
-- Backs the 13th DIP `RecallCacheStore` per
-- `semantic-recall-cache-v1-5-plan.md § T0.2`. Cache key composition
-- `(scope_key, query_embedding)` per blueprint D4: scope_key isolates per-tier
-- results; HNSW partial index on `query_embedding` (vector_cosine_ops) powers
-- the cosine-similarity lookup at `get()`. Independent table — does NOT FK
-- back to memories; write-triggered `invalidateScope()` is the correctness gate.
--
-- HNSW parameters `m=16, ef_construction=64` are pgvector v0.5.1 defaults
-- (EC-15 DOCUMENT absorption / ADR D7 v1.1 amendment) — tuning DEFERRED to
-- v1.5.x dogfood-evidence-driven adjustment per Inquebrável Rule 11 (YAGNI).
--
-- Idempotency: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`
-- mirror the v1.1 EC-6 pattern (closes the orphan-schema collision footgun
-- documented in architecture.md § 10.2).
--
-- Parametric dim: column declares `vector(1536)` literally; when
-- `runMigrations({ embeddingDim: N })` rewrites memories.embedding,
-- `applyDimChange()` must also rewrite this column to keep cache aligned
-- with embedder. T2.1 (cache factory wrap) is the canonical mismatch
-- detection gate via `atttypmod` probe (EC-2 absorption).
--
-- @see src/core/dip/recall-cache-store.ts (13th DIP contract — T0.1)
CREATE TABLE IF NOT EXISTS "recall_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope_key" text NOT NULL,
	"query_embedding" vector(1536) NOT NULL,
	"result_set" jsonb NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"threshold_used" real DEFAULT 0.8 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_cache_scope_hnsw_idx" ON "recall_cache" USING hnsw ("query_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_cache_scope_key_idx" ON "recall_cache" USING btree ("scope_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recall_cache_expires_at_idx" ON "recall_cache" USING btree ("expires_at") WHERE "recall_cache"."expires_at" IS NOT NULL;
