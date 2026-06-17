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

import type { Principal, Workspace } from './principal.js';
import { DEFAULT_WORKSPACE_ID, makeVerifyShim } from './principal.js';

describe('Principal + Workspace domain types', () => {
  it('a verifier implementing only resolvePrincipal gets a boolean verify() via the default shim', async () => {
    // Given: a verifier that resolves a Principal for one token, null otherwise
    const principal: Principal = { workspaceId: 'ws-a', scopes: ['memory:read'] };
    const resolvePrincipal = async (token: string): Promise<Principal | null> =>
      token === 'good' ? principal : null;
    const verify = makeVerifyShim({ resolvePrincipal });

    // When/Then: verify() is true for a resolvable token, false for an unresolvable one
    await expect(verify('good')).resolves.toBe(true);
    await expect(verify('bad')).resolves.toBe(false);
  });

  it('Principal carries a workspaceId and a scopes array', () => {
    const p: Principal = { workspaceId: 'ws-x', scopes: ['memory:read', 'memory:write'] };
    expect(p.workspaceId).toBe('ws-x');
    expect(p.scopes).toContain('memory:write');
  });

  it('Workspace carries id, name, createdAt', () => {
    const w: Workspace = { id: 'default', name: 'Default', createdAt: new Date(0) };
    expect(w.id).toBe('default');
    expect(w.name).toBe('Default');
  });

  it('the default workspace id is a stable literal (EC-6), not random', () => {
    expect(DEFAULT_WORKSPACE_ID).toBe('default');
  });
});
