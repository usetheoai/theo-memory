/**
 * Cross-cutting constants shared between core + local + cloud adapters.
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § ADR D1.7
 */

/**
 * Maximum embedding-vector dimension supported at v0.1.
 *
 * Locked at 1536 per ADR D1.7 because:
 *  (a) pgvector v0.5.1 (our convergent image) supports HNSW indexes only up to
 *      2000 dimensions for `vector_cosine_ops`.
 *  (b) 1536 matches Mem0's test-suite mockEmbedding shape verbatim.
 *  (c) Covers OpenAI `text-embedding-3-small` (1536) and `text-embedding-ada-002`
 *      (1536) — the two most common embedders in 2026.
 *
 * Consumers using embedders with > 1536-dim vectors MUST project down inside
 * their `Embedder.embed` implementation. v0.2 plan will retire this cap when
 * the pgvector image bumps to ≥ 0.7.0 (halfvec) or switches to IVFFlat.
 */
export const MAX_EMBEDDING_DIM = 1536;
