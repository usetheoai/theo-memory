/**
 * GOAL test (graph-aware-recall T5.1) — entity-graph-augmented recall end-to-end.
 *
 * Composes against a real pgvector container + the REAL recall pipeline + the
 * REAL entity-linking write path (PgMemoryEntityStore) + the REAL graph traversal
 * (PgGraphExpansionStore JOIN). A stub EntityExtractor links the two stored
 * memories to the SAME entity deterministically; a crafted embedder makes memory
 * A match the query (top result) and memory B NOT match (below threshold). With
 * `graphExpand` ON, B surfaces via the shared entity + `recall_graph_expanded`;
 * default OFF, B stays dropped (byte-unchanged). A second-user memory sharing the
 * entity NAME does NOT surface in the first user's recall (scope isolation — entities
 * are scope-partitioned + the candidate-side scope filter, ADR D5 / EC-2).
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_graph_recall_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

const QUERY = 'alpha';
const MATCH = 'alpha doc'; // near the query → top semantic result
const FAR = 'beta doc'; //   far from the query → below threshold (surfaces only via the graph)

function craftedVec(text: string): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  // 'alpha'-bearing text → axis 0; everything else → axis 1 (cosine 0 with query).
  if (text.includes('alpha')) v[0] = 1;
  else v[1] = 1;
  return v;
}

function craftedEmbedder(): Embedder {
  return {
    embed: async (t: string) => craftedVec(t),
    embedBatch: async (texts: readonly string[]) => texts.map((t) => craftedVec(t)),
  };
}

/** Queue LLM: each remember() stores its input verbatim as the fact. */
function queueLlm(): LLM {
  return {
    generateResponse: async (messages: readonly { role: string; content: string }[]) => {
      const content = messages.find((m) => m.role === 'user')?.content ?? '';
      const line = content.split('\n').find((l) => l.startsWith('user: ')) ?? '';
      const text = line.replace(/^user:\s*/, '') || 'fact';
      return { memory: [{ id: '0', text, attributed_to: 'user' }] };
    },
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

/** Stub extractor: every stored memory links to the SAME entity (deterministic). */
const sharedEntityExtractor = {
  extract: () => [{ type: 'NOUN' as const, name: 'sharedentity' }],
};

function setupTracer(): { tracer: ReturnType<BasicTracerProvider['getTracer']>; exporter: InMemorySpanExporter } {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('graph-recall-goal'), exporter };
}

describe.skipIf(ROOT_PG_URI === '')('graph-aware-recall GOAL — entity-graph-augmented recall', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const adminPool = new pg.Pool({ connectionString: adminUri });
    await adminPool.query(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${ISOLATED_DB}`);
    await adminPool.end();
    pool = new pg.Pool({ connectionString: PG_URI });
    await runMigrations(pool, { embeddingDim: DIM });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('graphExpand ON ⇒ a shared-entity below-threshold memory surfaces + recall_graph_expanded; default OFF ⇒ absent', async () => {
    const { tracer, exporter } = setupTracer();
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const memory = await createLocalMemory({
      vectorStore,
      embedder: craftedEmbedder(),
      embeddingDim: DIM,
      llm: queueLlm(),
      entityExtractor: sharedEntityExtractor,
      tracer,
    });
    const user = memory.user('alice');
    await user.remember(MATCH); // A — near the query
    await user.remember(FAR); //  B — far; linked to the SAME entity as A

    // Default (no graphExpand): only the semantic match A; B stays below threshold.
    const baseline = await user.recall(QUERY, { topK: 10, threshold: 0.1 });
    expect(baseline.map((r) => r.text)).toContain(MATCH);
    expect(baseline.map((r) => r.text)).not.toContain(FAR);

    // graphExpand ON: B surfaces via the shared entity (pool-expansion).
    const expanded = await user.recall(QUERY, { topK: 10, threshold: 0.1, graphExpand: {} });
    expect(expanded.map((r) => r.text)).toContain(MATCH);
    expect(expanded.map((r) => r.text)).toContain(FAR);
    // banded: the genuine semantic hit A still ranks above the graph hit B.
    expect(expanded[0]?.text).toBe(MATCH);
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('recall_graph_expanded');
  }, 60_000);

  it('scope isolation ⇒ a DIFFERENT user\'s shared-entity memory does NOT surface', async () => {
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const memory = await createLocalMemory({
      vectorStore,
      embedder: craftedEmbedder(),
      embeddingDim: DIM,
      llm: queueLlm(),
      entityExtractor: sharedEntityExtractor,
    });
    await memory.user('carol').remember(MATCH); // carol's seed (near query)
    await memory.user('dave').remember(FAR); //    dave's far memory, same entity NAME

    const carol = await memory.user('carol').recall(QUERY, { topK: 10, threshold: 0.1, graphExpand: {} });
    // dave's memory must NEVER surface in carol's recall (entities are scope-partitioned
    // + candidate-side scope filter, EC-2 / ADR D5).
    expect(carol.map((r) => r.text)).toContain(MATCH);
    expect(carol.map((r) => r.text)).not.toContain(FAR);
  }, 60_000);
});
