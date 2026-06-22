/**
 * RED — GET /v1/scopes/:type/:id/episodes (first-class-episodes M2 T3.1).
 *
 * - 200 { items, nextCursor? } page
 * - cursor query param forwarded to ScopedMemory.episodes
 * - asOf NaN → 422 (InvalidScope, mirrors recall)
 * - empty/foreign scope → 200 { items: [] } (no existence leak — a list never 404s)
 * - invalid limit (> 200 / 0 / non-numeric) → 422
 * - after + before together → 422 (EC-4)
 * - scope type case-sensitive enum → 404
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T3.1 + ADR D6 + EC-4
 */
import type { EpisodePage, Memory, MemoryItem } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function makeItem(id: string, createdAt: string): MemoryItem {
  return {
    id,
    text: `fact-${id}`,
    hash: `h-${id}`,
    scope: { kind: 'session', sessionId: 's1' },
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    metadata: {},
    tValid: new Date(createdAt),
    tInvalid: null,
  } as unknown as MemoryItem;
}

interface StubScoped {
  episodes: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
  remember: ReturnType<typeof vi.fn>;
  recall: ReturnType<typeof vi.fn>;
  reflect: ReturnType<typeof vi.fn>;
  forget: ReturnType<typeof vi.fn>;
}

function stubScoped(page: EpisodePage): StubScoped {
  return {
    episodes: vi.fn().mockResolvedValue(page),
    getAll: vi.fn().mockResolvedValue([]),
    remember: vi.fn(),
    recall: vi.fn(),
    reflect: vi.fn(),
    forget: vi.fn(),
  };
}

function stubMemory(scoped: StubScoped): Memory {
  return {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
  };
}

describe('GET /v1/scopes/:type/:id/episodes', () => {
  test('200 returns { items, nextCursor } page', async () => {
    const page: EpisodePage = {
      items: [makeItem('id-2', '2026-06-03T00:00:02Z'), makeItem('id-1', '2026-06-03T00:00:01Z')],
      nextCursor: 'CURSOR123',
    };
    const scoped = stubScoped(page);
    const app = createServer({ memory: stubMemory(scoped) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/session/s1/episodes'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: MemoryItem[]; nextCursor?: string };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBe('CURSOR123');
  });

  test('forwards after/limit/order/q to ScopedMemory.episodes', async () => {
    const scoped = stubScoped({ items: [] });
    const app = createServer({ memory: stubMemory(scoped) });
    await app.fetch(
      new Request('http://localhost/v1/scopes/session/s1/episodes?after=ABC&limit=10&order=asc&q=hello'),
    );
    expect(scoped.episodes).toHaveBeenCalledWith(
      expect.objectContaining({ after: 'ABC', limit: 10, order: 'asc', queryText: 'hello' }),
    );
  });

  test('empty / foreign scope → 200 { items: [] } (no existence leak)', async () => {
    const scoped = stubScoped({ items: [] });
    const app = createServer({ memory: stubMemory(scoped) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/session/nobody/episodes'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: MemoryItem[] };
    expect(body.items).toEqual([]);
  });

  test('asOf NaN → 422', async () => {
    const scoped = stubScoped({ items: [] });
    const app = createServer({ memory: stubMemory(scoped) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/session/s1/episodes?asOf=not-a-date'),
    );
    expect(res.status).toBe(422);
  });

  test('invalid limit (> 200) → 422', async () => {
    const scoped = stubScoped({ items: [] });
    const app = createServer({ memory: stubMemory(scoped) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/session/s1/episodes?limit=9999'),
    );
    expect(res.status).toBe(422);
  });

  test('after + before together → 422 (EC-4)', async () => {
    const scoped = stubScoped({ items: [] });
    const app = createServer({ memory: stubMemory(scoped) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/session/s1/episodes?after=A&before=B'),
    );
    expect(res.status).toBe(422);
  });

  test('scope type case-sensitive — "Session" → 404', async () => {
    const scoped = stubScoped({ items: [] });
    const app = createServer({ memory: stubMemory(scoped) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/Session/s1/episodes'));
    expect(res.status).toBe(404);
  });
});
