/**
 * Session-tier user binding via the edge header (session-separation live
 * finding, 2026-07-23): a session-scoped write through the gateway carried NO
 * user binding — the broker key's Principal is workspace-admin (userId null)
 * and `X-Theo-User-Id` only applied to tier-less bodies — so session rows
 * landed with `user_id NULL`, breaking session enumeration AND the
 * SESSION ∪ GLOBAL read union. Contract: `actingUserId` = Principal userId
 * (member) ?? edge header ?? undefined, threaded into every scope resolution.
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function harness() {
  const sessionCalls: unknown[][] = [];
  const scoped = {
    remember: vi.fn(async () => []),
    getAll: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
  };
  const session = vi.fn((...args: unknown[]) => {
    sessionCalls.push(args);
    return scoped;
  });
  const memory = {
    withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped), session })),
    user: vi.fn(() => scoped),
    session,
  } as unknown as Memory;
  return { app: createServer({ memory }), sessionCalls, scoped };
}

describe('session-tier scope binds the edge-injected acting user', () => {
  test('POST /v1/remember { sessionId } + X-Theo-User-Id binds (session, user)', async () => {
    const { app, sessionCalls } = harness();
    const res = await app.fetch(
      new Request('http://localhost/v1/remember', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Theo-User-Id': 'alice',
        },
        body: JSON.stringify({ sessionId: 's1', text: 'a fact worth keeping' }),
      }),
    );
    expect(res.status).toBe(201);
    expect(sessionCalls[0]).toEqual(['s1', 'alice']);
  });

  test('GET /v1/scopes/session/:id/memories + X-Theo-User-Id binds (session, user)', async () => {
    const { app, sessionCalls } = harness();
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/session/s1/memories', {
        headers: { 'X-Theo-User-Id': 'alice' },
      }),
    );
    expect(res.status).toBe(200);
    expect(sessionCalls[0]).toEqual(['s1', 'alice']);
  });

  test('without the header the session scope stays workspace-scoped (unchanged)', async () => {
    const { app, sessionCalls } = harness();
    await app.fetch(new Request('http://localhost/v1/scopes/session/s1/memories'));
    expect(sessionCalls[0]).toEqual(['s1', undefined]);
  });
});
