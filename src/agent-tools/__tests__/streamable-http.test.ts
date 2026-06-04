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

  it('connects the McpServer to the StreamableHTTPServerTransport (stateless mode)', async () => {
    const server = mockServer();
    const handle = await connectStreamableHttp(server, { port: 0, host: '127.0.0.1' });
    // server.start called with a transport whose sessionId is undefined (stateless mode per discover Q5)
    expect(vi.mocked(server.start)).toHaveBeenCalledTimes(1);
    const transport = vi.mocked(server.start).mock.calls[0]?.[0] as { sessionId?: string };
    expect(transport.sessionId).toBeUndefined();
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
