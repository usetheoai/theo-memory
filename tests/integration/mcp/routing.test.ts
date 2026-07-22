/**
 * Integration GOAL TEST — M8 agent-chosen routing (F-xval-1), against real
 * ankane/pgvector via the FULL MCP dispatch path.
 *
 * Proves the routing half of the M8 Goal is functional end-to-end: the SAME user, in ONE
 * workspace, writes one fact GLOBALLY (no sessionId → (workspace, user)) and one fact to a
 * SESSION (sessionId → (workspace, user, session)), then a SESSION-scoped recall returns
 * ONLY that session's fact — NOT the global one — so the agent's per-call scope choice
 * actually routes and session memory is a narrow, isolated sub-partition. The user identity
 * is always the auth-trusted ScopedContext user (routeScopedMemory never binds an
 * agent-supplied user).
 *
 * KNOWN SEMANTIC (documented, NOT asserted here): a GLOBAL (user-tier) recall is currently
 * a SUPERSET — it also returns the session-tagged rows, because M8 binds `user_id` into the
 * session scope so those rows now share the user filter. Whether "global" should EXCLUDE
 * session rows (`session_id IS NULL AND agent_id IS NULL`) is a core tier-semantics decision
 * with system-wide impact — surfaced to the owner as an open fork, not decided unilaterally.
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
      pool = iso.pool;
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

    test('the agent routes writes to global vs session; session recall is a narrow, isolated sub-partition', async () => {
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

      // The routing landed the global write: a global recall sees it.
      const globalRecall = await withScope(ctx, () =>
        dispatch('recall', { query: GLOBAL_FACT }, { memoryFactory: () => base }),
      );
      expect(textsOf(globalRecall)).toContain(GLOBAL_FACT);

      // SESSION recall is narrow: it sees ONLY that session's fact, NOT the global one —
      // proving the agent's session choice routed to an isolated (workspace,user,session)
      // sub-partition (the global fact, session_id NULL, is excluded).
      const sessionRecall = await withScope(ctx, () =>
        dispatch('recall', { query: SESSION_FACT, sessionId: SESSION }, { memoryFactory: () => base }),
      );
      expect(textsOf(sessionRecall)).toContain(SESSION_FACT);
      expect(textsOf(sessionRecall)).not.toContain(GLOBAL_FACT);
    });
  });
}
