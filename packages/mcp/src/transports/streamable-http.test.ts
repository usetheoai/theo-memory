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
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';


import { attachUser, attachWorkspace } from '../auth/request-workspace.js';
import type { McpServer } from '../server.js';
import { connectStreamableHttp, scopeFromRequest } from '../transports/streamable-http.js';

// T2.2 (#82), M16 (#121), usetheoai/theo#477 — the scope comes from what the auth gate
// attached (the token's tenant and subject). No client header reaches it.
describe('scopeFromRequest (workspace and user from the auth attachment only)', () => {
  function reqWith(headers: Record<string, string>, workspaceId?: string, userId?: string): IncomingMessage {
    const req = { headers } as unknown as IncomingMessage;
    if (workspaceId !== undefined) attachWorkspace(req, workspaceId);
    if (userId !== undefined) attachUser(req, userId);
    return req;
  }

  it('carries the attached workspace and user', () => {
    expect(scopeFromRequest(reqWith({}, 'tn-A', 'alice'))).toEqual({
      workspaceId: 'tn-A',
      session: { userId: 'alice' },
    });
  });

  it('IGNORES the X-Theo-User-Id header even when a workspace is attached', () => {
    const ctx = scopeFromRequest(reqWith({ 'x-theo-user-id': 'mallory' }, 'tn-A'));
    expect(ctx).toEqual({ workspaceId: 'tn-A' });
  });

  it('IGNORES a client-supplied x-workspace-id header — only the auth attachment sets the workspace (ADR D2)', () => {
    const ctx = scopeFromRequest(reqWith({ 'x-workspace-id': 'tn-EVIL', 'x-theo-user-id': 'alice' }));
    expect(ctx).toBeUndefined();
  });

  it('no attachment → undefined (scope-required tools fail closed)', () => {
    expect(scopeFromRequest(reqWith({}))).toBeUndefined();
  });
});

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
    const handle = await connectStreamableHttp(() => server, { port: 0, host: '127.0.0.1' });
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

  it('builds no McpServer until a client connects (one server per session, M7)', async () => {
    const server = mockServer();
    // Servers are now per-session, so booting the listener must NOT construct or
    // start one. Pre-M7 a singleton transport+server was wired at boot, which is
    // exactly what limited the process to a single MCP client.
    const handle = await connectStreamableHttp(() => server, { port: 0, host: '127.0.0.1' });
    expect(vi.mocked(server.start)).not.toHaveBeenCalled();
    await handle.close();
  });

  it('exposes a host + port pair via the returned handle', async () => {
    const server = mockServer();
    const handle = await connectStreamableHttp(() => server, { port: 0, host: '127.0.0.1' });
    expect(handle.host).toBe('127.0.0.1');
    expect(handle.port).toBeGreaterThan(0);
    await handle.close();
  });

  it('close() shuts down the HTTP listener idempotently', async () => {
    const server = mockServer();
    const handle = await connectStreamableHttp(() => server, { port: 0, host: '127.0.0.1' });
    await handle.close();
    // Calling close() twice MUST NOT throw (idempotent)
    await expect(handle.close()).resolves.not.toThrow();
    // No session was opened, so no per-session server exists to stop. Session
    // teardown is covered by streamable-http-multisession.test.ts.
    expect(vi.mocked(server.stop)).not.toHaveBeenCalled();
  });
});

describe('connectStreamableHttp TLS plumbing (ADR-0015 #3)', () => {
  let certDir: string;
  let cert: string;
  let key: string;

  beforeAll(() => {
    // Ephemeral self-signed dev cert in a tmp dir — NEVER committed (Rule 9: use
    // openssl, do not reinvent X.509 issuance). SAN covers the hosts the gateway
    // reaches the themory MCP on in dev (localhost / host.docker.internal loopbacks).
    certDir = mkdtempSync(join(tmpdir(), 'themory-mcp-tls-'));
    const keyPath = join(certDir, 'key.pem');
    const certPath = join(certDir, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1',
    ], { stdio: 'pipe' });
    cert = readFileSync(certPath, 'utf8');
    key = readFileSync(keyPath, 'utf8');
  });

  afterAll(() => {
    rmSync(certDir, { recursive: true, force: true });
  });

  it('boots an HTTPS listener when tls cert/key is supplied (real TLS handshake succeeds)', async () => {
    // Non-localhost host + tls present: the guard accepts AND the transport MUST
    // bind via https.createServer. Proof: an HTTPS client completes the TLS
    // handshake. If the listener were plain node:http, the handshake fails
    // (wrong-version-number / ECONNRESET) and this test goes red.
    const server = mockServer();
    const handle = await connectStreamableHttp(() => server, {
      port: 0,
      host: '0.0.0.0',
      tls: { cert, key },
    });
    try {
      const handshakeOk = await new Promise<boolean>((resolve, reject) => {
        const req = httpsRequest(
          {
            host: '127.0.0.1',
            port: handle.port,
            method: 'POST',
            path: '/',
            rejectUnauthorized: false, // self-signed dev cert
            timeout: 4000,
          },
          (res) => {
            // ANY HTTP response over the socket proves the TLS handshake completed.
            res.resume();
            resolve(true);
          },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('TLS request timed out')));
        req.end('{}');
      });
      expect(handshakeOk).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('refuses a non-localhost host when NO tls is supplied (ADR-0015 #3 fail-fast)', async () => {
    const server = mockServer();
    await expect(
      connectStreamableHttp(() => server, { port: 0, host: '0.0.0.0' }),
    ).rejects.toThrow(/non-localhost/i);
  });
});
