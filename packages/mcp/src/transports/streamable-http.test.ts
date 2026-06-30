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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IncomingMessage } from 'node:http';

import { connectStreamableHttp, scopeFromHeaders, scopeFromRequest } from '../transports/streamable-http.js';
import { attachWorkspace } from '../auth/request-workspace.js';
import type { McpServer } from '../server.js';

// T2.2 (#82) — scopeFromRequest threads the AUTH-TRUSTED workspace into the ctx;
// the userId tier still comes from the X-Theo-User-Id header. The workspace MUST
// come only from the auth attachment, never from a client header (ADR D2).
describe('scopeFromRequest (workspace from auth + userId from header)', () => {
  function reqWith(headers: Record<string, string>, workspaceId?: string): IncomingMessage {
    const req = { headers } as unknown as IncomingMessage;
    if (workspaceId !== undefined) attachWorkspace(req, workspaceId);
    return req;
  }

  it('carries the auth-attached workspaceId + the header userId', () => {
    const ctx = scopeFromRequest(reqWith({ 'x-theo-user-id': 'alice' }, 'tn-A'));
    expect(ctx).toEqual({ workspaceId: 'tn-A', session: { userId: 'alice' } });
  });

  it('IGNORES a client-supplied x-workspace-id header — only the auth attachment sets the workspace (ADR D2)', () => {
    const ctx = scopeFromRequest(reqWith({ 'x-workspace-id': 'tn-EVIL', 'x-theo-user-id': 'alice' }));
    expect(ctx).toEqual({ session: { userId: 'alice' } });
    expect(ctx?.workspaceId).toBeUndefined();
  });

  it('workspace-only request (no userId header) yields a workspace-scoped ctx', () => {
    const ctx = scopeFromRequest(reqWith({}, 'tn-A'));
    expect(ctx).toEqual({ workspaceId: 'tn-A' });
  });

  it('no workspace + no userId → undefined (scope-required tools fail closed)', () => {
    const ctx = scopeFromRequest(reqWith({}));
    expect(ctx).toBeUndefined();
  });
});

// theo-workspace#10 follow-up / ADR D3 — the deferred per-request scope-binding for
// the native streamable-HTTP transport. The header binds the userId tier (the only
// tier memoryFromCtx resolves); EC-16 sanitization is enforced here.
describe('scopeFromHeaders (native streamable-http scope binding)', () => {
  it('binds the userId tier from a valid X-Theo-User-Id header', () => {
    expect(scopeFromHeaders({ 'x-theo-user-id': 'alice' })).toEqual({ session: { userId: 'alice' } });
  });
  it('returns undefined when the header is absent (fail-closed: tools see no scope)', () => {
    expect(scopeFromHeaders({})).toBeUndefined();
  });
  it('rejects empty / whitespace-only values', () => {
    expect(scopeFromHeaders({ 'x-theo-user-id': '   ' })).toBeUndefined();
    expect(scopeFromHeaders({ 'x-theo-user-id': '' })).toBeUndefined();
  });
  it('rejects unsafe characters and oversize ids (EC-16 sanitization)', () => {
    expect(scopeFromHeaders({ 'x-theo-user-id': 'a/../b' })).toBeUndefined();
    expect(scopeFromHeaders({ 'x-theo-user-id': 'a b' })).toBeUndefined();
    expect(scopeFromHeaders({ 'x-theo-user-id': 'x'.repeat(201) })).toBeUndefined();
  });
  it('accepts the safe id charset (alnum . _ : -) and the first value of an array header', () => {
    expect(scopeFromHeaders({ 'x-theo-user-id': 't-1:u_2.3-4' })).toEqual({ session: { userId: 't-1:u_2.3-4' } });
    expect(scopeFromHeaders({ 'x-theo-user-id': ['first', 'second'] })).toEqual({ session: { userId: 'first' } });
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
    const handle = await connectStreamableHttp(server, {
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
      connectStreamableHttp(server, { port: 0, host: '0.0.0.0' }),
    ).rejects.toThrow(/non-localhost/i);
  });
});
