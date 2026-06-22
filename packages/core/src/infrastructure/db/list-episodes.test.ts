/**
 * RED-phase unit tests for VectorStore.listEpisodes (in-memory impl) — T2.1 of
 * first-class-episodes (M2). Validates temporal ordering, cursor pagination edges
 * (no gap / no overlap incl. same-created_at), order direction, queryText LIKE
 * escape, and the cap+1 over-fetch contract. Bi-temporal asOf replay is a
 * pgvector-runtime capability (in-memory hard-deletes → no tombstones) and is
 * covered by the GOAL integration test (T4.1).
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T2.1 (EC-2/3/5)
 */
import { describe, expect, test } from 'vitest';

import { decodeEpisodeCursor, encodeEpisodeCursor, resolveEpisodeLimit } from '../../domain/episode.js';
import type { Filters } from '../../domain/scope.js';
import { InMemoryVectorStore } from './in-memory-store.js';

const SESSION: Filters = { session_id: 's1' };

async function seed(store: InMemoryVectorStore, texts: readonly string[]): Promise<void> {
  for (let i = 0; i < texts.length; i += 1) {
    // Sequential awaits give monotonic-ish createdAt; id tiebreak keeps it
    // deterministic regardless of millisecond collisions.
     
    await store.insert([[0.1, 0.2]], [`id-${String(i).padStart(3, '0')}`], [
      { text: texts[i] as string, session_id: 's1' },
    ]);
  }
}

describe('InMemoryVectorStore.listEpisodes', () => {
  test('orders by (created_at, id) and defaults to desc (newest-first)', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, ['a', 'b', 'c', 'd']);
    const rows = await store.listEpisodes(SESSION, {});
    const ids = rows.map((r) => r.id);
    // desc by created_at; identical-ms rows fall back to id DESC under desc order.
    const sorted = [...ids].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0));
    expect(ids).toEqual(sorted);
  });

  test('order=asc reverses the order', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, ['a', 'b', 'c', 'd']);
    const asc = (await store.listEpisodes(SESSION, { order: 'asc' })).map((r) => r.id);
    const desc = (await store.listEpisodes(SESSION, { order: 'desc' })).map((r) => r.id);
    expect(asc).toEqual([...desc].reverse());
  });

  test('cursor pagination has no gap and no overlap across pages', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, ['a', 'b', 'c', 'd', 'e']);
    const cap = 2;
    const full = (await store.listEpisodes(SESSION, { limit: 1000 })).map((r) => r.id);

    const collected: string[] = [];
    let after: string | undefined;
    // Walk forward with limit=cap, using cap+1 over-fetch to detect more.
    for (let guard = 0; guard < 10; guard += 1) {
      const opts = after === undefined ? { limit: cap } : { limit: cap, after };
       
      const page = await store.listEpisodes(SESSION, opts);
      const kept = page.slice(0, cap);
      collected.push(...kept.map((r) => r.id));
      if (page.length <= cap) {
        break;
      }
      const last = kept[kept.length - 1];
      if (last === undefined) break;
      after = encodeEpisodeCursor(last.createdAt ?? new Date(0), last.id);
    }
    expect(collected).toEqual(full);
    expect(new Set(collected).size).toBe(full.length); // no overlap
  });

  test('over-fetches at most cap+1 rows so the caller can detect more pages', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, ['a', 'b', 'c', 'd', 'e']);
    const cap = resolveEpisodeLimit(2);
    const page = await store.listEpisodes(SESSION, { limit: 2 });
    expect(page.length).toBe(cap + 1);
  });

  test('queryText filters by literal substring (no wildcard semantics in-memory)', async () => {
    // In-memory matches via case-insensitive .includes — inherently literal, so a
    // "50%" query matches ONLY the literal "50%" row, not "500". (The SQL ILIKE
    // ESCAPE path that actually escapes %/_ metacharacters is covered by the
    // pgvector GOAL test.)
    const store = new InMemoryVectorStore();
    await seed(store, ['discount 50% off', 'plain text', 'fifty 500 units']);
    const rows = await store.listEpisodes(SESSION, { queryText: '50%' });
    expect(rows.map((r) => String(r.payload['text']))).toEqual(['discount 50% off']);
  });

  test('isolates by scope filters (other session not visible)', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, ['a', 'b']);
    await store.insert([[0.1, 0.2]], ['other-1'], [{ text: 'x', session_id: 's2' }]);
    const rows = await store.listEpisodes(SESSION, {});
    expect(rows.every((r) => r.payload['session_id'] === 's1')).toBe(true);
    expect(rows).toHaveLength(2);
  });

  test('cursor round-trips through decodeEpisodeCursor for the last kept row', async () => {
    const store = new InMemoryVectorStore();
    await seed(store, ['a', 'b', 'c']);
    const page = await store.listEpisodes(SESSION, { limit: 1 });
    const first = page[0];
    if (first === undefined) throw new Error('expected a row');
    const cursor = encodeEpisodeCursor(first.createdAt ?? new Date(0), first.id);
    expect(decodeEpisodeCursor(cursor).id).toBe(first.id);
  });
});
