/**
 * M27 T5.1 — GET /v1/scopes/:type/:id/memories surfaces `attributed_to` (WHO) as a
 * top-level field so the dashboard/gateway can show it directly. It is stored in
 * `MemoryItem.metadata.attributed_to` (per _attributed-peer.ts); the handler projects it.
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

describe('GET /v1/scopes/user/:id/memories — attributed_to surfacing (M27)', () => {
  test('each listed item carries a top-level attributed_to from metadata', async () => {
    const scoped = {
      getAll: vi.fn(async () => [
        { id: 'm1', text: 'assistant summary', metadata: { attributed_to: 'assistant' }, createdAt: new Date('2026-01-02') },
        { id: 'm2', text: 'a bare fact', metadata: {}, createdAt: new Date('2026-01-01') },
      ]),
      count: vi.fn(async () => 2),
    };
    const memory = {
      withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) })),
      user: vi.fn(() => scoped),
    } as unknown as Memory;
    const app = createServer({ memory });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/memories?limit=25'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; attributed_to: string | null }[] };
    const byId = Object.fromEntries(body.items.map((i) => [i.id, i.attributed_to]));
    expect(byId['m1']).toBe('assistant');
    expect(byId['m2']).toBeNull(); // unattributed → explicit null, field always present
  });
});
