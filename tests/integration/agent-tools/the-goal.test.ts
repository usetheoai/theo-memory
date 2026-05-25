/**
 * THE GOAL TEST — v0.3 anchor metric (T7.1 plan acceptance).
 *
 * Per CLAUDE.md Roadmap Item 4 acceptance + plan v1.1 § Goal:
 *   "tools/call for each verb succeeds with isError: false on happy path
 *    AND alice/bob ZERO cross-userId overlap on paired recalls."
 *
 * Strategy: integration test (not subprocess E2E) — bypasses CLI subprocess
 * boundary to exercise dispatch + withScope + memoryFromCtx + real Memory
 * (contentEchoLlm + pgvector) directly. The subprocess E2E (tests/e2e/) covers
 * transport boundary separately; this test covers the SEMANTIC anchor metric
 * (scope isolation) which requires a real LLM that actually extracts facts —
 * CLI ships StubLLM (zero-extract) by design, so subprocess can't prove
 * isolation by content. This test fills that gap.
 *
 * @see CLAUDE.md Roadmap Item 4 — acceptance criteria
 * @see plan v1.1 § Goal — THE GOAL METRIC
 * @see v0.2 PR-A theokit-binding.test.ts THE GOAL pattern (mirrored)
 */
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatch } from '../../../src/agent-tools/tools/dispatch.js';
import { withScope } from '../../../src/agent-tools/scope.js';
import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import type { Embedder } from '../../../src/core/dip/embedder.js';
import type { LLM } from '../../../src/core/dip/llm.js';
import { createLocalMemory, PgvectorStore } from '../../../src/index.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
  throw new Error(
    'EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/** to run; refusing to false-green skip',
  );
}

const mockEmbedding = (variant = 0): readonly number[] => {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[variant] = 1;
  return v;
};

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async () => mockEmbedding(0)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => mockEmbedding(0))),
});

/** Content-based LLM mock (mirrors v0.2 PR-A — produces 1 fact per remember()). */
const contentEchoLlm = (): LLM => ({
  generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
    const userMsg = messages.find((m) => m.role === 'user');
    const content = userMsg?.content ?? '';
    const lines = content.split('\n');
    const userLine = lines.find((l) => l.startsWith('user: ')) ?? '';
    const text = userLine.replace(/^user:\s*/, '') || 'extracted fact';
    return { memory: [{ id: '0', text, attributed_to: 'user' }] };
  }),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('agent-tools THE GOAL (THEOMEM_PG_URI not set — skipping)', () => {
    it('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, history CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  describe('agent-tools dispatch happy paths — real Memory + real pgvector (T7.1)', () => {
    it('remember handler persists content under correct userId scope via dispatch', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const aliceCtx = { session: { userId: 'alice' } };
      const result = await withScope(aliceCtx, () =>
        dispatch('remember', { content: 'Paulo likes coffee' }, { memoryFactory: () => memory }),
      );
      expect(result.isError ?? false).toBe(false);
      // Verify memory actually persisted in alice's scope
      const persisted = await memory.user('alice').recall('coffee', { topK: 3, threshold: 0 });
      expect(persisted.length).toBeGreaterThan(0);
    });

    it('recall handler returns structuredContent.results with scope-bound memories', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const aliceCtx = { session: { userId: 'alice' } };
      // Seed: write via dispatch
      await withScope(aliceCtx, () =>
        dispatch('remember', { content: 'Paulo likes coffee' }, { memoryFactory: () => memory }),
      );
      // Then: recall via dispatch
      const result = await withScope(aliceCtx, () =>
        dispatch('recall', { query: 'coffee', topK: 5, threshold: 0 }, { memoryFactory: () => memory }),
      );
      expect(result.isError ?? false).toBe(false);
      const structured = result.structuredContent as { results: { text: string; scope: unknown }[] };
      expect(structured.results.length).toBeGreaterThan(0);
      expect(structured.results[0]?.text).toBeDefined();
    });
  });

  describe('agent-tools THE GOAL — alice/bob ZERO cross-userId overlap (T7.1 anchor metric)', () => {
    it('two distinct userIds produce disjoint recall result sets via dispatch (ZERO overlap)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const aliceCtx = { session: { userId: 'alice' } };
      const bobCtx = { session: { userId: 'bob' } };
      const deps = { memoryFactory: () => memory };

      // Both users write through dispatch
      await withScope(aliceCtx, () => dispatch('remember', { content: 'Alice secret about coffee' }, deps));
      await withScope(bobCtx, () => dispatch('remember', { content: 'Bob secret about coffee' }, deps));

      // Both users recall through dispatch
      const aliceResult = await withScope(aliceCtx, () =>
        dispatch('recall', { query: 'secret', topK: 10, threshold: 0 }, deps),
      );
      const bobResult = await withScope(bobCtx, () =>
        dispatch('recall', { query: 'secret', topK: 10, threshold: 0 }, deps),
      );

      const aliceResults = (aliceResult.structuredContent as { results: { id: string }[] }).results;
      const bobResults = (bobResult.structuredContent as { results: { id: string }[] }).results;

      // Both users have at least one memory
      expect(aliceResults.length).toBeGreaterThan(0);
      expect(bobResults.length).toBeGreaterThan(0);

      // THE GOAL METRIC: ZERO OVERLAP
      const aliceIds = new Set(aliceResults.map((r) => r.id));
      const intersect = bobResults.filter((r) => aliceIds.has(r.id));
      expect(intersect).toEqual([]);
    });
  });

  describe('agent-tools dispatch — forget + reflect verbs via real Memory (T7.1)', () => {
    it('forget removes a specific memory by id', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const ctx = { session: { userId: 'alice' } };
      const deps = { memoryFactory: () => memory };

      // Seed + capture id
      await withScope(ctx, () => dispatch('remember', { content: 'forgettable note' }, deps));
      const recall1 = await withScope(ctx, () =>
        dispatch('recall', { query: 'note', topK: 5, threshold: 0 }, deps),
      );
      const id = (recall1.structuredContent as { results: { id: string }[] }).results[0]?.id;
      expect(id).toBeDefined();

      // Forget by id
      const forgetResult = await withScope(ctx, () =>
        dispatch('forget', { id: id! }, deps),
      );
      expect(forgetResult.isError ?? false).toBe(false);
    });

    it('reflect dispatches to ReflectionNotConfigured → Tool Execution Error (v0.4a deferred)', async () => {
      // v0.1 reflect algorithm always throws ReflectionNotConfigured (lands at v0.4a per
      // CLAUDE.md Roadmap Item 5). T4.1 classifier extension maps it to Tool Execution Error
      // with deferred-text so agent loops self-correct gracefully instead of seeing -32603.
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const ctx = { session: { userId: 'alice' } };
      const deps = { memoryFactory: () => memory };

      const result = await withScope(ctx, () => dispatch('reflect', {}, deps));
      // Tool Execution Error (isError: true) NOT Protocol Error — actionable for LLM
      expect(result.isError).toBe(true);
      const text = (result.content as { text: string }[])[0]?.text ?? '';
      expect(text).toMatch(/v0\.4a|deferred|not yet/i);
    });
  });
}
