/**
 * Scope x verb authz matrix (contract; DB-less).
 *
 * An injected verifier maps tokens to principals carrying a specific scope set;
 * the matrix asserts that each data verb enforces its required scope on the
 * already-resolved Principal:
 *
 *   - remember / reflect -> memory:write
 *   - recall             -> memory:read
 *   - forget             -> memory:delete
 *
 * A read-only key is 403 on a write/delete verb; a credential that holds ONLY
 * the platform-admin scope (the gateway's own provisioning key) is 403 on EVERY
 * data verb, because platform-admin implies only memory:admin (key lifecycle) and
 * NEVER a data scope (least privilege, NIST AC-6). This closes the data-plane
 * authz gap where any authenticated credential could read/write/delete regardless
 * of its granted scope. If a future route forgets the scope guard, the relevant
 * row turns green where it must be 403 and this suite fails.
 *
 * @see usetheoai/theo-memory#77
 */
import { describe, expect, it, vi } from 'vitest';

import type { AuthVerifier, Memory, Principal } from '@usetheo/memory/contract';

import { createApp } from '../app.js';

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
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),
    withWorkspace: vi.fn().mockReturnThis(),
  };
  return stub;
}

function principalWithScopes(scopes: readonly string[]): Principal {
  return { workspaceId: 'ws', userId: 'u-1', role: 'member', scopes: [...scopes] };
}

function verifier(map: Record<string, Principal>): AuthVerifier {
  return {
    resolvePrincipal: (t: string) => Promise.resolve(map[t] ?? null),
    verify: (t: string) => Promise.resolve(map[t] !== undefined),
  };
}

const TOKENS: Record<string, Principal> = {
  'tok-read': principalWithScopes(['memory:read']),
  'tok-write': principalWithScopes(['memory:write']),
  'tok-delete': principalWithScopes(['memory:delete']),
  'tok-full': principalWithScopes(['memory:read', 'memory:write', 'memory:delete']),
  'tok-platform-admin': principalWithScopes(['memory:platform-admin']),
};

function buildApp(): ReturnType<typeof createApp> {
  return createApp({ memory: stubMemory(), authVerifier: verifier(TOKENS) });
}

async function post(tok: string, path: string): Promise<Response> {
  return buildApp().request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x', user: 'u-1' }),
  });
}

const WRITE_VERBS = ['/v1/remember', '/v1/reflect'];
const READ_VERBS = ['/v1/recall'];
const DELETE_VERBS = ['/v1/forget'];

describe('scope x verb authz matrix (contract)', () => {
  describe('read-only key', () => {
    for (const path of [...WRITE_VERBS, ...DELETE_VERBS]) {
      it(`is 403 on ${path} (needs write/delete)`, async () => {
        expect((await post('tok-read', path)).status).toBe(403);
      });
    }
    for (const path of READ_VERBS) {
      it(`is allowed (not 403) on ${path}`, async () => {
        expect((await post('tok-read', path)).status).not.toBe(403);
      });
    }
  });

  describe('write-only key', () => {
    for (const path of WRITE_VERBS) {
      it(`is allowed (not 403) on ${path}`, async () => {
        expect((await post('tok-write', path)).status).not.toBe(403);
      });
    }
    for (const path of DELETE_VERBS) {
      it(`is 403 on ${path} (needs delete)`, async () => {
        expect((await post('tok-write', path)).status).toBe(403);
      });
    }
  });

  describe('delete-only key', () => {
    for (const path of DELETE_VERBS) {
      it(`is allowed (not 403) on ${path}`, async () => {
        expect((await post('tok-delete', path)).status).not.toBe(403);
      });
    }
    for (const path of WRITE_VERBS) {
      it(`is 403 on ${path} (needs write)`, async () => {
        expect((await post('tok-delete', path)).status).toBe(403);
      });
    }
  });

  describe('platform-admin-only key (gateway provisioning credential)', () => {
    for (const path of [...WRITE_VERBS, ...READ_VERBS, ...DELETE_VERBS]) {
      it(`is 403 on ${path} (platform-admin implies only memory:admin)`, async () => {
        expect((await post('tok-platform-admin', path)).status).toBe(403);
      });
    }
  });

  describe('full-scope key', () => {
    for (const path of [...WRITE_VERBS, ...READ_VERBS, ...DELETE_VERBS]) {
      it(`is allowed (not 403) on ${path}`, async () => {
        expect((await post('tok-full', path)).status).not.toBe(403);
      });
    }
  });

  // explainable-recall-read S2 (T4.1) — GET /v1/recall-traces/:id needs memory:read.
  describe('GET /v1/recall-traces/:recallId requires memory:read', () => {
    const stubTraceStore = { record: async () => {}, getByRecallId: async () => [] };
    function traceApp(): ReturnType<typeof createApp> {
      return createApp({
        memory: stubMemory(),
        authVerifier: verifier(TOKENS),
        recallTraceStore: stubTraceStore,
      });
    }
    async function getTrace(tok: string): Promise<Response> {
      return traceApp().request('/v1/recall-traces/some-id', {
        headers: { Authorization: `Bearer ${tok}` },
      });
    }
    it('is 403 for a write-only key (no memory:read)', async () => {
      expect((await getTrace('tok-write')).status).toBe(403);
    });
    it('is allowed (not 403) for a read key', async () => {
      expect((await getTrace('tok-read')).status).not.toBe(403);
    });
    it('is 403 for the platform-admin provisioning key (least privilege)', async () => {
      expect((await getTrace('tok-platform-admin')).status).toBe(403);
    });
  });
});
