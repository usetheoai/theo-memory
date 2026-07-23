/**
 * Session enumeration surface (session-separation fix, 2026-07-23): the M8 model
 * (session = (workspace, user, session) working memory vs global = (workspace, user))
 * shipped with NO way to enumerate a user's sessions — the dashboard SESSION tabs
 * were type selectors without an instance selector (dead ends). Contract:
 * `GET /v1/scopes/user/:id/sessions` returns `{ sessions: [{ sessionId,
 * memoryCount, lastActivityAt }] }` from the store's DISTINCT session_id query.
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

/** Server whose user scope resolves to the given scoped-memory stub. */
function serverFor(scoped: object) {
  const memory = {
    withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) })),
    user: vi.fn(() => scoped),
  } as unknown as Memory;
  return createServer({ memory });
}

describe('GET /v1/scopes/user/:id/sessions — session enumeration', () => {
  test('returns the scope sessions from listSessions', async () => {
    const scoped = {
      listSessions: vi.fn(async () => [
        { sessionId: 's-b', memoryCount: 4, lastActivityAt: new Date('2026-07-23T10:00:00Z') },
        { sessionId: 's-a', memoryCount: 1, lastActivityAt: new Date('2026-07-22T09:00:00Z') },
      ]),
    };
    const app = serverFor(scoped);
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/sessions'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: { sessionId: string; memoryCount: number }[] };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0]).toMatchObject({ sessionId: 's-b', memoryCount: 4 });
    expect(scoped.listSessions).toHaveBeenCalledTimes(1);
  });

  test('non-user scope type is a 404 (sessions belong to a user)', async () => {
    const app = serverFor({});
    const res = await app.fetch(new Request('http://localhost/v1/scopes/session/s1/sessions'));
    expect(res.status).toBe(404);
  });

  test('scoped memory without listSessions capability is a 501, not a crash', async () => {
    const app = serverFor({}); // legacy scoped memory without the capability
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/sessions'));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('SESSIONS_LISTING_NOT_SUPPORTED');
  });
});
