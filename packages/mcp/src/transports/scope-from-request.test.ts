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

  it('test_header_is_honoured_when_principal_carries_no_user', () => {
    // The gateway topology: a workspace-level credential, with the gateway injecting the
    // auth-trusted user header. Ignoring the header unconditionally would break Model B.
    const r = req({ 'x-theo-user-id': 'gateway-injected' });
    attachWorkspace(r, 'ws-live-m14');

    expect(scopeFromRequest(r)?.session?.userId).toBe('gateway-injected');
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
