import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { attachUser, attachWorkspace } from '../auth/request-workspace.js';

import { scopeFromRequest } from './streamable-http.js';

/**
 * M16 (#121) — the user tier must come from the resolved Principal, never from a header the
 * client controls.
 *
 * The transport used to merge `X-Theo-User-Id` over the auth-derived scope, so the bearer of
 * ANY key in a workspace could operate as ANY other user in it — a cross-user privilege
 * escalation in the one topology the CLI itself offers (`themory mcp --transport
 * streamable-http --auth api-keys`, no gateway in front). The tools were never the problem:
 * they read `getScope()` correctly. The transport that populated that scope was.
 *
 * This contradicts ADR-M14-1 at the exact point where the scope is built.
 */
function req(headers: NodeJS.Dict<string | string[]> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('scopeFromRequest', () => {
  it('test_principal_user_wins_over_client_header', () => {
    // The repro from #121: alice's key, bob's header.
    const r = req({ 'x-theo-user-id': 'live-bob' });
    attachWorkspace(r, 'ws-live-m14');
    attachUser(r, 'live-alice');

    const scope = scopeFromRequest(r);

    expect(scope?.session?.userId).toBe('live-alice');
    expect(scope?.workspaceId).toBe('ws-live-m14');
  });

  it('test_header_is_ignored_for_a_workspace_key_without_the_gateway_mark', () => {
    // /review Finding 2 corrected the original premise here: a workspace-level credential is
    // NOT proof of a gateway. Without the explicit gateway mark the header must be ignored, or
    // any unbound key used directly becomes a workspace-wide impersonation primitive. The
    // gateway case is covered separately in `scopeFromRequest gateway trust` below.
    const r = req({ 'x-theo-user-id': 'gateway-injected' });
    attachWorkspace(r, 'ws-live-m14');

    expect(scopeFromRequest(r)?.session).toBeUndefined();
  });

  it('test_principal_user_applies_when_no_header_is_sent', () => {
    const r = req({});
    attachWorkspace(r, 'ws-live-m14');
    attachUser(r, 'live-alice');

    expect(scopeFromRequest(r)?.session?.userId).toBe('live-alice');
  });

  it('test_no_auth_and_no_header_yields_no_scope', () => {
    // Fail-closed: handlers then see no scope and a scope-required tool call fails.
    expect(scopeFromRequest(req({}))).toBeUndefined();
  });
});

/**
 * M16 /review Finding 2 — "workspace-level" is not "trusted gateway".
 *
 * A workspace-level credential used DIRECTLY (no gateway in front, `memory:platform-admin`
 * absent) must NOT let `X-Theo-User-Id` pick a user. Only the explicit gateway mark, set by
 * the bearer gate when the credential carries `memory:platform-admin`, authorizes the header.
 */
describe('scopeFromRequest gateway trust', () => {
  it('test_header_ignored_for_workspace_key_without_gateway_mark', async () => {
    const { attachWorkspace } = await import('../auth/request-workspace.js');
    const r = req({ 'x-theo-user-id': 'victim' });
    attachWorkspace(r, 'ws');
    // No attachUser, no markGatewayTrusted — a plain unbound key used directly.

    const scope = scopeFromRequest(r);

    expect(scope?.workspaceId).toBe('ws');
    expect(scope?.session).toBeUndefined(); // fail closed, not impersonate
  });

  it('test_header_honoured_only_with_gateway_mark', async () => {
    const { attachWorkspace, markGatewayTrusted } = await import('../auth/request-workspace.js');
    const r = req({ 'x-theo-user-id': 'end-user' });
    attachWorkspace(r, 'ws');
    markGatewayTrusted(r); // the gateway credential carried memory:platform-admin

    expect(scopeFromRequest(r)?.session?.userId).toBe('end-user');
  });
});
