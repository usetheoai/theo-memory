/**
 * The raw message log through the public API (createLocalMemory over real Postgres, application
 * role): writes are logged and linked to their facts, the next write's extractor sees the
 * preceding turns, a hard forget erases the source messages, a soft forget keeps them, and
 * `messageLog: false` turns the log off.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type pg from 'pg';

import { createLocalMemory, MAX_EMBEDDING_DIM, PgMessageLog, PgvectorStore } from '@usetheo/memory';
import type { Embedder, LLM, Memory } from '@usetheo/memory';

import { createIsolatedDb, type IsolatedDb } from './_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

/** Distinct, deterministic vectors so different facts never collide as duplicates. */
const embedder: Embedder = {
  embed: (text) => Promise.resolve(vectorFor(text)),
  embedBatch: (texts) => Promise.resolve(texts.map(vectorFor)),
};
function vectorFor(text: string): number[] {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % MAX_EMBEDDING_DIM;
  v[h] = 1;
  return v;
}

/** An extractor that returns one fact per call, echoing the new message, and records its prompts. */
function echoLlm(): LLM & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    generateResponse: (messages) => {
      const system = messages[0]?.content ?? '';
      prompts.push(system);
      const newPart = system.slice(system.lastIndexOf('## New Messages'));
      const said = newPart.split('\n').find((line) => line.startsWith('user: '))?.slice(6) ?? '';
      return Promise.resolve({ memory: [{ id: '0', text: `user said: ${said}` }] });
    },
    generateChat: () => Promise.resolve({ role: 'assistant', content: '' }),
  };
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('message log through createLocalMemory (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  describe('message log through createLocalMemory', () => {
    let db: IsolatedDb;
    let pool: pg.Pool;

    beforeAll(async () => {
      vi.stubEnv('THEMEMORY_API_KEY', undefined);
      db = await createIsolatedDb();
      pool = db.poolPinnedTo('default');
    }, 30_000);

    afterAll(async () => {
      vi.unstubAllEnvs();
      await db.dropDb();
    });

    beforeEach(async () => {
      await db.setupPool.query('TRUNCATE memory_message_sources, memory_messages, memories, history RESTART IDENTITY CASCADE');
    });

    async function build(llm: LLM, extra: { messageLog?: false } = {}): Promise<Memory> {
      return createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder, llm, embeddingDim: MAX_EMBEDDING_DIM, ...extra });
    }

    test('remember logs the message and links it to the fact it produced, by default', async () => {
      const memory = await build(echoLlm());
      const [item] = await memory.user('anna').remember('I took my sister to the pottery class');
      const sources = await new PgMessageLog(pool).sourcesOf({ workspace_id: 'default', user_id: 'anna' }, item!.id);
      expect(sources.map((m) => m.content)).toEqual(['I took my sister to the pottery class']);
    });

    test('the next write in the same scope gives the extractor the previous turn as context', async () => {
      const llm = echoLlm();
      const memory = await build(llm);
      await memory.user('anna').remember('I took my sister to the pottery class');
      await memory.user('anna').remember('She loved it');
      const second = llm.prompts[1] ?? '';
      expect(second).toContain('## Previous Messages');
      expect(second).toContain('user: I took my sister to the pottery class');
    });

    test('another user never sees the turns of the first one as context', async () => {
      const llm = echoLlm();
      const memory = await build(llm);
      await memory.user('anna').remember('my private diary entry');
      await memory.user('bob').remember('hello');
      expect(llm.prompts[1] ?? '').not.toContain('my private diary entry');
    });

    test('a hard forget erases the source messages; nothing of them is left in the log', async () => {
      const memory = await build(echoLlm());
      const [item] = await memory.user('anna').remember('my card number is 4111');
      const count = async (): Promise<string | undefined> =>
        (await pool.query<{ n: string }>(`SELECT count(*) AS n FROM memory_messages WHERE content LIKE '%4111%'`)).rows[0]?.n;
      expect(await count()).toBe('1');
      await memory.user('anna').forget(item!.id, { hard: true });
      expect(await count()).toBe('0');
    });

    test('a soft forget keeps the source messages', async () => {
      const memory = await build(echoLlm());
      const [item] = await memory.user('anna').remember('I used to live in Porto');
      await memory.user('anna').forget(item!.id);
      const sources = await new PgMessageLog(pool).sourcesOf({ workspace_id: 'default', user_id: 'anna' }, item!.id);
      expect(sources.map((m) => m.content)).toEqual(['I used to live in Porto']);
    });

    test('messageLog: false logs nothing and gives no previous turns', async () => {
      const llm = echoLlm();
      const memory = await build(llm, { messageLog: false });
      await memory.user('anna').remember('first');
      await memory.user('anna').remember('second');
      const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM memory_messages');
      expect(rows[0]?.n).toBe('0');
      expect(llm.prompts[1] ?? '').not.toContain('## Previous Messages');
    });
  });
}
