/**
 * Integration GOAL TEST — M8 agent-chosen routing (F-xval-1), against real
 * ankane/pgvector via the FULL MCP dispatch path.
 *
 * Proves the routing half of the M8 Goal is functional end-to-end under the HIERARCHICAL
 * recall model (owner decision 2026-07-22): the SAME user, in ONE workspace, writes one fact
 * GLOBALLY (no sessionId → (workspace, user)) and one fact to a SESSION (sessionId →
 * (workspace, user, session)), then:
 *   - a GLOBAL recall returns ONLY the global fact (global-only — session working memory
 *     never leaks into the durable space), and
 *   - a SESSION recall returns BOTH the session fact AND the global fact (session ∪ global —
 *     inside a session the agent recalls its durable knowledge plus the session context).
 * The user identity is always the auth-trusted ScopedContext user (routeScopedMemory never
 * binds an agent-supplied user).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

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

function textsOf(r: { structuredContent?: unknown }): string[] {
  const sc = r.structuredContent as { results?: { text: string }[] } | undefined;
  return (sc?.results ?? []).map((x) => x.text);
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M8 MCP routing GOAL TEST (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M8 MCP agent-chosen routing (global vs session, F-xval-1)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let base: Memory;
    const USER = `alice-${randomUUID()}`;
    const SESSION = `s-${randomUUID()}`;
    const GLOBAL_FACT = 'GLOBAL-ROUTE-FACT alice prefers dark mode everywhere';
    const SESSION_FACT = 'SESSION-ROUTE-FACT the current PR is about M8 isolation';
    const ctx = { workspaceId: 'tn-A', session: { userId: USER } } as const;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.crossWorkspacePool('roteamento resolve o workspace a partir do Principal, entao atravessa');
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

    test('the agent routes writes to global vs session; global is global-only, session is global ∪ session', async () => {
      // GLOBAL write (no sessionId) → (workspace, user).
      await withScope(ctx, () =>
        dispatch('remember', { content: GLOBAL_FACT, infer: false }, { memoryFactory: () => base }),
      );
      // SESSION write (sessionId) → (workspace, user, session).
      await withScope(ctx, () =>
        dispatch(
          'remember',
          { content: SESSION_FACT, sessionId: SESSION, infer: false },
          { memoryFactory: () => base },
        ),
      );

      // GLOBAL recall is GLOBAL-ONLY: it sees the durable global fact and NOT the session
      // working memory (session_id IS NULL AND agent_id IS NULL).
      const globalRecall = await withScope(ctx, () =>
        dispatch('recall', { query: GLOBAL_FACT }, { memoryFactory: () => base }),
      );
      expect(textsOf(globalRecall)).toContain(GLOBAL_FACT);
      expect(textsOf(globalRecall)).not.toContain(SESSION_FACT);

      // SESSION recall is SESSION ∪ GLOBAL: inside the session the agent recalls BOTH the
      // session context AND its durable global knowledge.
      const sessionRecall = await withScope(ctx, () =>
        dispatch('recall', { query: SESSION_FACT, sessionId: SESSION }, { memoryFactory: () => base }),
      );
      expect(textsOf(sessionRecall)).toContain(SESSION_FACT);
      expect(textsOf(sessionRecall)).toContain(GLOBAL_FACT);
    });
  });
}
