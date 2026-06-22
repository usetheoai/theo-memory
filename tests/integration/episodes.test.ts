/**
 * T4.1 — THE GOAL integration test for first-class-episodes (M2 / gap G3).
 *
 * End-to-end against REAL `ankane/pgvector:v0.5.1`. Mirrors Letta's
 * tests/managers/test_message_manager.py shape: temporal-ordered listing, cursor
 * pagination edges (no gap / no overlap), scope/workspace isolation, bi-temporal
 * asOf historical replay, and soft-deleted exclusion — over the EXISTING memory
 * substrate (no new storage engine).
 *
 * Gated by THEOMEM_PG_URI (skips cleanly when unset, per the integration-suite
 * convention; EC-17 CI guard fails loudly when CI=true but unset).
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T4.1 + GOAL
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Embedder, LLM } from '@usetheo/memory';
import { createLocalMemory, encodeEpisodeCursor, PgvectorStore, runMigrations } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];
const DIM = 1536;

if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
  throw new Error('EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/** (refusing false-green skip)');
}

function mkEmbedder(): Embedder {
  const vec = (text: string): readonly number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[(text.length + text.charCodeAt(0)) % DIM] = 1;
    return v;
  };
  return {
    embed: vi.fn(async (t: string) => vec(t)),
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map((t) => vec(t))),
  };
}

/** Content-echo LLM: extracts the user's text verbatim as a single fact. */
function echoLlm(): LLM {
  return {
    generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
      const content = messages.find((m) => m.role === 'user')?.content ?? '';
      const line = content.split('\n').find((l) => l.startsWith('user: ')) ?? '';
      const text = line.replace(/^user:\s*/, '') || content || 'fact';
      return { memory: [{ id: '0', text, attributed_to: 'user' }] };
    }),
    generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
  };
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('first-class-episodes GOAL (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  beforeAll(async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  function buildMemory(): ReturnType<typeof createLocalMemory> {
    return createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: mkEmbedder(),
      llm: echoLlm(),
      entityBoost: false,
    });
  }

  async function rememberSeq(
    scoped: { remember: (t: string) => Promise<unknown> },
    texts: readonly string[],
  ): Promise<void> {
    for (const t of texts) {
      // eslint-disable-next-line no-await-in-loop
      await scoped.remember(t);
    }
  }

  describe('THE GOAL — episodic read surface (real pgvector)', () => {
    test('1. lists a session in temporal order; asc is the reverse of desc', async () => {
      const memory = await buildMemory();
      const session = memory.session('s1');
      await rememberSeq(session, ['e1', 'e2', 'e3', 'e4']);

      const desc = (await session.episodes({ limit: 100 })).items.map((m) => m.id);
      const asc = (await session.episodes({ limit: 100, order: 'asc' })).items.map((m) => m.id);
      expect(desc).toHaveLength(4);
      expect(asc).toEqual([...desc].reverse());
    });

    test('2. cursor pagination has no gap and no overlap across pages', async () => {
      const memory = await buildMemory();
      const session = memory.session('s1');
      await rememberSeq(session, ['a', 'b', 'c', 'd', 'e']);

      const full = (await session.episodes({ limit: 100 })).items.map((m) => m.id);
      const collected: string[] = [];
      let after: string | undefined;
      for (let guard = 0; guard < 20; guard += 1) {
        const opts = after === undefined ? { limit: 2 } : { limit: 2, after };
        // eslint-disable-next-line no-await-in-loop
        const page = await session.episodes(opts);
        collected.push(...page.items.map((m) => m.id));
        if (page.nextCursor === undefined) break;
        after = page.nextCursor;
      }
      expect(collected).toEqual(full);
      expect(new Set(collected).size).toBe(full.length);
    });

    test('3. scope isolation — session s2 episodes are not visible from s1', async () => {
      const memory = await buildMemory();
      await rememberSeq(memory.session('s1'), ['s1-a', 's1-b']);
      await rememberSeq(memory.session('s2'), ['s2-a']);

      const s1 = await memory.session('s1').episodes({ limit: 100 });
      expect(s1.items).toHaveLength(2);
      expect(s1.items.every((m) => m.text.startsWith('s1-'))).toBe(true);

      const foreign = await memory.session('nobody').episodes({ limit: 100 });
      expect(foreign.items).toEqual([]);
    });

    test('4. bi-temporal asOf replay — a row soft-deleted AFTER asOf still appears at asOf', async () => {
      const memory = await buildMemory();
      const session = memory.session('s1');
      const added = await session.remember('temporary fact');
      const id = (added as readonly { id: string }[])[0]?.id;
      if (id === undefined) throw new Error('expected a persisted memory id');

      // DB-side anchor (skew-free): the instant the row is valid, before forget.
      const { rows } = await pool.query<{ now: Date }>('SELECT now() AS now');
      const asOf = rows[0]?.now;
      if (asOf === undefined) throw new Error('expected a db timestamp');

      await session.forget(id); // soft delete → t_invalid = now() > asOf

      const live = await session.episodes({ limit: 100 });
      expect(live.items.map((m) => m.id)).not.toContain(id);

      const replay = await session.episodes({ limit: 100, asOf });
      expect(replay.items.map((m) => m.id)).toContain(id);
    });

    test('5. soft-deleted rows are excluded from the default episode list', async () => {
      const memory = await buildMemory();
      const session = memory.session('s1');
      await session.remember('keep me');
      const toForget = await session.remember('forget me');
      const id = (toForget as readonly { id: string }[])[0]?.id;
      if (id === undefined) throw new Error('expected a persisted memory id');

      await session.forget(id);

      const live = await session.episodes({ limit: 100 });
      const texts = live.items.map((m) => m.text);
      expect(texts).toContain('keep me');
      expect(texts).not.toContain('forget me');
    });

    test('6. queryText is a literal filter — escapes LIKE metacharacters (EC-2)', async () => {
      const memory = await buildMemory();
      const session = memory.session('s1');
      await rememberSeq(session, ['discount 50% off', 'plain 500 units', 'no match here']);

      const page = await session.episodes({ limit: 100, queryText: '50%' });
      const texts = page.items.map((m) => m.text);
      expect(texts).toEqual(['discount 50% off']);
    });

    test('7. nextCursor round-trips (encodeEpisodeCursor decodes to a real page boundary)', async () => {
      const memory = await buildMemory();
      const session = memory.session('s1');
      await rememberSeq(session, ['p1', 'p2', 'p3']);
      const first = await session.episodes({ limit: 1 });
      expect(first.nextCursor).toBeDefined();
      // a hand-built cursor from the last item resumes correctly
      const last = first.items[first.items.length - 1];
      if (last === undefined) throw new Error('expected an item');
      const rebuilt = encodeEpisodeCursor(last.createdAt, last.id);
      const next = await session.episodes({ limit: 1, after: rebuilt });
      expect(next.items[0]?.id).not.toBe(last.id);
    });
  });
}
