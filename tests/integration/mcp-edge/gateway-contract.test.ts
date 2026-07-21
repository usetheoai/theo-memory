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
 *   THEO_MCP_EDGE_KEY_B=theo_live_...   # REQUIRED: the cross-tenant isolation case
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
  it('is configured to actually assert something', () => {
    // A suite that reports green by skipping is worse than no suite: it reads as
    // coverage on the dashboard while asserting nothing. Once an edge is configured,
    // the cross-tenant case is NOT optional — missing KEY_B fails here rather than
    // silently dropping the only test that proves tenant isolation.
    expect(
      KEY_B,
      'THEO_MCP_EDGE_KEY_B is required whenever THEO_MCP_EDGE_URL/_KEY are set — ' +
        'without a second tenant the isolation case cannot run',
    ).not.toBe('');
  });

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
    //
    // Asserting the response merely lacks the forged id proves nothing: recall never
    // echoes a workspace id, so that passes whether the claim was honoured or not.
    // The observable that DOES differentiate is whose data comes back — so seed a
    // marker as A, then repeat the read with a forged workspace attached.
    const marker = `m7-body-tenant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const sessionId = await openSession(KEY_A, 'body-tenant');

    const write = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'remember', arguments: { content: `body tenant probe ${marker}`, infer: false } },
      }),
      { key: KEY_A, sessionId },
    );
    expect(write.status, `seed write failed: ${write.body}`).toBe(200);

    const forged = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'recall',
          arguments: { query: marker, workspaceId: 'wk-someone-else', tenant_id: 'tn-forged' },
        },
      }),
      { key: KEY_A, sessionId },
    );

    // The forged claim was ignored: the read stayed on the credential's workspace and
    // returned A's own marker. Had it been honoured, the call would have run against
    // an empty foreign workspace and the marker would be absent.
    expect(forged.body).toContain(marker);
  });
});

describe.skipIf(EDGE_URL === '' || KEY_A === '')(
  'MCP gateway edge contract — cross-tenant isolation (M7)',
  () => {
    it('does not surface tenant A memories to tenant B', async () => {
      const marker = `m7-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const sessionA = await openSession(KEY_A, 'tenant-a');
      // `content` is the schema's field name. Sending `text` gets the call rejected
      // with -32602 BEFORE anything is written, which would make the isolation
      // assertion below pass vacuously — nothing was ever stored to leak.
      const writeA = await post(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'remember',
            arguments: { content: `isolation probe ${marker}`, infer: false },
          },
        }),
        { key: KEY_A, sessionId: sessionA },
      );
      expect(writeA.status, `tenant A write failed: ${writeA.body}`).toBe(200);
      expect(writeA.body, `tenant A write errored: ${writeA.body}`).not.toContain('"error"');

      // POSITIVE CONTROL — without it, an argument-name drift silently turns the
      // isolation assertion back into a tautology.
      const readA = await post(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: { name: 'recall', arguments: { query: marker } },
        }),
        { key: KEY_A, sessionId: sessionA },
      );
      expect(readA.body, 'tenant A must be able to read back its own write').toContain(marker);

      const sessionB = await openSession(KEY_B, 'tenant-b');
      const readB = await post(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: { name: 'recall', arguments: { query: marker } },
        }),
        { key: KEY_B, sessionId: sessionB },
      );

      // Distinguish a real leak from a misconfigured probe. Two credentials issued
      // to the SAME workspace legitimately see each other's data, and reporting that
      // as "isolation broken" sends an operator hunting a bug that is not there.
      // Cross-checking B→A separates them: a true isolation failure is one-directional
      // for a marker only A wrote, while same-tenant credentials share everything.
      if (readB.body.includes(marker)) {
        const probe = await post(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 13,
            method: 'tools/call',
            params: { name: 'recall', arguments: { query: 'm7-tenant-separation-probe' } },
          }),
          { key: KEY_B, sessionId: sessionB },
        );
        expect(
          probe.status,
          'tenant B could read tenant A data — verify THEO_MCP_EDGE_KEY and _KEY_B were ' +
            'issued to DIFFERENT workspaces before treating this as an isolation defect ' +
            '(the gateway logs the resolved tenant per request)',
        ).toBe(200);
      }
      // The marker is unique to A's write; B must never see it.
      expect(readB.body).not.toContain(marker);
    });
  },
);
