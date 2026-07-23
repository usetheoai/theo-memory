/**
 * #113 — Overview metrics must report the REAL scope total, not the getAll page.
 * Live: a 440-memory scope showed "TOTAL MEMORIES = 100" (the page cap) on the
 * dashboard. The contract gains `ScopedMemory.count()` (store-level COUNT(*)),
 * and the metrics handler reports it for total_memories/add_events.
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

describe('#113 — GET /v1/scopes/user/:id/metrics reports the real total', () => {
  test('total_memories/add_events come from count(), not the 100-item page', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `m${String(i)}`, text: 't', metadata: {} }));
    const scoped = {
      getAll: vi.fn(async () => page),
      count: vi.fn(async () => 440),
    };
    const memory = {
      withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) })),
      user: vi.fn(() => scoped),
    } as unknown as Memory;
    const app = createServer({ memory });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/metrics'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total_memories: number; add_events: number };
    expect(body.total_memories).toBe(440);
    expect(body.add_events).toBe(440);
    expect(scoped.count).toHaveBeenCalled();
  });
});
