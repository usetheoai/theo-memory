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

import {
  EMB_GOOGLE_ROLE,
  EMB_GOOGLE_TENURE,
  EMB_NEWER_5K,
  EMB_OLDER_5K,
  EMB_QUERY_5K,
  EMB_QUERY_GOOGLE,
} from './golden-embeddings.js';

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

// ── knowledge-update-supersession (#144, M23) — REAL strings + FROZEN real embeddings ──
//
// The M22 fixture above uses hand-picked near-identical stub vectors (cos ≈ 0.93 ≥ τ)
// so recencyCollapse fires — a valid test of the SAME-wording near-duplicate case, but
// NOT the real #144 different-wording case. This real fixture ingests the two ACTUAL
// sentences from the LongMemEval `6a1eabeb` failure with FROZEN real
// LocalTransformerEmbedder(384) embeddings (cos 0.5117 ≪ 0.9), so read-time recencyCollapse
// STRUCTURALLY cannot collapse them (the honest counter-proof M22 lacked) — only reflect-time
// LLM supersession bridges "personal best" ↔ "PB". Plus a same-entity/different-attribute
// precision pair (Google role vs tenure) that MUST survive.

const REAL_DIM = 384;

const RealMemorySchema = z.object({
  text: z.string().min(1),
  createdAt: z.string().min(1),
  embedding: z.array(z.number()).length(REAL_DIM),
});

export const KnowledgeUpdateRealFixtureSchema = z.object({
  query5k: z.string().min(1),
  query5kEmbedding: z.array(z.number()).length(REAL_DIM),
  queryGoogle: z.string().min(1),
  queryGoogleEmbedding: z.array(z.number()).length(REAL_DIM),
  embeddingDim: z.literal(REAL_DIM),
  older: RealMemorySchema, // stale "27:12"
  newer: RealMemorySchema, // fresh "25:50" (authoritative)
  googleRole: RealMemorySchema, // same entity, attribute A
  googleTenure: RealMemorySchema, // same entity, attribute B
});

export type KnowledgeUpdateRealFixture = z.infer<typeof KnowledgeUpdateRealFixtureSchema>;

export const KNOWLEDGE_UPDATE_REAL_FIXTURE: KnowledgeUpdateRealFixture =
  KnowledgeUpdateRealFixtureSchema.parse({
    query5k: 'What is my charity 5K personal best?',
    query5kEmbedding: EMB_QUERY_5K,
    queryGoogle: 'Where do I work?',
    queryGoogleEmbedding: EMB_QUERY_GOOGLE,
    embeddingDim: REAL_DIM,
    older: {
      text: 'My personal best time in the charity 5K run is 27:12',
      createdAt: '2020-01-01T00:00:00.000Z',
      embedding: EMB_OLDER_5K,
    },
    newer: {
      text: 'My PB is now 25:50',
      createdAt: '2024-01-01T00:00:00.000Z',
      embedding: EMB_NEWER_5K,
    },
    googleRole: {
      text: 'I work at Google as an engineer',
      createdAt: '2020-01-01T00:00:00.000Z',
      embedding: EMB_GOOGLE_ROLE,
    },
    googleTenure: {
      text: 'I have worked at Google since 2019',
      createdAt: '2024-01-01T00:00:00.000Z',
      embedding: EMB_GOOGLE_TENURE,
    },
  });

/** text → frozen real 384-dim embedding, for the deterministic keyless StubEmbedder. */
export const REAL_EMBEDDING_BY_TEXT: ReadonlyMap<string, readonly number[]> = new Map([
  [KNOWLEDGE_UPDATE_REAL_FIXTURE.older.text, KNOWLEDGE_UPDATE_REAL_FIXTURE.older.embedding],
  [KNOWLEDGE_UPDATE_REAL_FIXTURE.newer.text, KNOWLEDGE_UPDATE_REAL_FIXTURE.newer.embedding],
  [KNOWLEDGE_UPDATE_REAL_FIXTURE.googleRole.text, KNOWLEDGE_UPDATE_REAL_FIXTURE.googleRole.embedding],
  [KNOWLEDGE_UPDATE_REAL_FIXTURE.googleTenure.text, KNOWLEDGE_UPDATE_REAL_FIXTURE.googleTenure.embedding],
  [KNOWLEDGE_UPDATE_REAL_FIXTURE.query5k, KNOWLEDGE_UPDATE_REAL_FIXTURE.query5kEmbedding],
  [KNOWLEDGE_UPDATE_REAL_FIXTURE.queryGoogle, KNOWLEDGE_UPDATE_REAL_FIXTURE.queryGoogleEmbedding],
]);
