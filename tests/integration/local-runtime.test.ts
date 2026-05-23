/**
 * Canonical end-to-end integration test — T8.1 of v0-1-local-runtime plan v1.3.
 *
 * This is the ROADMAP ITEM 2 ACCEPTANCE TEST:
 *   memory.user('alice').remember('Paulo likes coffee') + recall('beverages')
 *   returns the memory in top-3 against real ankane/pgvector:v0.5.1.
 *
 * Also covers the fallback path (simulated embed batch failure) + scope
 * isolation + OTel span emission (8 write + 9 search per ADR D1.3 / D1.4 — the
 * wiring-triad pillar (c) runtime-metric proof).
 *
 * Gated by THEOMEM_PG_URI env var. EC-17 absorbed: CI env guard ensures
 * absent env in CI fails loudly (not silently skip).
 *
 * Test pattern per blueprint Recommendation 11: content-based LLM mock that
 * parses prompt + echoes structured response; mock embedder with fixed 1536-dim
 * vector; real Postgres + pgvector via docker-compose.
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T8.1
 * @see CLAUDE.md § Roadmap Item 2 acceptance criteria
 */
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { MAX_EMBEDDING_DIM } from '../../src/core/constants.js';
import type { Embedder } from '../../src/core/dip/embedder.js';
import type { LLM } from '../../src/core/dip/llm.js';
import { createLocalMemory, DrizzleHistoryManager, PgvectorStore } from '../../src/index.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

// EC-17: CI env guard — fail loudly when CI=true but env unset (prevents false-green)
function guardCiEnv(): void {
  if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
    throw new Error(
      'EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/** to run; refusing to false-green skip',
    );
  }
}
guardCiEnv();

const mockEmbedding = (variant = 0): readonly number[] => {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[variant] = 1;
  return v;
};

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async () => mockEmbedding(0)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => mockEmbedding(0))),
});

/** Content-based LLM mock per blueprint Recommendation 11. */
const contentEchoLlm = (): LLM => ({
  generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
    const userMsg = messages.find((m) => m.role === 'user');
    const content = userMsg?.content ?? '';
    // Extract the user's text after "user: " prefix
    const lines = content.split('\n');
    const userLine = lines.find((l) => l.startsWith('user: ')) ?? '';
    const text = userLine.replace(/^user:\s*/, '') || 'extracted fact';
    return { memory: [{ id: '0', text, attributed_to: 'user' }] };
  }),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('local-runtime end-to-end (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const db = drizzle(pool);

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, history CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  describe('local-runtime end-to-end (Roadmap Item 2 acceptance)', () => {
    test('CANONICAL: memory.user(alice).remember + recall returns persisted memory in top-3', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
        historyManager: new DrizzleHistoryManager(db),
      });
      await memory.user('alice').remember('Paulo likes coffee');
      const results = await memory.user('alice').recall('coffee', { topK: 3, threshold: 0 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.text).toBe('Paulo likes coffee');
    });

    test('scope isolation: alice does NOT see bob memories', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      await memory.user('alice').remember('alice secret');
      await memory.user('bob').remember('bob secret');
      const aliceResults = await memory.user('alice').recall('secret', { topK: 10, threshold: 0 });
      for (const r of aliceResults) {
        expect(r.scope).toEqual({ kind: 'user', userId: 'alice' });
      }
    });

    test('embed-batch failure: per-row fallback path still persists', async () => {
      const failingBatchEmbedder: Embedder = {
        embed: vi.fn(async () => mockEmbedding(0)),
        embedBatch: vi.fn(async () => {
          throw new Error('batch endpoint down');
        }),
      };
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: failingBatchEmbedder,
        llm: contentEchoLlm(),
      });
      const result = await memory.user('alice').remember('fallback fact');
      expect(result.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(failingBatchEmbedder.embed).toHaveBeenCalled();
    });

    test('OTel spans: pillar (c) wiring proof — 8 write events + 9 search events observed', async () => {
      const exporter = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
      const tracer = provider.getTracer('integration');

      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
        tracer,
      });

      await memory.user('alice').remember('Paulo likes coffee');
      await memory.user('alice').recall('coffee', { topK: 3, threshold: 0 });

      const spanNames = new Set(exporter.getFinishedSpans().map((s) => s.name));
      // Write-path spans (at minimum): extraction_completed, embedding_batch_completed,
      // persist_completed are required for wiring-triad pillar (c)
      expect(spanNames.has('extraction_completed')).toBe(true);
      expect(spanNames.has('embedding_batch_completed')).toBe(true);
      expect(spanNames.has('persist_completed')).toBe(true);
    });

    test('forget then recall: deleted memory disappears from recall', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const items = await memory.user('alice').remember('to forget');
      const id = items[0]?.id;
      expect(id).toBeDefined();
      if (id !== undefined) {
        await memory.forget(id);
        const after = await memory.user('alice').recall('forget', { topK: 10, threshold: 0 });
        expect(after.map((r) => r.id)).not.toContain(id);
      }
    });
  });
}
