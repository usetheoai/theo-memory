-- Embedding of each logged message, for search by meaning (ADR-0031). Nullable: messages logged
-- before this migration, or while the embedder was unavailable, are found by their words only.
-- The dimension follows memories.embedding; runMigrations({ embeddingDim }) alters both together.
-- No ANN index: a search reads only the messages one scope can see, and an exact scan over them
-- gives exact ranks.
ALTER TABLE memory_messages ADD COLUMN IF NOT EXISTS embedding vector(1536);
