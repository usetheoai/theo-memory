/**
 * entity-extraction-nodes-slice1 T4.2 (ADR D4) — entitiesHandler reads via the
 * injected MemoryEntityStore.list port when wired; maps EntityNodeSummary[] to
 * the UNCHANGED response shape {entities:[{id, memory_count, last_seen_at}]};
 * falls back to attributed_to derivation when no port is wired; surfaces 500
 * when the port rejects (never a masked empty 200).
 *
 */
import type { EntityNodeSummary, Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function stubMemory(): Memory {
  const scoped = {
    getAll: vi.fn().mockResolvedValue([]),
    remember: vi.fn(),
    recall: vi.fn(),
    forget: vi.fn(),
    history: vi.fn(),
  };
  const base = {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn(),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),  } as unknown as Memory;
  (base as unknown as { withWorkspace: (ws: string) => Memory }).withWorkspace = vi
    .fn()
    .mockReturnValue(base);
  return base;
}

const summaries: EntityNodeSummary[] = [
  { id: 'e1', name: 'John Smith', type: 'PROPER', memoryCount: 2, lastSeenAt: '2026-06-03T00:00:00.000Z', summary: '' },
  { id: 'e2', name: 'Google', type: 'PROPER', memoryCount: 1, lastSeenAt: '2026-06-01T00:00:00.000Z', summary: '' },
];

describe('T4.2 — entitiesHandler via injected read port', () => {
  test('session scope threads the acting user into the read-port filters (#118-session)', async () => {
    // RED: the SESSION tab renders empty because filtersFor() builds
    // { session_id } WITHOUT user_id — but entities carry BOTH columns (M8
    // isolation), so the COALESCE(user_id,'')='' predicate matches nothing.
    const listSpy = vi.fn().mockResolvedValue(summaries);
    const app = createServer({
      memory: stubMemory(),
      memoryEntityStore: { upsertAndLink: vi.fn(), supersedeEntity: vi.fn(async () => false), forgetEntity: vi.fn(async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 })), linkedKeysForMemories: vi.fn(async () => new Map()), list: listSpy },
    });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/session/sess-1/entities', {
        headers: { 'X-Theo-User-Id': 'alice' },
      }),
    );
    expect(res.status).toBe(200);
    const call = listSpy.mock.calls[0] as [{ filters: Record<string, unknown> }] | undefined;
    const filters = call?.[0].filters ?? {};
    expect(filters['session_id']).toBe('sess-1');
    expect(filters['user_id']).toBe('alice'); // ← currently undefined = the bug
  });

  test('returns entities from the read port with memory_count, sorted desc', async () => {
    const app = createServer({
      memory: stubMemory(),
      memoryEntityStore: { upsertAndLink: vi.fn(), supersedeEntity: vi.fn(async () => false), forgetEntity: vi.fn(async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 })), linkedKeysForMemories: vi.fn(async () => new Map()), list: vi.fn().mockResolvedValue(summaries) },
    });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: { id: string; memory_count: number; last_seen_at: string }[] };
    expect(body.entities).toHaveLength(2);
    expect(body.entities[0]?.memory_count).toBe(2);
    expect(body.entities[0]?.last_seen_at).toBe('2026-06-03T00:00:00.000Z');
  });

  test('response shape unchanged: id, memory_count, last_seen_at present', async () => {
    const app = createServer({
      memory: stubMemory(),
      memoryEntityStore: { upsertAndLink: vi.fn(), supersedeEntity: vi.fn(async () => false), forgetEntity: vi.fn(async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 })), linkedKeysForMemories: vi.fn(async () => new Map()), list: vi.fn().mockResolvedValue(summaries) },
    });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
    const body = (await res.json()) as { entities: Record<string, unknown>[] };
    const first = body.entities[0]!;
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('memory_count');
    expect(first).toHaveProperty('last_seen_at');
  });

  test('falls back to attributed_to derivation when no read port is wired', async () => {
    const app = createServer({ memory: stubMemory() }); // no memoryEntityStore
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: unknown[] };
    expect(body.entities).toEqual([]); // stub getAll() empty → empty derivation, no throw
  });

  test('read-port rejection surfaces 500 (not a masked empty 200)', async () => {
    const app = createServer({
      memory: stubMemory(),
      memoryEntityStore: {
        upsertAndLink: vi.fn(),
        supersedeEntity: vi.fn(async () => false), forgetEntity: vi.fn(async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 })), linkedKeysForMemories: vi.fn(async () => new Map()),
        list: vi.fn().mockRejectedValue(new Error('db down')),
      },
    });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/entities'));
    expect(res.status).toBe(500);
  });
});
