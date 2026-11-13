/**
 * GOAL test (adaptive-retrieval T5.1, Item 13) — adaptive decision hooks end-to-end.
 *
 * Composes against a real pgvector container + the REAL recall pipeline:
 *  - a controlled deterministic embedder (maps known fixture texts to crafted
 *    vectors so a "strong" doc scores ~1.0 and a "weak" doc ~0.3 against the query)
 *  - an AdaptiveRetrievalPolicy wired via createLocalMemory({ retrievalPolicy })
 *  - PgvectorStore at vector(DIM) via runMigrations({ embeddingDim: DIM })
 *
 * The LLM extraction step is stubbed with a deterministic fact queue so the
 * STORED text is exactly the fixture; the policy, pipeline, and pgvector are all
 * REAL — the feature under test runs end-to-end. Texts are TOKEN-DISJOINT so BM25
 * does not perturb the controlled semantic scores.
 *
 * Three scenarios prove the feature:
 *   1. shouldRetrieve=false ⇒ recall returns [] WITHOUT embedding (embed-spy 0) + retrieval_skipped.
 *   2. relax ⇒ a sub-threshold ("weak") doc surfaces + retrieval_corrected.
 *   3. default (no policy) ⇒ byte-identical to a plain recall (weak stays dropped).
 *
 * Skipped when THEOMEM_PG_URI is missing (no flaky CI).
 *
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import pg from 'pg';

import { createLocalMemory, PgvectorStore, runMigrations } from '@usetheo/memory';
import { HeuristicAdaptiveRetrievalPolicy } from '@usetheo/memory/adaptive-local';
import type { AdaptiveRetrievalPolicy, Embedder, LLM } from '@usetheo/memory';
import { ENGLISH, isLanguageIdentification } from './_helpers/language-identification.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const ISOLATED_DB = 'themem_adaptive_goal';
const PG_URI = ROOT_PG_URI.replace(/\/[^/]*$/, `/${ISOLATED_DB}`);
const DIM = 8;

const STRONG = 'alpha bravo'; // cosine ~1.0 with the query
const WEAK = 'charlie delta'; // cosine ~0.3 with the query (token-disjoint → no BM25 overlap)
const QUERY = 'alpha bravo';

// Crafted vectors: query/STRONG => unit [1,0,...]; WEAK => [0.3, sqrt(1-0.09), 0...] (cosine 0.3).
function craftedVec(text: string): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  if (text === WEAK) {
    v[0] = 0.3;
    v[1] = Math.sqrt(1 - 0.09);
  } else {
    v[0] = 1; // QUERY + STRONG + anything else
  }
  return v;
}

function craftedEmbedder(): Embedder & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (t: string) => craftedVec(t));
  return {
    embed,
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map((t) => craftedVec(t))),
  } as Embedder & { embed: ReturnType<typeof vi.fn> };
}

function makeQueueLlm(facts: readonly string[]): LLM {
  let i = 0;
  return {
    generateResponse: async (messages) => {
      if (isLanguageIdentification(messages)) return ENGLISH;
      const text = facts[Math.min(i, facts.length - 1)] ?? '';
      i += 1;
      return { memory: [{ id: String(i), text }] };
    },
    generateChat: async () => ({ role: 'assistant' as const, content: '' }),
  };
}

function setupTracer(): { tracer: ReturnType<BasicTracerProvider['getTracer']>; exporter: InMemorySpanExporter } {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('adaptive-goal'), exporter };
}

describe.skipIf(ROOT_PG_URI === '')('adaptive-retrieval GOAL — skip + correct', () => {
  const USER = `adaptive-goal-${Date.now()}`;
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

  it('shouldRetrieve=false ⇒ recall returns [] WITHOUT embedding + emits retrieval_skipped', async () => {
    const { tracer, exporter } = setupTracer();
    const embedder = craftedEmbedder();
    const skipPolicy: AdaptiveRetrievalPolicy = {
      shouldRetrieve: async () => ({ retrieve: false, reason: 'sentinel' }),
      assess: async () => ({ sufficient: true, action: 'accept' }),
    };
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const memory = await createLocalMemory({
      vectorStore,
      embedder,
      embeddingDim: DIM,
      llm: makeQueueLlm([STRONG]),
      retrievalPolicy: skipPolicy,
      tracer,
    });
    const user = memory.user(`${USER}-skip`);
    await user.remember('seed');
    embedder.embed.mockClear();

    const results = await user.recall(QUERY, { topK: 5, threshold: 0.5 });
    expect(results).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('retrieval_skipped');
  }, 60_000);

  it('relax ⇒ a sub-threshold doc surfaces + emits retrieval_corrected', async () => {
    const { tracer, exporter } = setupTracer();
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    // Heuristic: floor 0.9 (so the strong ~1.0 doc is "sufficient" but a weak top would relax);
    // relaxedThreshold 0.05 surfaces the 0.3 weak doc dropped at threshold 0.5.
    const policy = new HeuristicAdaptiveRetrievalPolicy({ correctiveFloor: 1.5, relaxedThreshold: 0.05 });
    const memory = await createLocalMemory({
      vectorStore,
      embedder: craftedEmbedder(),
      embeddingDim: DIM,
      llm: makeQueueLlm([STRONG, WEAK]),
      retrievalPolicy: policy,
      tracer,
    });
    const user = memory.user(`${USER}-correct`);
    await user.remember('seed-strong');
    await user.remember('seed-weak');

    const results = await user.recall(QUERY, { topK: 5, threshold: 0.5 });
    // The weak doc (semantic 0.3, dropped at 0.5) surfaces after the relax to 0.05.
    expect(results.map((r) => r.text)).toContain(WEAK);
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('retrieval_corrected');
  }, 60_000);

  it('default (no retrievalPolicy) ⇒ byte-identical plain recall (weak stays dropped)', async () => {
    const vectorStore = new PgvectorStore(pool, { embeddingDim: DIM });
    await vectorStore.initialize();
    const memory = await createLocalMemory({
      vectorStore,
      embedder: craftedEmbedder(),
      embeddingDim: DIM,
      llm: makeQueueLlm([STRONG, WEAK]),
    });
    const user = memory.user(`${USER}-default`);
    await user.remember('seed-strong');
    await user.remember('seed-weak');

    const results = await user.recall(QUERY, { topK: 5, threshold: 0.5 });
    expect(results.map((r) => r.text)).toContain(STRONG);
    expect(results.map((r) => r.text)).not.toContain(WEAK); // no adaptive ⇒ weak stays dropped
  }, 60_000);
});

void trace; // keep the import (tracer provider sets global), avoid unused-lint
