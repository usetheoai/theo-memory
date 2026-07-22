/**
 * M8 review F-arch-1 / F-tests-2 / F-xval-3 — REST-boundary cross-user isolation.
 *
 * Proves the (workspace, user) boundary holds at the HTTP surface, not only at the
 * SDK layer (packages/core .../cross-user-isolation.test.ts, real pgvector). A
 * user-Principal can NEVER address another user's global/session scope by putting
 * `{userId:'victim'}` / `{sessionId, userId:'victim'}` in the request body or path —
 * the AUTH-TRUSTED `Principal.userId` always wins (ADR D6 boundary-enforced isolation).
 *
 * A recording stub captures WHICH id each `memory.user/session/agent` was resolved
 * with, so the assertion is on the resolved scope, not on stored rows (DB-less, fast).
 * RED before the resolveScope fix: `POST /v1/remember {userId:'alice'}` as Bob
 * resolved `memory.user('alice')` — the IDOR this suite closes.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AuthVerifier, Memory, Principal } from '@usetheo/memory/contract';

import { createApp } from '../app.js';

interface Recorder {
  stub: Memory;
  userCalls: string[];
  sessionCalls: { id: string; userId: string | undefined }[];
}

function recordingMemory(): Recorder {
  const userCalls: string[] = [];
  const sessionCalls: { id: string; userId: string | undefined }[] = [];
  const scoped = {
    remember: vi.fn().mockResolvedValue([]),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'j', derivedCount: 0 }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  const stub = {
    user: vi.fn((id: string) => { userCalls.push(id); return scoped; }),
    session: vi.fn((id: string, userId?: string) => { sessionCalls.push({ id, userId }); return scoped; }),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    history: vi.fn().mockResolvedValue([]),
    reset: vi.fn().mockResolvedValue(undefined),
    flushReflections: vi.fn().mockResolvedValue(undefined),
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),
    withWorkspace: vi.fn().mockReturnThis(),
  };
  return { stub: stub as unknown as Memory, userCalls, sessionCalls };
}

const SCOPES = ['memory:read', 'memory:write', 'memory:delete'];
function verifier(map: Record<string, Principal>): AuthVerifier {
  return {
    resolvePrincipal: (t: string) => Promise.resolve(map[t] ?? null),
    verify: (t: string) => Promise.resolve(map[t] !== undefined),
  };
}

const BOB: Principal = { workspaceId: 'ws', userId: 'bob', role: 'member', scopes: SCOPES };
const ADMIN: Principal = { workspaceId: 'ws', userId: null, role: 'admin', scopes: SCOPES };

function appWith(mem: Memory): ReturnType<typeof createApp> {
  return createApp({ memory: mem, authVerifier: verifier({ 'tok-bob': BOB, 'tok-admin': ADMIN }) });
}

const JSON_HEADERS = (tok: string): Record<string, string> => ({
  Authorization: `Bearer ${tok}`,
  'Content-Type': 'application/json',
});

describe('M8 REST cross-user isolation (F-arch-1 IDOR closed at the HTTP boundary)', () => {
  it('test_remember_user_tier_binds_to_principal_ignoring_body_userId', async () => {
    const rec = recordingMemory();
    const res = await appWith(rec.stub).request('/v1/remember', {
      method: 'POST',
      headers: JSON_HEADERS('tok-bob'),
      body: JSON.stringify({ text: 'x', userId: 'alice' }), // IDOR attempt
    });
    expect(res.status).toBe(201);
    expect(rec.userCalls).toEqual(['bob']); // NOT 'alice'
  });

  it('test_recall_session_tier_binds_to_principal_user_composite_key', async () => {
    const rec = recordingMemory();
    const res = await appWith(rec.stub).request('/v1/recall', {
      method: 'POST',
      headers: JSON_HEADERS('tok-bob'),
      body: JSON.stringify({ query: 'x', sessionId: 's1' }),
    });
    expect(res.status).toBe(200);
    expect(rec.sessionCalls).toEqual([{ id: 's1', userId: 'bob' }]);
  });

  it('test_scopes_user_read_binds_to_principal_ignoring_path_id', async () => {
    const rec = recordingMemory();
    const res = await appWith(rec.stub).request('/v1/scopes/user/alice/memories', {
      headers: { Authorization: 'Bearer tok-bob' },
    });
    expect(res.status).toBe(200);
    expect(rec.userCalls).toEqual(['bob']); // path 'alice' ignored, bound to Principal
  });

  it('test_admin_null_user_keeps_body_userId_no_acting_user_to_bind', async () => {
    const rec = recordingMemory();
    const res = await appWith(rec.stub).request('/v1/remember', {
      method: 'POST',
      headers: JSON_HEADERS('tok-admin'),
      body: JSON.stringify({ text: 'x', userId: 'team-shared' }),
    });
    expect(res.status).toBe(201);
    expect(rec.userCalls).toEqual(['team-shared']);
  });
});
