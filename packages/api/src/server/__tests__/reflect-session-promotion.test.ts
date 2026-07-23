/**
 * M9-via-REST wiring (session-separation fix, 2026-07-23): the shipped
 * `SessionToGlobalConsolidationPolicy` was SDK-only — no REST caller ever passed
 * `conflictResolution`, so a `POST /v1/reflect { sessionId }` never promoted
 * durable session memories to global. Contract: a session-scoped reflect threads
 * the M9 policy (kind `session-to-global`); other tiers stay unchanged.
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function reflectPost(app: { fetch: (r: Request) => Response | Promise<Response> }, body: object) {
  return Promise.resolve(
    app.fetch(
      new Request('http://localhost/v1/reflect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function harness() {
  const reflect = vi.fn(async (_opts?: unknown) => ({
    higherOrderMemories: [],
    sourceIds: [],
    derivedMemoriesCreated: 0,
  }));
  const scoped = { reflect };
  const tier = vi.fn(() => scoped);
  const memory = {
    withWorkspace: vi.fn(() => ({ user: tier, session: tier, agent: tier })),
    user: tier,
    session: tier,
    agent: tier,
  } as unknown as Memory;
  return { app: createServer({ memory }), reflect };
}

describe('POST /v1/reflect — session tier threads the M9 promotion policy', () => {
  test('sessionId body reflects with conflictResolution kind session-to-global', async () => {
    const { app, reflect } = harness();
    const res = await reflectPost(app, { sessionId: 's1' });
    expect(res.status).toBe(202);
    const opts = reflect.mock.calls[0]?.[0] as
      | { conflictResolution?: { kind: string } }
      | undefined;
    expect(opts?.conflictResolution?.kind).toBe('session-to-global');
  });

  test('userId body reflects WITHOUT conflictResolution (unchanged behavior)', async () => {
    const { app, reflect } = harness();
    const res = await reflectPost(app, { userId: 'alice' });
    expect(res.status).toBe(202);
    const opts = reflect.mock.calls[0]?.[0] as
      | { conflictResolution?: unknown }
      | undefined;
    expect(opts?.conflictResolution).toBeUndefined();
  });
});
