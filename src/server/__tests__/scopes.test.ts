/**
 * T1.3 RED — GET /v1/scopes/:type/:id/memories paginated listing.
 *
 * - EC-13: scope type case-sensitive enum {user,session,agent,skill}
 * - EC-14: limit cap at 100 (DOS protection)
 * - EC-15: invalid cursor base64+JSON → 400
 * - EC-16 (document): no caching
 *
 * Cursor opaque base64-encoded JSON `{ lastId: string, lastCreatedAt: ISO }`.
 * Two-layer validation per SEPA pre-RED iter 4 MAJOR — base64-decode-OK is
 * NOT sufficient since `Buffer.from('garbage','base64')` does not throw.
 *
 * @see Plan theo-memory-standalone-p0 § T1.3
 */
import { Buffer } from 'node:buffer';

import { describe, expect, test, vi } from 'vitest';

import type { MemoryItem } from '../../core/memory-item.js';
import type { Memory } from '../../core/memory-store.js';
import { createServer } from '../index.js';

function makeItem(id: string, createdAt: string): MemoryItem {
  return {
    id,
    text: `fact-${id}`,
    hash: `h-${id}`,
    scope: { user_id: 'alice' },
    payload: {},
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  } as unknown as MemoryItem;
}

interface StubScoped {
  getAll: ReturnType<typeof vi.fn>;
  remember: ReturnType<typeof vi.fn>;
  recall: ReturnType<typeof vi.fn>;
  reflect: ReturnType<typeof vi.fn>;
}

function stubScopedWithItems(items: readonly MemoryItem[]): StubScoped {
  return {
    getAll: vi.fn().mockResolvedValue(items),
    remember: vi.fn(),
    recall: vi.fn(),
    reflect: vi.fn(),
  };
}

function stubMemory(scoped: StubScoped): Memory {
  const stub = {
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
  return stub;
}

describe('T1.3 — GET /v1/scopes/:type/:id/memories', () => {
  test('5. returns paginated results { items, nextCursor? }', async () => {
    const items = [
      makeItem('id-3', '2026-06-03T00:00:03Z'),
      makeItem('id-2', '2026-06-03T00:00:02Z'),
      makeItem('id-1', '2026-06-03T00:00:01Z'),
    ];
    const scoped = stubScopedWithItems(items);
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: MemoryItem[]; nextCursor?: string };
    expect(body.items).toHaveLength(3);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock-call assertion idiom
    const userMock = memory.user;
    expect(userMock).toHaveBeenCalledWith('alice');
  });

  test('6. scope type case-sensitive — "User" (capitalized) returns 404 (EC-13)', async () => {
    const app = createServer({ memory: stubMemory(stubScopedWithItems([])) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/User/alice/memories'),
    );
    expect(res.status).toBe(404);
  });

  test('7. limit query > 100 returns 422 (EC-14 DOS cap)', async () => {
    const app = createServer({ memory: stubMemory(stubScopedWithItems([])) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?limit=999'),
    );
    expect(res.status).toBe(422);
  });

  test('8. cursor=garbage (invalid base64+JSON) returns 400 (EC-15)', async () => {
    const app = createServer({ memory: stubMemory(stubScopedWithItems([])) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?cursor=garbage!!!'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_CURSOR');
  });

  test('9. cursor=valid-base64-but-bad-shape returns 400 (EC-15 layer 2)', async () => {
    // base64 of `{"bad":true}` decodes cleanly but lacks required cursor fields.
    const badCursor = Buffer.from(JSON.stringify({ bad: true }), 'utf-8').toString('base64');
    const app = createServer({ memory: stubMemory(stubScopedWithItems([])) });
    const res = await app.fetch(
      new Request(
        `http://localhost/v1/scopes/user/alice/memories?cursor=${encodeURIComponent(badCursor)}`,
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_CURSOR');
  });

  test('10. valid cursor filters to items strictly older than cursor', async () => {
    // 3 items in createdAt descending order; cursor at id-2 timestamp.
    // Per EC-15 cursor semantics: return items where (createdAt < cursor.lastCreatedAt)
    // OR (createdAt === lastCreatedAt AND id < lastId).
    const items = [
      makeItem('id-3', '2026-06-03T00:00:03Z'),
      makeItem('id-2', '2026-06-03T00:00:02Z'),
      makeItem('id-1', '2026-06-03T00:00:01Z'),
    ];
    const cursor = Buffer.from(
      JSON.stringify({ lastId: 'id-2', lastCreatedAt: '2026-06-03T00:00:02Z' }),
      'utf-8',
    ).toString('base64');
    const app = createServer({ memory: stubMemory(stubScopedWithItems(items)) });
    const res = await app.fetch(
      new Request(
        `http://localhost/v1/scopes/user/alice/memories?cursor=${encodeURIComponent(cursor)}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: MemoryItem[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe('id-1');
  });

  test('11. limit param clamps result set + emits nextCursor when more remain', async () => {
    const items = [
      makeItem('id-3', '2026-06-03T00:00:03Z'),
      makeItem('id-2', '2026-06-03T00:00:02Z'),
      makeItem('id-1', '2026-06-03T00:00:01Z'),
    ];
    const app = createServer({ memory: stubMemory(stubScopedWithItems(items)) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?limit=2'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: MemoryItem[]; nextCursor?: string };
    expect(body.items).toHaveLength(2);
    expect(typeof body.nextCursor).toBe('string');
  });

  test('12. skill type dispatches to memory.skills(repoId) per ADR-0010', async () => {
    const scoped = stubScopedWithItems([]);
    const memory = stubMemory(scoped);
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/skill/repo-alpha/memories'),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock-call assertion idiom
    const skillsMock = memory.skills;
    expect(skillsMock).toHaveBeenCalledWith('repo-alpha');
  });

  test('13. empty :id path segment yields 404 per Hono routing', async () => {
    const app = createServer({ memory: stubMemory(stubScopedWithItems([])) });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user//memories'),
    );
    expect(res.status).toBe(404);
  });
});
