/**
 * knowledge-update (#141) — the LLM-free golden fixture for the recall-time
 * most-recent-wins collapse.
 *
 * Reproduces the M21 LongMemEval counter-proof failure deterministically: two
 * ADD-only duplicates of the SAME fact (a charity-5K personal best), the OLDER
 * one asserting the stale value and the NEWER one the updated value. The stub
 * embeddings are hand-chosen so that (a) both rows are near-duplicates of each
 * other (cosine ≈ 1 ≥ τ, so they collapse) and (b) the OLDER row is MARGINALLY
 * more relevant to the query than the newer one — so a recency-blind recall
 * surfaces the STALE value first (the #141 bug), isolating the ranking claim per
 * the blueprint caveat. The `created_at` timestamps are the INJECTED clock (Q1):
 * older strictly before newer, so the collapse is decided by recency, not by a
 * same-millisecond tiebreak.
 *
 * Zod-validated at module load (fail-closed) — the extraction-golden precedent.
 */
import { z } from 'zod';

/** Small deterministic embedding space; only the first 3 dims carry signal. */
const DIM = 8;
const vec = (a: number, b: number, c: number): readonly number[] => [a, b, c, 0, 0, 0, 0, 0];

const MemorySchema = z.object({
  text: z.string().min(1),
  createdAt: z.string().min(1),
  embedding: z.array(z.number()).length(DIM),
});

export const KnowledgeUpdateFixtureSchema = z.object({
  query: z.string().min(1),
  queryEmbedding: z.array(z.number()).length(DIM),
  probeEmbedding: z.array(z.number()).length(DIM),
  embeddingDim: z.literal(DIM),
  older: MemorySchema,
  newer: MemorySchema,
});

export type KnowledgeUpdateFixture = z.infer<typeof KnowledgeUpdateFixtureSchema>;

export const KNOWLEDGE_UPDATE_FIXTURE: KnowledgeUpdateFixture = KnowledgeUpdateFixtureSchema.parse({
  query: 'charity 5K personal best',
  queryEmbedding: vec(1, 0, 0),
  // Distinct non-zero vector for the factory's dimension probe + any other text.
  probeEmbedding: vec(0, 0, 1),
  embeddingDim: DIM,
  older: {
    text: 'My charity 5K personal best is 27:12.',
    createdAt: '2020-01-01T00:00:00.000Z',
    embedding: vec(1, 0, 0.02), // marginally CLOSER to the query → stale out-ranks fresh
  },
  newer: {
    text: 'My charity 5K personal best is now 25:50.',
    createdAt: '2024-01-01T00:00:00.000Z',
    embedding: vec(1, 0, 0.05), // slightly farther, yet the authoritative (newest) value
  },
});
