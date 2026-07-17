/**
 * T1.1 / T2.1 — bearerAuth fail-closed (503) + requireRole RBAC gate.
 *
 * Plan multi-tenant-rbac-and-slice1-completion § T1.1 (ADR D5) + § T2.1.
 * Contract-level (no DB): an injected verifier exercises the middleware in
 * isolation through a minimal Hono app.
 *  - a verifier whose resolvePrincipal THROWS → 503, principal never set (D5);
 *  - requireRole('admin') → 403 for a member, pass for admin/owner (401 precedes
 *    403 because bearerAuth runs first and rejects a null Principal).
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import type { AuthVerifier, Principal } from '@usetheo/memory/contract';

import { bearerAuth, getPrincipal, requireRole } from '../middleware.js';

function appWith(verifier: AuthVerifier): Hono {
  const app = new Hono();
  app.use('/v1/*', bearerAuth(verifier));
  app.get('/v1/open', (c) => c.json({ role: getPrincipal(c).role }));
  app.get('/v1/admin', requireRole('admin'), (c) => c.json({ ok: true }));
  return app;
}

function verifierFor(principal: Principal | null): AuthVerifier {
  return {
    resolvePrincipal: () => Promise.resolve(principal),
    verify: () => Promise.resolve(principal !== null),
  };
}

const auth = { headers: { Authorization: 'Bearer tok' } };

describe('bearerAuth — 503 fail-closed (D5)', () => {
  it('returns 503 (not 500, not a default principal) when resolvePrincipal throws', async () => {
    const throwing: AuthVerifier = {
      resolvePrincipal: () => Promise.reject(new Error('Postgres down')),
      verify: () => Promise.reject(new Error('Postgres down')),
    };
    const app = appWith(throwing);
    const res = await app.request('/v1/open', auth);
    expect(res.status).toBe(503);
    expect((await res.json())).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('returns 401 for an unresolvable (null) credential', async () => {
    const res = await appWith(verifierFor(null)).request('/v1/open', auth);
    expect(res.status).toBe(401);
  });
});

describe('requireRole — RBAC gate (T2.1)', () => {
  const member: Principal = { workspaceId: 'ws', userId: 'u', role: 'member', scopes: [] };
  const admin: Principal = { workspaceId: 'ws', userId: 'u', role: 'admin', scopes: [] };
  const owner: Principal = { workspaceId: 'ws', userId: 'u', role: 'owner', scopes: [] };

  it('member → 403 INSUFFICIENT_ROLE on an admin route', async () => {
    const res = await appWith(verifierFor(member)).request('/v1/admin', auth);
    expect(res.status).toBe(403);
    expect((await res.json())).toMatchObject({ code: 'INSUFFICIENT_ROLE', required: 'admin', actual: 'member' });
  });

  it('admin → passes the admin route', async () => {
    const res = await appWith(verifierFor(admin)).request('/v1/admin', auth);
    expect(res.status).toBe(200);
  });

  it('owner → passes the admin route (owner outranks admin)', async () => {
    const res = await appWith(verifierFor(owner)).request('/v1/admin', auth);
    expect(res.status).toBe(200);
  });

  it('unknown credential → 401 before any role check (auth precedes authz)', async () => {
    const res = await appWith(verifierFor(null)).request('/v1/admin', auth);
    expect(res.status).toBe(401);
  });
});
