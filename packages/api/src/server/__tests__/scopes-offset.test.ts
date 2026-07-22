/**
 * Dashboard pager live finding (2026-07-22): the scope listing ignored `offset`
 * (not even parsed) — every dashboard page rendered the same first items.
 * Contract: `?offset=N` threads to `getAll({ topK, offset })` on the fast path
 * (no cursor/date filters) and the response carries the REAL scope `total`.
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

describe('GET /v1/scopes/user/:id/memories — offset pagination', () => {
  test('offset threads to getAll and total is included', async () => {
    const calls: unknown[] = [];
    const scoped = {
      getAll: vi.fn(async (opts: unknown) => {
        calls.push(opts);
        return [{ id: 'm26', text: 'row 26', metadata: {}, createdAt: new Date('2026-01-01') }];
      }),
      count: vi.fn(async () => 650),
    };
    const memory = {
      withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) })),
      user: vi.fn(() => scoped),
    } as unknown as Memory;
    const app = createServer({ memory });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/memories?limit=25&offset=25'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total?: number };
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(650);
    // topK = limit+1 (hasMore probe contract); offset threads verbatim.
    expect(calls[0]).toMatchObject({ topK: 26, offset: 25 });
  });

  test('negative offset is rejected (422)', async () => {
    const memory = { user: vi.fn() } as unknown as Memory;
    const app = createServer({ memory });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/memories?offset=-1'));
    expect(res.status).toBe(422);
  });
});
