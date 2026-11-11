/**
 * `Memory.reset` over real Postgres under the contained application role: the wipe removes
 * every logged message of the scope, including turns that produced no memory (#246), and a
 * user-bound session reset leaves the user's global memories in place (#247).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createLocalMemory, MAX_EMBEDDING_DIM, PgvectorStore } from '@usetheo/memory';
import type { LLM } from '@usetheo/memory';

import { tenantScopedPool } from '../../packages/core/src/infrastructure/db/tenant-scoped-pool.js';
import { withWorkspaceScope } from '../../packages/core/src/infrastructure/db/workspace-scope.js';

import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

function vectorFor(text: string): number[] {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % MAX_EMBEDDING_DIM;
  v[h] = 1;
  return v;
}
const embedder = {
  embed: (text: string) => Promise.resolve(vectorFor(text)),
  embedBatch: (texts: readonly string[]) => Promise.resolve(texts.map(vectorFor)),
};

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('Memory.reset over Postgres (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  describe('Memory.reset over Postgres', () => {
    let db: IsolatedDb;

    beforeAll(async () => {
      vi.stubEnv('THEMEMORY_API_KEY', undefined);
      db = await createIsolatedDb();
      await db.setupPool.query("INSERT INTO workspaces (id, name) VALUES ('reset-ws', 'Reset') ON CONFLICT DO NOTHING");
    }, 30_000);

    afterAll(async () => {
      vi.unstubAllEnvs();
      await db.dropDb();
    });

    beforeEach(async () => {
      await db.setupPool.query('TRUNCATE memory_message_sources, memory_messages, memories, history RESTART IDENTITY CASCADE');
    });

    async function build(llm: LLM) {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(tenantScopedPool(db.pool)), llm, embedder, embeddingDim: MAX_EMBEDDING_DIM,
      });
      return memory.withWorkspace('reset-ws');
    }

    const count = async (sql: string): Promise<string | undefined> =>
      (await db.setupPool.query<{ n: string }>(sql)).rows[0]?.n;

    test('erases the turns that produced no memory along with the rest of the scope', async () => {
      const facts: unknown[] = [{ memory: [] }, { memory: [{ id: '1', text: 'user lives in Lisbon' }] }];
      const llm: LLM = {
        generateResponse: () => Promise.resolve(facts.shift() ?? { memory: [] }),
        generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
      };
      const memory = await build(llm);
      await withWorkspaceScope('reset-ws', async () => {
        await memory.user('alice').remember('Hey, good to hear from you!');
        await memory.user('alice').remember('I live in Lisbon.');
      });
      expect(await count("SELECT count(*) AS n FROM memory_messages WHERE user_id = 'alice'")).toBe('2');

      await withWorkspaceScope('reset-ws', () => memory.reset({ kind: 'user', userId: 'alice' }));

      expect(await count("SELECT count(*) AS n FROM memory_messages WHERE user_id = 'alice'")).toBe('0');
    });

    test("a user-bound session reset keeps the user's global memories and messages", async () => {
      const llm: LLM = {
        generateResponse: () => Promise.resolve({ memory: [] }),
        generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
      };
      const memory = await build(llm);
      await withWorkspaceScope('reset-ws', async () => {
        await memory.user('alice').remember('global fact about alice', { infer: false });
        await memory.user('alice').remember('Hello there');
        await memory.session('s1', 'alice').remember('session fact', { infer: false });
      });

      await withWorkspaceScope('reset-ws', () => memory.reset({ kind: 'session', sessionId: 's1', userId: 'alice' }));

      expect(await count("SELECT count(*) AS n FROM memories WHERE user_id = 'alice' AND session_id IS NULL")).toBe('1');
      expect(await count("SELECT count(*) AS n FROM memories WHERE session_id = 's1'")).toBe('0');
      // Verbatim writes are logged too, so both global turns remain.
      expect(await count("SELECT count(*) AS n FROM memory_messages WHERE user_id = 'alice' AND session_id IS NULL")).toBe('2');
      expect(await count("SELECT count(*) AS n FROM memory_messages WHERE session_id = 's1'")).toBe('0');
    });
  });
}
