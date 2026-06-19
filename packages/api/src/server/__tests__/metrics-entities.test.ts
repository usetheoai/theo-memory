/**
 * theo-memory-dashboard-full-integration T2.1/T2.2 — subject-scoped metrics +
 * entities endpoints. Derived from getAll(); entities from attributed_to.
 */
import type { MemoryItem } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function makeItem(id: string, createdAt: string, attributedTo?: string): MemoryItem {
  return {
    id,
    text: `fact-${id}`,
    hash: `h-${id}`,
    scope: { user_id: 'alice' },
    payload: {},
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    attributedTo,
  } as unknown as MemoryItem;
}

function stubMemory(items: readonly MemoryItem[]): Memory {
  const scoped = {
    getAll: vi.fn().mockResolvedValue(items),
    remember: vi.fn(),
    recall: vi.fn(),
    reflect: vi.fn(),
  };
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
  } as unknown as Memory;
}

describe('T2.1 — GET /v1/scopes/:type/:id/metrics', () => {
  test('returns real counts derived from the scope', async () => {
    const items = [
      makeItem('id-1', '2026-06-01T00:00:00Z', 'paulo'),
      makeItem('id-2', '2026-06-02T00:00:00Z', 'paulo'),
      makeItem('id-3', '2026-06-03T00:00:00Z', 'maria'),
      makeItem('id-4', '2026-06-04T00:00:00Z'), // no attribution
    ];
    const app = createServer({ memory: stubMemory(items) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body.total_memories).toBe(4);
    expect(body.entity_count).toBe(2); // paulo + maria (null skipped)
    expect(body.add_events).toBe(4);
    expect(body.retrieval_api_usage).toBe(0);
  });

  test('empty scope returns all zeros (never NaN/null)', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body.total_memories).toBe(0);
    expect(body.entity_count).toBe(0);
  });

  test('unknown scope type → 404', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/Bad/alice/metrics'));
    expect(res.status).toBe(404);
  });
});

describe('T2.2 — GET /v1/scopes/:type/:id/entities', () => {
  test('aggregates by attributed_to with counts + last_seen_at', async () => {
    const items = [
      makeItem('id-1', '2026-06-01T00:00:00Z', 'paulo'),
      makeItem('id-2', '2026-06-05T00:00:00Z', 'paulo'),
      makeItem('id-3', '2026-06-03T00:00:00Z', 'maria'),
      makeItem('id-4', '2026-06-04T00:00:00Z'), // no attribution → excluded
    ];
    const app = createServer({ memory: stubMemory(items) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entities: { id: string; scope_type: string; memory_count: number; last_seen_at: string }[];
    };
    expect(body.entities).toHaveLength(2);
    const paulo = body.entities.find((e) => e.id === 'paulo')!;
    expect(paulo.memory_count).toBe(2);
    expect(paulo.scope_type).toBe('user');
    expect(paulo.last_seen_at).toBe('2026-06-05T00:00:00.000Z');
  });

  test('no attributed_to anywhere → empty list (not null)', async () => {
    const app = createServer({ memory: stubMemory([makeItem('id-1', '2026-06-01T00:00:00Z')]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: unknown[] };
    expect(body.entities).toEqual([]);
  });
});
