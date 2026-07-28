import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { workspaceFromRequest } from './request-workspace.js';
import { withBearerAuth } from './with-bearer-auth.js';

/**
 * M16 (#84) — the OIDC path must not serve the `default` workspace in fail-closed mode.
 *
 * `OidcAuthVerifier` implements `verify` but not `resolvePrincipal`: introspection returns a
 * subject, not a tenant (deferred by the #82 plan ADR D4). The OIDC branch therefore
 * delegated WITHOUT attaching a workspace, and `workspaceScopedMemory` then took its
 * single-tenant passthrough and served `default`.
 *
 * For a single-tenant deployment that is correct and stays the default. For a multi-tenant
 * one it is the #82 leak class through the OIDC door — so the same `THEMEMORY_REQUIRE_CREDENTIAL`
 * signal the REST surface already honours must close it here too, rather than inventing a
 * second, divergent tenancy flag.
 */
function mockRes(): ServerResponse & { statusCode: number } {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
    writeHead: vi.fn(),
  } as unknown as ServerResponse & { statusCode: number };
}

const req = () =>
  ({ headers: { authorization: 'Bearer some-opaque-oidc-token' } }) as unknown as IncomingMessage;

const oidcVerifyOnly = { verify: async () => true };

describe('withBearerAuth OIDC path', () => {
  it('test_oidc_without_workspace_is_rejected_in_fail_closed_mode', async () => {
    const delegate = vi.fn(async () => {});
    const handler = withBearerAuth(delegate, { oidc: oidcVerifyOnly, requireCredential: true });
    const res = mockRes();

    await handler(req(), res);

    // Fail-closed: a token that cannot resolve a tenant never reaches the memory layer.
    expect(delegate).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('test_oidc_still_serves_single_tenant_deployments_by_default', async () => {
    // The legacy default is load-bearing: single-tenant OIDC deployments are a supported,
    // correct configuration and must keep working untouched.
    const delegate = vi.fn(async () => {});
    const handler = withBearerAuth(delegate, { oidc: oidcVerifyOnly });
    const res = mockRes();

    const r = req();
    await handler(r, res);

    expect(delegate).toHaveBeenCalledOnce();
    expect(workspaceFromRequest(r)).toBeUndefined();
  });
});
