/**
 * T0.1 RED — Principal + Workspace domain types + AuthVerifier.resolvePrincipal.
 *
 * Plan multi-tenant-workspace-isolation § T0.1 / ADR D2 (additive-then-breaking).
 * Asserts:
 *  - a verifier implementing ONLY resolvePrincipal gets verify() for free via
 *    the default shim (boolean = resolvePrincipal !== null) — D2;
 *  - Principal carries workspaceId + scopes;
 *  - the default-workspace constant is a stable literal (EC-6).
 */
import { describe, expect, it } from 'vitest';

import type { Principal, Workspace, WorkspaceRole } from './principal.js';
import { DEFAULT_OWNER_USER_ID, DEFAULT_WORKSPACE_ID, makeVerifyShim, roleSatisfies } from './principal.js';

describe('Principal + Workspace domain types', () => {
  it('a verifier implementing only resolvePrincipal gets a boolean verify() via the default shim', async () => {
    // Given: a verifier that resolves a Principal for one token, null otherwise
    const principal: Principal = { workspaceId: 'ws-a', userId: 'u-a', role: 'owner', scopes: ['memory:read'] };
    const resolvePrincipal = async (token: string): Promise<Principal | null> =>
      token === 'good' ? principal : null;
    const verify = makeVerifyShim({ resolvePrincipal });

    // When/Then: verify() is true for a resolvable token, false for an unresolvable one
    await expect(verify('good')).resolves.toBe(true);
    await expect(verify('bad')).resolves.toBe(false);
  });

  it('Principal carries workspaceId, userId, role and a scopes array', () => {
    const p: Principal = {
      workspaceId: 'ws-x',
      userId: 'u-x',
      role: 'admin',
      scopes: ['memory:read', 'memory:write'],
    };
    expect(p.workspaceId).toBe('ws-x');
    expect(p.userId).toBe('u-x');
    expect(p.role).toBe('admin');
    expect(p.scopes).toContain('memory:write');
  });

  it('a legacy key Principal may carry a null userId', () => {
    const p: Principal = { workspaceId: 'ws-x', userId: null, role: 'member', scopes: [] };
    expect(p.userId).toBeNull();
  });

  it('Workspace carries id, name, createdAt', () => {
    const w: Workspace = { id: 'default', name: 'Default', createdAt: new Date(0) };
    expect(w.id).toBe('default');
    expect(w.name).toBe('Default');
  });

  it('the default workspace id is a stable literal (EC-6), not random', () => {
    expect(DEFAULT_WORKSPACE_ID).toBe('default');
  });

  it('the default owner user id is a stable literal', () => {
    expect(DEFAULT_OWNER_USER_ID).toBe('default-owner');
  });

  it('roleSatisfies ranks owner > admin > member (ordinal privilege)', () => {
    // owner satisfies every minimum
    expect(roleSatisfies('owner', 'owner')).toBe(true);
    expect(roleSatisfies('owner', 'admin')).toBe(true);
    expect(roleSatisfies('owner', 'member')).toBe(true);
    // admin satisfies admin + member, NOT owner
    expect(roleSatisfies('admin', 'admin')).toBe(true);
    expect(roleSatisfies('admin', 'member')).toBe(true);
    expect(roleSatisfies('admin', 'owner')).toBe(false);
    // member satisfies only member
    expect(roleSatisfies('member', 'member')).toBe(true);
    expect(roleSatisfies('member', 'admin')).toBe(false);
    expect(roleSatisfies('member', 'owner')).toBe(false);
  });

  it('every WorkspaceRole is comparable (exhaustive type)', () => {
    const roles: WorkspaceRole[] = ['owner', 'admin', 'member'];
    for (const r of roles) {
      expect(roleSatisfies(r, 'member')).toBe(true);
    }
  });
});
