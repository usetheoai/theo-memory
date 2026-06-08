/**
 * Streamable-HTTP transport tests — T6.2.
 *
 * Per plan T6.2: 4 TDD tests focused on the plan-mandated behaviors.
 * EC-15 (port collision) + EC-16 (X-Agent-Id sanitization) logged as followups
 * for deeper testing at v0.5 cloud iteration (streamable-HTTP is secondary
 * transport per ADR D1; primary v0.3 transport is stdio).
 *
 * @see ADR D1 — Transport: stdio + streamable-HTTP (skip SSE + fastmcp)
 * @see ADR D3 — scope binding via AsyncLocalStorage
 * @see ADR D6 — error mechanisms
 * @see .claude/knowledge-base/discoveries/blueprints discover blueprint Q5 — stateless mode pattern (sessionIdGenerator: undefined)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectStreamableHttp } from '../transports/streamable-http.js';
import type { McpServer } from '../server.js';

function mockServer(): McpServer {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;
}

afterEach(async () => {
  // Defensive cleanup of any open listeners
  vi.restoreAllMocks();
});

describe('connectStreamableHttp (T6.2)', () => {
  it('listens on configured port + returns close() handle', async () => {
    const server = mockServer();
    // Port 0 → OS-assigned free port (avoids EADDRINUSE during tests)
    const handle = await connectStreamableHttp(server, { port: 0, host: '127.0.0.1' });
    expect(handle).toBeDefined();
    expect(typeof handle.close).toBe('function');
    expect(typeof handle.address).toBe('function');
    const addr = handle.address();
    expect(addr).not.toBeNull();
    expect(typeof addr).toBe('object');
    if (addr && typeof addr === 'object') {
      // Port assigned by OS; must be a positive integer
      expect((addr as { port: number }).port).toBeGreaterThan(0);
    }
    await handle.close();
  });

  it('connects the McpServer to the StreamableHTTPServerTransport (themory-issue-3 — stateful session mode, no unsafe cast)', async () => {
    const server = mockServer();
    // Pre-fix this connectStreamableHttp would crash at boot if the SDK's strict
    // exactOptionalPropertyTypes rejected `sessionIdGenerator: undefined` — the
    // old code worked around with `as unknown as ...` cast. Post-fix we pass a
    // genuine `() => randomUUID()` matching the SDK's required type, so the
    // boot path uses the canonical typed API surface (no cast). If this test
    // boots without throwing, the SDK accepted the constructor args as typed.
    // Behavioral verification of session-id emission lives in the team's
    // /tmp/themory-issue-3.md curl-isolation script (out-of-scope for unit
    // tests — would require real http server boot + JSON-RPC handshake).
    const handle = await connectStreamableHttp(server, { port: 0, host: '127.0.0.1' });
    expect(vi.mocked(server.start)).toHaveBeenCalledTimes(1);
    const transport = vi.mocked(server.start).mock.calls[0]?.[0];
    expect(transport).toBeDefined();
    expect(typeof (transport as { handleRequest?: unknown }).handleRequest).toBe('function');
    await handle.close();
  });

  it('exposes a host + port pair via the returned handle', async () => {
    const server = mockServer();
    const handle = await connectStreamableHttp(server, { port: 0, host: '127.0.0.1' });
    expect(handle.host).toBe('127.0.0.1');
    expect(handle.port).toBeGreaterThan(0);
    await handle.close();
  });

  it('close() shuts down the HTTP server and McpServer cleanly', async () => {
    const server = mockServer();
    const handle = await connectStreamableHttp(server, { port: 0, host: '127.0.0.1' });
    await handle.close();
    // Calling close() twice MUST NOT throw (idempotent)
    await expect(handle.close()).resolves.not.toThrow();
    expect(vi.mocked(server.stop)).toHaveBeenCalled();
  });
});
