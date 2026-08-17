/**
 * Integration GOAL TEST — mcp-workspace-binding-isolation § T4.1 (theo-memory#82).
 *
 * Proves, against real ankane/pgvector, that the MCP tool dispatch path enforces
 * workspace isolation end-to-end: a `recall` dispatched inside workspace A's scope
 * returns 0 of workspace B's memories, and a cross-workspace `forget` never deletes
 * B's row. This exercises the FULL handler path — dispatch → workspaceScopedMemory
 * (reads the auth-trusted ScopedContext.workspaceId) → Memory.withWorkspace → store —
 * the same path the gateway drives with a per-tenant key.
 *
 * @see tests/integration/auth/workspace-isolation.test.ts — the REST #77 sibling
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';
import { withScope } from '@usetheo/memory-agent-core';
import { dispatch } from '../../../packages/mcp/src/tools/dispatch.js';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<string> {
    return Promise.resolve('[]');
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ content: '[]', role: 'assistant' });
  },
};

function resultsOf(r: { structuredContent?: unknown }): unknown[] {
  const sc = r.structuredContent as { results?: unknown[] } | undefined;
  return sc?.results ?? [];
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('MCP workspace isolation GOAL TEST (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('MCP dispatch workspace isolation (T4.1, #82)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let base: Memory;
    const USER = `alice-${randomUUID()}`;
    const CANARY = 'Tenant B secret is BRAVO-LEAK-CHECK-7788';
    const ctxA = { workspaceId: 'tn-A', session: { userId: USER } } as const;
    const ctxB = { workspaceId: 'tn-B', session: { userId: USER } } as const;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.crossWorkspacePool('mede o isolamento das ferramentas MCP entre dois workspaces');
      dropDb = iso.dropDb;
      base = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
      });
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
    });

    test("tenant A's recall returns 0 of tenant B's memories; B sees its own (the #82 leak is closed)", async () => {
      // Write B's canary through the MCP path, in workspace B's scope.
      await withScope(ctxB, () =>
        dispatch('remember', { content: CANARY, infer: false }, { memoryFactory: () => base }),
      );

      // Cross-tenant: A's scope must NOT see B's canary.
      const aResult = await withScope(ctxA, () =>
        dispatch('recall', { query: CANARY }, { memoryFactory: () => base }),
      );
      expect(resultsOf(aResult)).toHaveLength(0);

      // Same-tenant control: B's scope DOES see its own canary (proves the write landed).
      const bResult = await withScope(ctxB, () =>
        dispatch('recall', { query: CANARY }, { memoryFactory: () => base }),
      );
      expect(resultsOf(bResult).length).toBeGreaterThanOrEqual(1);
    });

    test("a cross-workspace forget from tenant A never deletes tenant B's row", async () => {
      // B writes a row, then learns its id via a B-scoped recall (results carry ids).
      await withScope(ctxB, () =>
        dispatch('remember', { content: CANARY, infer: false }, { memoryFactory: () => base }),
      );
      const bRecall = await withScope(ctxB, () =>
        dispatch('recall', { query: CANARY }, { memoryFactory: () => base }),
      );
      const bRows = resultsOf(bRecall) as Array<{ id?: string }>;
      const id = bRows[0]?.id;
      expect(typeof id).toBe('string');

      // A tries to forget B's id — must not affect B's row (workspace-scoped).
      await withScope(ctxA, () =>
        dispatch('forget', { id: id! }, { memoryFactory: () => base }),
      ).catch(() => undefined); // a 404/typed error is acceptable; what matters is B's row survives

      // B still sees its canary.
      const bAfter = await withScope(ctxB, () =>
        dispatch('recall', { query: CANARY }, { memoryFactory: () => base }),
      );
      expect(resultsOf(bAfter).length).toBeGreaterThanOrEqual(1);
    });
  });
}
