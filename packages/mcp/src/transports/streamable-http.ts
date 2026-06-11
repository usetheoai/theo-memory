/**
 * Streamable-HTTP transport adapter — T6.2.
 *
 * Wires `@modelcontextprotocol/sdk/server/streamableHttp.js#StreamableHTTPServerTransport`
 * in STATELESS mode (per discover blueprint Q5 — `sessionIdGenerator: undefined`) behind
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
 * @see .claude/knowledge-base/discoveries/blueprints discover Q5 — stateless mode pattern
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { withBearerAuth, type BearerAuthOptions } from '../auth/with-bearer-auth.js';
import type { McpServer } from '../server.js';

/** Hosts treated as localhost for the non-localhost-without-TLS guard (ADR-0015 #3). */
const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Per ADR-0015 § Decision #3 — `themory mcp --transport streamable-http
 * --host <non-localhost>` refuses to start without TLS config. We do NOT yet
 * plumb TLS material (cert/key) into the transport surface; non-localhost +
 * no TLS = REFUSE. When TLS plumbing lands (follow-up cycle), this guard
 * accepts the supplied cert/key and skips the throw.
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
   * TLS config marker — when present, the non-localhost guard accepts the
   * host. Reserved for the follow-up cycle that plumbs cert/key material;
   * currently any truthy value satisfies the guard (placeholder shape).
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
 * Boots a node:http server bound to `{host, port}` and connects the McpServer
 * to a stateless StreamableHTTPServerTransport. Returns a handle for graceful
 * shutdown.
 */
export async function connectStreamableHttp(
  server: McpServer,
  options: StreamableHttpOptions,
): Promise<StreamableHttpHandle> {
  // ADR-0015 #3 — non-localhost host MUST have TLS config or we refuse to start.
  // The guard runs BEFORE we touch the SDK transport / open a listener so
  // misconfigurations fail loudly and immediately (Inquebrável Rule 8 fail-fast).
  assertNonLocalhostHasTls(options.host, options.tls !== undefined);

  // STATEFUL session mode — singleton transport + UUID-per-session session id.
  //
  // Historical note (themory-issue-3.md, team report 2026-06-08): T6.2 originally
  // set `sessionIdGenerator: undefined` claiming "stateless mode per discover
  // blueprint Q5". The SDK contract is incompatible with that choice when paired
  // with a singleton transport: with `undefined`, the `initialize` response omits
  // `Mcp-Session-Id`, and every subsequent request (`tools/list`, `tools/call`)
  // hits 500 from the SDK internals because the singleton's session-tracking
  // state has nothing to correlate against. Net effect: 100% of standard MCP
  // clients (Claude Code, Cursor, Cline, MCP Inspector) failed silently — only
  // `initialize` succeeded; tools were unreachable.
  //
  // Fix: emit a UUID session id per `initialize`, which is the SDK-canonical
  // stateful pattern. Compatible with singleton transport AND with standard
  // clients. Real stateless mode would require a per-request transport + per-
  // request McpServer clone (Option B in the report) — non-trivial cost
  // (~10x CPU from clone overhead) and out-of-scope for v0.3.
  //
  // Multi-instance deployments (load-balanced, no sticky session) are NOT
  // affected by v0.3 (single-instance). When that scenario lands, the session
  // state needs an external store (Redis-class); tracked as follow-up.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // T4.1 — when bearerAuth is supplied, every request is gated through
  // withBearerAuth BEFORE the MCP transport sees it. When omitted, the
  // transport runs without auth (legitimate only for localhost dev loops).
  const baseHandler = (req: IncomingMessage, res: ServerResponse): void => {
    void transport.handleRequest(req, res).catch((err: unknown) => {
      // T1.5 — sanitize error response (CWE-209 information disclosure).
      // Log the real error for debugging; respond with a generic message.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[themory-mcp] transport error: ${message}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error\n');
      }
    });
  };

  const gatedHandler = options.bearerAuth
    ? withBearerAuth(baseHandler, options.bearerAuth)
    : baseHandler;

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Wrap the gated handler so any synchronous throw inside auth/transport
    // surfaces as 500 rather than crashing the listener.
    Promise.resolve(gatedHandler(req, res)).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal server error: ${message}\n`);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  // SDK StreamableHTTPServerTransport.onclose is `() => void | undefined` which
  // doesn't satisfy Transport's strict `() => void` under exactOptionalPropertyTypes.
  // Cast at boundary — runtime contract is the SDK's, not the type stub's.
  await server.start(transport as unknown as Transport);

  const addr = httpServer.address();
  const resolvedPort =
    addr !== null && typeof addr === 'object' ? addr.port : options.port;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await server.stop();
  };

  return {
    host: options.host,
    port: resolvedPort,
    address: () => httpServer.address(),
    close,
  };
}
