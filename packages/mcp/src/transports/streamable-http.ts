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


import type { ScopedContext } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';

import { isGatewayTrusted, userFromRequest, workspaceFromRequest } from '../auth/request-workspace.js';
import { withBearerAuth, type BearerAuthOptions } from '../auth/with-bearer-auth.js';

import { McpSessionRegistry } from './mcp-session-registry.js';
import type { McpServerFactory } from './mcp-session-registry.js';

/** Hosts treated as localhost for the non-localhost-without-TLS guard (ADR-0015 #3). */
const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Header that carries the per-request user scope on the native streamable-HTTP
 * transport (ADR D3 — the binding deferred at T6.2; theo-workspace#10 follow-up).
 * Mirrors the SSE transport, which binds `userId` from the URL path. Only the
 * `userId` tier is bound because that is the only tier `memoryFromCtx` resolves.
 * Within a workspace the tiers are organizational partitions (the workspace/tenant
 * is the security boundary, enforced upstream by the Model B per-tenant key), so a
 * caller-supplied user id here is the same trust level as the SSE URL user.
 */
const USER_SCOPE_HEADER = 'x-theo-user-id';

/** EC-16 — accept only a safe id charset, bounded length (no traversal/whitespace). */
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * scopeFromHeaders extracts a sanitized per-request scope from the request headers,
 * or `undefined` when absent/invalid (fail-closed: handlers then see no scope and a
 * scope-required tool call fails per ADR D3). Pure + exported for unit testing.
 */
export function scopeFromHeaders(
  headers: NodeJS.Dict<string | string[]>,
): { session: { userId: string } } | undefined {
  const raw = headers[USER_SCOPE_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (value === undefined || value === '' || !SAFE_SCOPE_ID.test(value)) return undefined;
  return { session: { userId: value } };
}

/**
 * Build the per-request `ScopedContext` from a request: the `workspaceId` comes
 * from the AUTH-TRUSTED attachment (`withBearerAuth` → `resolvePrincipal`, never a
 * client header — plan `mcp-workspace-binding-isolation` ADR D2, theo-memory#82),
 * and the `userId` tier comes from the sanitized `X-Theo-User-Id` header. Returns
 * `undefined` when neither is present (no-auth dev with no header → no scope, and
 * scope-required tools fail closed). Pure + exported for unit testing.
 */
export function scopeFromRequest(req: IncomingMessage): ScopedContext | undefined {
  const headerScope = scopeFromHeaders(req.headers);
  const workspaceId = workspaceFromRequest(req);
  // M16 (#121) + /review Finding 2 — three cases, precedence in order:
  //  1. an auth-resolved user (user-bound key) IS the identity; the header is ignored.
  //  2. no auth user BUT the request is gateway-trusted (a workspace-level credential bearing
  //     `memory:platform-admin`) → honour `X-Theo-User-Id`, the gateway's injected signal.
  //  3. otherwise → NO session. A workspace-level key used directly cannot pick a user via a
  //     header; a scope-required tool call then fails closed instead of impersonating.
  const authUser = userFromRequest(req);
  const session =
    authUser !== undefined
      ? { userId: authUser }
      : isGatewayTrusted(req)
        ? headerScope?.session
        : undefined;
  if (workspaceId === undefined && session === undefined) return undefined;
  return {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(session !== undefined ? { session } : {}),
  };
}

/**
 * Per ADR-0015 § Decision #3 — `themory mcp --transport streamable-http
 * --host <non-localhost>` refuses to start without TLS config. TLS material
 * (cert/key) is now plumbed into the transport surface: non-localhost + tls =
 * HTTPS listener; non-localhost + no TLS = REFUSE.
 */
function assertNonLocalhostHasTls(host: string, hasTls: boolean): void {
  if (LOCALHOST_HOSTS.has(host)) return;
  if (hasTls) return;
  throw new Error(
    `connectStreamableHttp: refusing to start on non-localhost host "${host}" without TLS config. ` +
      `Per ADR-0015 #3 (MCP spec network-hygiene mandate), HTTPS is required for any host that is not 127.0.0.1 / ::1 / localhost. ` +
      `Either pass tls: { cert, key } in StreamableHttpOptions (when supported) OR bind to localhost.`,
  );
}

export interface StreamableHttpOptions {
  readonly port: number;
  readonly host: string;
  /**
   * Optional Bearer-auth gate (T4.1, ADR-0015). When supplied, every HTTP
   * request is checked via `withBearerAuth` BEFORE the MCP transport sees
   * it. `theo_live_*` keys route to `bearerAuth.apiKey`; everything else
   * routes to `bearerAuth.oidc`. Omit to leave the transport unauthenticated
   * (only safe for localhost stdio-equivalent deployments).
   */
  readonly bearerAuth?: BearerAuthOptions;
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
  assertNonLocalhostHasTls(options.host, options.tls !== undefined);

  // Sessions live in McpSessionRegistry: one transport + one McpServer per client,
  // routed by Mcp-Session-Id. See that module for the M7 singleton-transport defect
  // this replaced (second client got -32600 "Server already initialized").
  const sessions = new McpSessionRegistry(createServer);

  // T4.1 — when bearerAuth is supplied, every request is gated through
  // withBearerAuth BEFORE the MCP transport sees it. When omitted, the
  // transport runs without auth (legitimate only for localhost dev loops).
  const baseHandler = (req: IncomingMessage, res: ServerResponse): void => {
    const dispatch = async (): Promise<void> =>
      // resolve() returns undefined when it already answered (unknown session id).
      sessions
        .resolve(req, res)
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
    // Bind the per-request scope: workspace from the AUTH-TRUSTED attachment
    // (resolvePrincipal, never a client header — ADR D2, #82) + the userId tier
    // from the X-Theo-User-Id header. Absent → no scope (scope-required tools fail
    // closed). The workspace is what `workspaceScopedMemory` binds at each tool site.
    const ctx = scopeFromRequest(req);
    void (ctx ? withScope(ctx, dispatch) : dispatch());
  };

  const gatedHandler = options.bearerAuth
    ? withBearerAuth(baseHandler, options.bearerAuth)
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
