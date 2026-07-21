/**
 * M7 — edge contract for the Theo MCP Gateway.
 *
 * Asserts the guarantees an MCP client (Claude Code) depends on when it talks to
 * theo-memory through the PUBLIC edge rather than to the service directly. Every
 * assertion here corresponds to a defect that actually shipped and was caught by
 * hand during M7:
 *
 *  - `/mcp/*` had no route, so it fell through to the dashboard's static file
 *    server and answered `200 text/html` on GET / `405` on POST. A "route exists"
 *    reading of that 405 is exactly the trap this file exists to prevent, so the
 *    content-type is asserted, not just the status.
 *  - The ForwardAuth validator read a different Postgres than the one the
 *    dashboard minted into, so every real key looked forged.
 *  - The gateway resolved a tenant but no MCP upstream existed at all.
 *  - A singleton transport meant only ONE client could ever complete `initialize`.
 *
 * Opt-in: needs a live edge plus a real credential, so it is skipped unless both
 * env vars are set. It is a contract probe against a deployed environment, not a
 * hermetic unit test.
 *
 *   THEO_MCP_EDGE_URL=https://app-dev.usetheo.dev/mcp/memory \
 *   THEO_MCP_EDGE_KEY=theo_live_... \
 *   THEO_MCP_EDGE_KEY_B=theo_live_...   # optional: enables the cross-tenant case
 *   npx vitest run tests/integration/mcp-edge/gateway-contract.test.ts
 */
import { describe, expect, it } from 'vitest';

const EDGE_URL = process.env.THEO_MCP_EDGE_URL ?? '';
const KEY_A = process.env.THEO_MCP_EDGE_KEY ?? '';
const KEY_B = process.env.THEO_MCP_EDGE_KEY_B ?? '';

const PROTOCOL_VERSION = '2025-06-18';

interface Reply {
  readonly status: number;
  readonly contentType: string;
  readonly sessionId: string | undefined;
  readonly body: string;
}

function initializeBody(clientName: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0.0' },
    },
  });
}

/** One POST to the edge. `key`/`sessionId`/`protocolVersion` are individually omittable. */
async function post(
  body: string,
  opts: {
    key?: string;
    sessionId?: string;
    protocolVersion?: string | null;
  } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (opts.key !== undefined) headers.authorization = `Bearer ${opts.key}`;
  if (opts.sessionId !== undefined) headers['mcp-session-id'] = opts.sessionId;
  // null = deliberately omit the header; undefined = send the valid default.
  if (opts.protocolVersion !== null) {
    headers['mcp-protocol-version'] = opts.protocolVersion ?? PROTOCOL_VERSION;
  }

  const res = await fetch(EDGE_URL, { method: 'POST', headers, body });
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    body: await res.text(),
  };
}

/** Completes a handshake and returns the session id, failing loudly if it cannot. */
async function openSession(key: string, clientName: string): Promise<string> {
  const reply = await post(initializeBody(clientName), { key });
  expect(reply.status, `initialize failed: ${reply.body}`).toBe(200);
  expect(reply.sessionId, 'edge did not return Mcp-Session-Id').toBeDefined();
  return reply.sessionId as string;
}

describe.skipIf(EDGE_URL === '' || KEY_A === '')('MCP gateway edge contract (M7)', () => {
  it('denies a request with no credential', async () => {
    const reply = await post(initializeBody('no-cred'));
    expect(reply.status).toBe(401);
  });

  it('denies a forged credential', async () => {
    const reply = await post(initializeBody('forged'), {
      key: 'theo_live_this_key_was_never_minted_000000000',
    });
    expect(reply.status).toBe(401);
  });

  it('answers as the gateway, never as the dashboard static file server', async () => {
    // The pre-M7 failure looked routed (405 with an `allow` header) but was the
    // SPA file_server. Anything text/html means /mcp/* fell through again.
    const reply = await post(initializeBody('content-type-probe'), { key: KEY_A });
    expect(reply.contentType).not.toContain('text/html');
    expect(reply.contentType).toMatch(/application\/json|text\/event-stream/);
  });

  it('completes initialize and reports the themory server', async () => {
    const reply = await post(initializeBody('handshake'), { key: KEY_A });
    expect(reply.status).toBe(200);
    expect(reply.sessionId).toBeDefined();
    expect(reply.body).toContain('themory');
    expect(reply.body).toContain(PROTOCOL_VERSION);
  });

  it('exposes the memory tools through the proxy', async () => {
    const sessionId = await openSession(KEY_A, 'tools-list');
    const reply = await post(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), {
      key: KEY_A,
      sessionId,
    });
    expect(reply.status).toBe(200);
    for (const tool of ['remember', 'recall', 'forget']) {
      expect(reply.body, `tools/list is missing "${tool}"`).toContain(tool);
    }
  });

  it('serves concurrent clients instead of rejecting the second one', async () => {
    // The M7 product defect: a singleton transport bound its session at the first
    // initialize, so client #2 got -32600 "Server already initialized". Without
    // this case the milestone objective (EVERY Claude Code instance) is unmet.
    const [first, second] = await Promise.all([
      post(initializeBody('client-one'), { key: KEY_A }),
      post(initializeBody('client-two'), { key: KEY_A }),
    ]);

    expect(first.status).toBe(200);
    expect(second.body).not.toContain('Server already initialized');
    expect(second.status).toBe(200);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('rejects a session id that was never issued', async () => {
    // Must NOT be silently upgraded into a fresh session: the client would then be
    // on a different session than the one it believes it holds.
    const reply = await post(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }), {
      key: KEY_A,
      sessionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(reply.status).not.toBe(200);
  });

  it('ignores a tenant claimed in the request body', async () => {
    // Tenancy comes from the credential (Model B), never from client-supplied data.
    // A body-claimed workspace must not widen what the credential can reach.
    const sessionId = await openSession(KEY_A, 'body-tenant');
    const reply = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'recall',
          arguments: { query: 'anything', workspaceId: 'wk-someone-else', tenant_id: 'tn-forged' },
        },
      }),
      { key: KEY_A, sessionId },
    );
    // Either the argument is rejected outright or it is ignored — what must never
    // happen is a successful read attributed to the forged workspace.
    expect(reply.body).not.toContain('wk-someone-else');
  });
});

describe.skipIf(EDGE_URL === '' || KEY_A === '' || KEY_B === '')(
  'MCP gateway edge contract — cross-tenant isolation (M7)',
  () => {
    it('does not surface tenant A memories to tenant B', async () => {
      const marker = `m7-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const sessionA = await openSession(KEY_A, 'tenant-a');
      await post(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: { name: 'remember', arguments: { text: `isolation probe ${marker}` } },
        }),
        { key: KEY_A, sessionId: sessionA },
      );

      const sessionB = await openSession(KEY_B, 'tenant-b');
      const readB = await post(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: { name: 'recall', arguments: { query: marker } },
        }),
        { key: KEY_B, sessionId: sessionB },
      );

      // The marker is unique to A's write; B must never see it.
      expect(readB.body).not.toContain(marker);
    });
  },
);
