/**
 * Integration tests for `memoryFromCtx` against real pgvector — T3.1 of plan v0-2-theokit-binding.
 *
 * THE GOAL TEST per plan: two distinct ctx.session.userId values produce DISJOINT
 * recall() result sets (zero overlap) — the runtime-metric proof per Global DoD.
 *
 * Requires `docker compose up -d pgvector` + `THEOMEM_PG_URI` env var. Without
 * the env var the suite SKIPs cleanly (EC-17 false-green guard: CI=true + unset
 * URI is a hard fail, not a silent skip).
 *
 * @see ADR D4 — 3-state resolver invariants exercised end-to-end here
 * @see plan T3.1 Acceptance Criteria
 * @see followups F2-F5 — partial absorption (F3 + F4 + F5; F2 logged for PR-B)
 */
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import type { Embedder } from '@usetheo/memory';
import type { LLM } from '@usetheo/memory';
import { createLocalMemory, MissingScopeError, PgvectorStore } from '@usetheo/memory';
import { memoryFromCtx } from '@usetheo/memory/theokit';
import type { ScopedContext } from '../../packages/core/src/infrastructure/theokit/types.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

// EC-17 guard (mirrors v0.1 pattern): refuse silent CI skip
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

/** Content-based LLM mock (mirrors v0.1 contentEchoLlm — produces 1 fact per remember()). */
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
  describe.skip('theokit-binding (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
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

  describe('memoryFromCtx integration — state (a) happy path', () => {
    test('persists memory under correct userId when handler calls memoryFromCtx(ctx, memory)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const ctx: ScopedContext = { session: { userId: 'alice' } };

      await memoryFromCtx(ctx, memory).remember('Paulo likes coffee');

      const results = await memory.user('alice').recall('coffee', { topK: 3, threshold: 0 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.text.includes('coffee'))).toBe(true);
    });
  });

  describe('memoryFromCtx integration — THE GOAL: isolation across userIds', () => {
    test('two distinct userIds produce disjoint recall result sets (ZERO overlap)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const aliceCtx: ScopedContext = { session: { userId: 'alice' } };
      const bobCtx: ScopedContext = { session: { userId: 'bob' } };

      await memoryFromCtx(aliceCtx, memory).remember('Alice secret about coffee');
      await memoryFromCtx(bobCtx, memory).remember('Bob secret about coffee');

      const aliceResults = await memory.user('alice').recall('secret', { topK: 10, threshold: 0 });
      const bobResults = await memory.user('bob').recall('secret', { topK: 10, threshold: 0 });

      // Both users have at least one memory
      expect(aliceResults.length).toBeGreaterThan(0);
      expect(bobResults.length).toBeGreaterThan(0);

      // ZERO OVERLAP — the runtime-metric proof per Global DoD
      const aliceIds = new Set(aliceResults.map((r) => r.id));
      const intersect = bobResults.filter((r) => aliceIds.has(r.id));
      expect(intersect).toEqual([]);
    });
  });

  describe('memoryFromCtx integration — state (b) unauthenticated', () => {
    test('throws MissingScopeError when ctx.session === null (handler should requireAuth first)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const ctx: ScopedContext = { session: null };

      expect(() => memoryFromCtx(ctx, memory)).toThrow(MissingScopeError);
    });
  });

  describe('memoryFromCtx integration — state (c) session field absent', () => {
    test('throws MissingScopeError when ctx has no session field (non-session-bearing context)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const ctx: ScopedContext = {};

      expect(() => memoryFromCtx(ctx, memory)).toThrow(MissingScopeError);
    });
  });

  describe('memoryFromCtx integration — F5 usability (EC-2 absorption depth)', () => {
    test('scaffolded boot path returns USABLE Memory: recall on empty scope returns [] cleanly (not error)', async () => {
      // F5 from T4.5 followups: verify the binding doesn't crash on empty-scope recall.
      // Scoped instance accepted; recall returns empty array deterministically (no error).
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: contentEchoLlm(),
      });
      const ctx: ScopedContext = { session: { userId: 'fresh-user-with-no-memories' } };

      const scoped = memoryFromCtx(ctx, memory);
      const results = await scoped.recall('anything', { topK: 5, threshold: 0 });

      expect(results).toEqual([]);
    });
  });
}
