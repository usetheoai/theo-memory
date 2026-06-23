/**
 * T2.1 — RBAC role×route matrix (contract; DB-less).
 *
 * An injected role verifier maps tokens → principals; an in-memory members repo
 * backs `/v1/members`. Asserts the authz matrix: a `member` is 403 on every
 * management route, `admin`/`owner` are allowed, a RAG verb (recall) is open to
 * a plain member, and an unknown token is 401 everywhere (auth precedes authz).
 * If a future route forgets `requireRole`, the member row turns green where it
 * must be 403 and this suite fails.
 *
 * @see .claude/knowledge-base/plans/multi-tenant-rbac-and-slice1-completion-plan.md § T2.1
 */
import { describe, expect, it, vi } from 'vitest';

import type { AuthVerifier, Memory, Principal } from '@usetheo/memory/contract';

import { createApp } from '../app.js';
import { createInMemoryMembersRepository } from '../store/members-store.js';

function stubMemory(): Memory {
  const scoped = {
    remember: vi.fn().mockResolvedValue([]),
    recall: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ jobId: 'job-1', derivedCount: 0 }),
    getAll: vi.fn().mockResolvedValue([]),
  };
  const stub = {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn().mockReturnValue(scoped),
    forget: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    history: vi.fn().mockResolvedValue([]),
    reset: vi.fn().mockResolvedValue(undefined),
    flushReflections: vi.fn().mockResolvedValue(undefined),
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),    withWorkspace: vi.fn().mockReturnThis(),
  };
  return stub;
}

const FULL_SCOPES = ['memory:read', 'memory:write', 'memory:delete', 'memory:admin'];

function principal(role: 'owner' | 'admin' | 'member'): Principal {
  return { workspaceId: 'ws', userId: `u-${role}`, role, scopes: FULL_SCOPES };
}

function roleVerifier(map: Record<string, Principal>): AuthVerifier {
  return {
    resolvePrincipal: (t: string) => Promise.resolve(map[t] ?? null),
    verify: (t: string) => Promise.resolve(map[t] !== undefined),
  };
}

const TOKENS: Record<string, Principal> = {
  'tok-owner': principal('owner'),
  'tok-admin': principal('admin'),
  'tok-member': principal('member'),
};

function buildApp(): ReturnType<typeof createApp> {
  return createApp({
    memory: stubMemory(),
    authVerifier: roleVerifier(TOKENS),
    membersRepository: createInMemoryMembersRepository([
      { workspaceId: 'ws', userId: 'u-owner', email: 'owner@x', role: 'owner' },
    ]),
  });
}

const MANAGEMENT_ROUTES = [
  { label: 'GET /v1/members', path: '/v1/members', method: 'GET' as const },
  { label: 'POST /v1/members', path: '/v1/members', method: 'POST' as const, body: { email: 'n@x.test', role: 'member' } },
  { label: 'PATCH /v1/members/:id', path: '/v1/members/u-owner', method: 'PATCH' as const, body: { role: 'admin' } },
  { label: 'DELETE /v1/members/:id', path: '/v1/members/u-ghost', method: 'DELETE' as const },
];

async function request(
  app: ReturnType<typeof createApp>,
  tok: string,
  r: (typeof MANAGEMENT_ROUTES)[number],
): Promise<Response> {
  const init: RequestInit = {
    method: r.method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  };
  if ('body' in r && r.body !== undefined) init.body = JSON.stringify(r.body);
  return app.request(r.path, init);
}

describe('RBAC role×route matrix (contract)', () => {
  for (const route of MANAGEMENT_ROUTES) {
    it(`member is 403 on ${route.label}`, async () => {
      const res = await request(buildApp(), 'tok-member', route);
      expect(res.status).toBe(403);
      expect((await res.json())).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    });

    it(`admin is NOT 403 on ${route.label}`, async () => {
      const res = await request(buildApp(), 'tok-admin', route);
      expect(res.status).not.toBe(403);
    });

    it(`owner is NOT 403 on ${route.label}`, async () => {
      const res = await request(buildApp(), 'tok-owner', route);
      expect(res.status).not.toBe(403);
    });

    it(`unknown token is 401 on ${route.label} (auth precedes authz)`, async () => {
      const res = await request(buildApp(), 'tok-nope', route);
      expect(res.status).toBe(401);
    });
  }

  it('a RAG verb (recall) is OPEN to a plain member', async () => {
    const res = await buildApp().request('/v1/recall', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice', query: 'anything' }),
    });
    expect(res.status).toBe(200);
  });
});
