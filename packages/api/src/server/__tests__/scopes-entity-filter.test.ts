/**
 * Entity-filtered scope listing (theo-cloud#252): the dashboard's Entities
 * cascade-forget deleted the first GLOBAL page (up to 200 arbitrary memories)
 * because no server-side "memories of entity X" filter existed. Contract:
 * `GET /v1/scopes/:type/:id/memories?entity=<name>` threads the entity into
 * `getAll({ entity })` so the store filters via the memory_entities join.
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function serverFor(scoped: object) {
  const memory = {
    withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) })),
    user: vi.fn(() => scoped),
  } as unknown as Memory;
  return createServer({ memory });
}

describe('GET /v1/scopes/user/:id/memories?entity= — entity-filtered listing', () => {
  test('entity threads to getAll alongside topK/offset', async () => {
    const calls: unknown[] = [];
    const scoped = {
      getAll: vi.fn(async (opts: unknown) => {
        calls.push(opts);
        return [{ id: 'm1', text: 'linked row', metadata: {}, createdAt: new Date('2026-01-01') }];
      }),
      count: vi.fn(async () => 1),
    };
    const app = serverFor(scoped);
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?limit=10&entity=Codex'),
    );
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ topK: 11, offset: 0, entity: 'Codex' });
    // Fail-closed echo (incident 2026-07-23): consumers MUST see the applied
    // filter in the response — an old provider ignores unknown query keys
    // silently, and a cascade trusting the unechoed listing deleted 60+
    // unrelated memories. The echo is what lets clients abort.
    const body = (await res.json()) as { entity?: string };
    expect(body.entity).toBe('Codex');
  });

  test('empty entity is rejected (422)', async () => {
    const app = serverFor({ getAll: vi.fn() });
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/user/alice/memories?entity='),
    );
    expect(res.status).toBe(422);
  });
});
