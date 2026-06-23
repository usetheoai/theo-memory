/**
 * theo-memory-dashboard-full-integration T2.1/T2.2 — subject-scoped metrics +
 * entities endpoints. Derived from getAll(); entities from attributed_to.
 */
import type { AuthVerifier, EntityNodeSummary, MemoryEntityStore, MemoryItem, Principal } from '@usetheo/memory/contract';
import type { Memory, UsageCounterStore } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

/** Fake entity store (read side). `list` returns the given summaries; the spy
 *  lets a test assert the workspace+scope params metrics passes. */
function stubEntityStore(names: readonly string[]): {
  store: MemoryEntityStore;
  listSpy: ReturnType<typeof vi.fn>;
} {
  const summaries = names.map(
    (name, i) =>
      ({
        id: `e-${i}`,
        name,
        type: 'PROPER',
        memoryCount: 1,
        firstSeenAt: '2026-06-01T00:00:00.000Z',
        lastSeenAt: '2026-06-01T00:00:00.000Z',
      }) as unknown as EntityNodeSummary,
  );
  const listSpy = vi.fn(async () => summaries);
  return { store: { upsertAndLink: vi.fn(), list: listSpy }, listSpy };
}

/** Stub recall counter that reports a fixed cumulative count. */
function stubCounter(count: number): UsageCounterStore {
  return {
    increment: vi.fn(async () => undefined),
    getRecallCount: vi.fn(async () => count),
  };
}

function makeItem(id: string, createdAt: string, attributedTo?: string): MemoryItem {
  return {
    id,
    text: `fact-${id}`,
    hash: `h-${id}`,
    scope: { user_id: 'alice' },
    payload: {},
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    // REAL getAll() contract: attributed_to is projected into metadata, NOT the
    // top-level attributedTo field. The handlers must read metadata (the bug the
    // Phase 2A e2e caught: reading only top-level returned empty against pgvector).
    metadata: attributedTo !== undefined ? { attributed_to: attributedTo } : {},
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
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),  };
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
    expect(body['total_memories']).toBe(4);
    expect(body['entity_count']).toBe(2); // paulo + maria (null skipped)
    expect(body['add_events']).toBe(4);
    expect(body['retrieval_api_usage']).toBe(0);
  });

  test('empty scope returns all zeros (never NaN/null)', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body['total_memories']).toBe(0);
    expect(body['entity_count']).toBe(0);
  });

  test('unknown scope type → 404', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/Bad/alice/metrics'));
    expect(res.status).toBe(404);
  });

  // F-test-2 — empty-string attributed_to in metadata is excluded (the peerOf
  // `!== ''` guard). A direct SDK/REST caller can persist '' (gateway trim only
  // guards the dashboard path), so the guard must hold server-side.
  test('empty-string attributed_to in metadata is NOT counted', async () => {
    const items = [
      makeItem('id-1', '2026-06-01T00:00:00Z', 'paulo'),
      makeItem('id-2', '2026-06-02T00:00:00Z', ''), // metadata.attributed_to = ''
    ];
    const app = createServer({ memory: stubMemory(items) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    const body = (await res.json()) as Record<string, number>;
    expect(body['total_memories']).toBe(2);
    expect(body['entity_count']).toBe(1); // only paulo; '' excluded
  });
});

describe('EG-3 — entity_count aligned to the entity store (single source of truth)', () => {
  test('entity_count == list().length when the entity store is wired', async () => {
    const { store } = stubEntityStore(['Dune', 'Frank Herbert', 'Japan']);
    const items = [makeItem('id-1', '2026-06-01T00:00:00Z', 'paulo')]; // attributedTo would give 1
    const app = createServer({ memory: stubMemory(items), memoryEntityStore: store });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    const body = (await res.json()) as Record<string, number>;
    expect(body['entity_count']).toBe(3); // graph entities, NOT the 1 attributed peer
  });

  test('metrics entity_count equals the entities-handler list length (wired)', async () => {
    const { store } = stubEntityStore(['Dune', 'Frank Herbert', 'Japan']);
    const app = createServer({ memory: stubMemory([]), memoryEntityStore: store });
    const m = (await (await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'))).json()) as Record<string, number>;
    const e = (await (await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'))).json()) as { entities: unknown[] };
    expect(m['entity_count']).toBe(e.entities.length);
  });

  test('EC-1: metrics entity_count equals entities length on the no-store fallback path too', async () => {
    const items = [
      makeItem('id-1', '2026-06-01T00:00:00Z', 'paulo'),
      makeItem('id-2', '2026-06-02T00:00:00Z', 'maria'),
    ];
    const app = createServer({ memory: stubMemory(items) }); // NO entity store
    const m = (await (await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'))).json()) as Record<string, number>;
    const e = (await (await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'))).json()) as { entities: unknown[] };
    expect(m['entity_count']).toBe(2);
    expect(m['entity_count']).toBe(e.entities.length);
  });

  test('EC-2: metrics calls list() with the same workspace+scope params as entities', async () => {
    const { store, listSpy } = stubEntityStore(['Dune']);
    const app = createServer({ memory: stubMemory([]), memoryEntityStore: store });
    await app.fetch(new Request('http://localhost/v1/scopes/session/sess-7/metrics'));
    expect(listSpy).toHaveBeenCalledWith({ workspaceId: 'default', filters: { session_id: 'sess-7' } });
  });

  test('EC-2: metrics resolves the NON-default principal workspaceId (multi-tenant drift guard)', async () => {
    const { store, listSpy } = stubEntityStore(['Dune']);
    const principal: Principal = { workspaceId: 'ws-9', userId: 'u-1', role: 'owner', scopes: ['memory:read', 'memory:admin'] };
    const authVerifier: AuthVerifier = {
      resolvePrincipal: (t: string) => Promise.resolve(t === 'tok' ? principal : null),
      verify: (t: string) => Promise.resolve(t === 'tok'),
    };
    const app = createServer({ memory: stubMemory([]), memoryEntityStore: store, authVerifier });
    await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/metrics', { headers: { Authorization: 'Bearer tok' } }),
    );
    // A regression that hard-coded 'default' (dropping the principal lookup) would
    // diverge from entities under multi-tenant — this pins the principal path.
    expect(listSpy).toHaveBeenCalledWith({ workspaceId: 'ws-9', filters: { user_id: 'alice' } });
  });
});

describe('T2.4 — retrieval_api_usage from the recall counter', () => {
  test('reports the real cumulative recall count when a counter store is wired', async () => {
    const items = [makeItem('id-1', '2026-06-01T00:00:00Z', 'paulo')];
    const app = createServer({ memory: stubMemory(items), usageCounterStore: stubCounter(2) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    // retrieval_api_usage now reflects the counter; the other 3 stay getAll-derived.
    expect(body['retrieval_api_usage']).toBe(2);
    expect(body['total_memories']).toBe(1);
    expect(body['add_events']).toBe(1);
    expect(body['entity_count']).toBe(1);
  });

  test('response is exactly the 4-field shape (no key added/removed)', async () => {
    const app = createServer({ memory: stubMemory([]), usageCounterStore: stubCounter(5) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    const body = (await res.json()) as Record<string, number>;
    expect(Object.keys(body).sort()).toEqual([
      'add_events',
      'entity_count',
      'retrieval_api_usage',
      'total_memories',
    ]);
  });

  test('falls back to 0 when no counter store is wired (honest, no regression)', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    const body = (await res.json()) as Record<string, number>;
    expect(body['retrieval_api_usage']).toBe(0);
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
