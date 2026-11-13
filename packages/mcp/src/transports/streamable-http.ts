/**
 * Streamable-HTTP transport adapter — T6.2.
 *
 * Wires `@modelcontextprotocol/sdk/server/streamableHttp.js#StreamableHTTPServerTransport`
 * in STATEFUL per-session mode (one transport per Mcp-Session-Id) behind
 * a node:http server. Secondary transport per ADR D1 (stdio is primary); used for
 * HTTP-deployed scenarios (TheoCloud v0.5 alignment).
 *
 * Scope binding: streamable-HTTP is per-request stateless. Handlers receive raw
 * IncomingMessage and may extract X-Agent-Id header to build ScopedContext + wrap
 * dispatch in `withScope`. T6.2 ships the BASE transport wiring; per-request
 * scope-header middleware lands at v0.4 (deferred: agent loops mostly use stdio
 * at v0.3; HTTP scenarios at v0.5+ TheoCloud).
 *
 * EC-15 (port collision) + EC-16 (X-Agent-Id sanitization) deferred via followups —
 * primary v0.3 transport is stdio; HTTP testing depth ramps up at v0.5 cloud.
 *
 * @see ADR D1 — Transport: stdio + streamable-HTTP (skip SSE + fastmcp)
 */
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';


import { withWorkspaceScope } from '@usetheo/memory';
import type { ScopedContext } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';

import { withOAuthResourceServer, type OAuthResourceServerOptions } from '../auth/oauth-resource-server.js';
import { userFromRequest, workspaceFromRequest } from '../auth/request-workspace.js';

import { McpSessionRegistry } from './mcp-session-registry.js';
import type { McpServerFactory } from './mcp-session-registry.js';

/** Hosts treated as localhost for the non-localhost-without-TLS guard (ADR-0015 #3). */
const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Build the per-request `ScopedContext` from what the auth gate attached: the workspace is
 * the token's `tenant_id` and the user is its `sub`. Nothing a client sends — no header, no
 * body field — reaches either (theo-memory#82, #121).
 *
 * `X-Theo-User-Id` used to be honoured for a gateway credential. With every request carrying
 * its own audience-bound token there is no gateway credential any more, so the header is
 * ignored unconditionally. Returns `undefined` when nothing was attached (no-auth local dev),
 * and scope-required tools then fail closed. Pure + exported for unit testing.
 */
export function scopeFromRequest(req: IncomingMessage): ScopedContext | undefined {
  const workspaceId = workspaceFromRequest(req);
  const userId = userFromRequest(req);
  if (workspaceId === undefined && userId === undefined) return undefined;
  return {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(userId !== undefined ? { session: { userId } } : {}),
  };
}

/**
 * Per ADR-0015 § Decision #3 — a non-localhost host needs TLS. The one exception is a
 * deployment whose TLS is terminated by the gateway or mesh in front
 * (`THEO_MCP_TLS_TERMINATED_UPSTREAM=true`), and that exception never extends to an
 * unauthenticated listener: plain HTTP on a routable address is only acceptable when every
 * request still has to present a token this server validates itself.
 */
function assertTransportSecurity(
  host: string,
  opts: { readonly hasTls: boolean; readonly tlsTerminatedUpstream: boolean; readonly authenticated: boolean },
): void {
  if (LOCALHOST_HOSTS.has(host)) return;
  if (opts.hasTls) return;
  if (opts.tlsTerminatedUpstream) {
    if (opts.authenticated) return;
    throw new Error(
      `connectStreamableHttp: refusing plain HTTP on non-localhost host "${host}" without authentication. ` +
        'THEO_MCP_TLS_TERMINATED_UPSTREAM only waives TLS for a listener that validates access tokens itself.',
    );
  }
  throw new Error(
    `connectStreamableHttp: refusing to start on non-localhost host "${host}" without TLS config. ` +
      `Per ADR-0015 #3 (MCP spec network-hygiene mandate), HTTPS is required for any host that is not 127.0.0.1 / ::1 / localhost. ` +
      'Pass tls: { cert, key }, bind to localhost, or — when a gateway or mesh terminates TLS in front of this ' +
      'server — set THEO_MCP_TLS_TERMINATED_UPSTREAM=true.',
  );
}

/**
 * The identity a session is bound to: the tenant and user that opened it. A request that
 * presents another principal with that session id is answered as if the session did not
 * exist — otherwise a leaked id would let a second tenant attach to the first one's stream.
 */
function sessionOwnerOf(req: IncomingMessage): string | undefined {
  const workspaceId = workspaceFromRequest(req);
  if (workspaceId === undefined) return undefined;
  return `${workspaceId}\u0000${userFromRequest(req) ?? ''}`;
}

export interface StreamableHttpOptions {
  readonly port: number;
  readonly host: string;
  /**
   * OAuth 2.1 resource-server gate (usetheoai/theo#477). When supplied, every request must
   * carry a valid RS256 access token for this resource, and its `tenant_id` / `sub` become
   * the request's workspace and user. Omit only for local development on localhost.
   */
  readonly oauth?: OAuthResourceServerOptions;
  /**
   * `THEO_MCP_TLS_TERMINATED_UPSTREAM=true`: TLS is terminated by the gateway or mesh in
   * front, so a non-localhost host may bind plain HTTP — only together with `oauth`.
   */
  readonly tlsTerminatedUpstream?: boolean;
  /**
   * TLS material — when present, the listener binds via `https.createServer`
   * and the non-localhost guard accepts the host. `cert`/`key` are PEM strings
   * (read from disk by the CLI `--tls-cert`/`--tls-key` flags). Required for any
   * non-localhost host per ADR-0015 #3.
   */
  readonly tls?: { readonly cert: string; readonly key: string };
}

export interface StreamableHttpHandle {
  /** Resolved host the server is listening on. */
  readonly host: string;
  /** OS-assigned port if input was 0; otherwise the configured port. */
  readonly port: number;
  /** Underlying node:http server address (`AddressInfo | null | string`). */
  address(): AddressInfo | string | null;
  /** Gracefully close the HTTP server + McpServer. Idempotent. */
  close(): Promise<void>;
}

/**
 * Boots a node:http server bound to `{host, port}`. Each MCP client gets its own
 * session (transport + McpServer built by `createServer`), so many clients can use
 * one listener concurrently. Returns a handle for graceful shutdown.
 */
export async function connectStreamableHttp(
  createServer: McpServerFactory,
  options: StreamableHttpOptions,
): Promise<StreamableHttpHandle> {
  // ADR-0015 #3 — non-localhost host MUST have TLS config or we refuse to start.
  // The guard runs BEFORE we touch the SDK transport / open a listener so
  // misconfigurations fail loudly and immediately (Inquebrável Rule 8 fail-fast).
  assertTransportSecurity(options.host, {
    hasTls: options.tls !== undefined,
    tlsTerminatedUpstream: options.tlsTerminatedUpstream === true,
    authenticated: options.oauth !== undefined,
  });

  // Sessions live in McpSessionRegistry: one transport + one McpServer per client,
  // routed by Mcp-Session-Id. See that module for the M7 singleton-transport defect
  // this replaced (second client got -32600 "Server already initialized").
  const sessions = new McpSessionRegistry(createServer);

  // When `oauth` is supplied, every request passes the resource-server gate BEFORE the MCP
  // transport sees it. When omitted, the transport runs without auth (localhost dev only).
  const baseHandler = (req: IncomingMessage, res: ServerResponse): void => {
    const dispatch = async (): Promise<void> =>
      // resolve() returns undefined when it already answered (unknown session id).
      sessions
        .resolve(req, res, sessionOwnerOf(req))
        .then((transport) => (transport ? transport.handleRequest(req, res) : undefined))
        .catch((err: unknown) => {
        // T1.5 — sanitize error response (CWE-209 information disclosure).
        // Log the real error for debugging; respond with a generic message.
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[themory-mcp] transport error: ${message}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error\n');
        }
      });
    // Two scopes, both from the validated token. The agent scope (`withScope`) is what the
    // tool handlers read; the workspace scope (`withWorkspaceScope`) is what the tenant-scoped
    // pool reads to set `app.workspace_id` on every connection, so the database's own
    // policies confine each statement to the token's tenant. Absent → no scope (local dev).
    const ctx = scopeFromRequest(req);
    const workspaceId = workspaceFromRequest(req);
    const scoped = (): Promise<void> =>
      workspaceId !== undefined ? withWorkspaceScope(workspaceId, dispatch) : dispatch();
    void (ctx ? withScope(ctx, scoped) : scoped());
  };

  const gatedHandler = options.oauth
    ? withOAuthResourceServer(baseHandler, options.oauth)
    : baseHandler;

  // Wrap the gated handler so any synchronous throw inside auth/transport
  // surfaces as 500 rather than crashing the listener.
  const requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
    Promise.resolve(gatedHandler(req, res)).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal server error: ${message}\n`);
      }
    });
  };

  // ADR-0015 #3 — when TLS material is supplied, bind an HTTPS listener so
  // non-localhost hosts (e.g. 0.0.0.0 reached by a containerized gateway via
  // host.docker.internal) speak TLS. Without tls, a plain node:http listener
  // is used (only reached after the localhost guard above).
  const httpServer: HttpServer | HttpsServer = options.tls
    ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, requestHandler)
    : createHttpServer(requestHandler);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address();
  const resolvedPort =
    addr !== null && typeof addr === 'object' ? addr.port : options.port;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Sessions FIRST. `httpServer.close()` stops accepting new connections but
    // resolves only once existing sockets end, and Streamable HTTP holds long-lived
    // text/event-stream connections that never end on their own — closing the
    // listener first would block forever waiting for streams that closeAll() has
    // not been reached to terminate.
    await sessions.closeAll();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return {
    host: options.host,
    port: resolvedPort,
    address: () => httpServer.address(),
    close,
  };
}
