/**
 * SSE transport adapter — OpenMemory MCP-shape compatibility (Roadmap Item 26, plan T1.1).
 *
 * Mirrors the OpenMemory MCP Server's connection convention so OpenMemory-wired
 * clients (Cursor/Claude/Windsurf/Cline) connect unchanged:
 *   - `GET  /{client}/sse/{user}`            → open the SSE event stream
 *   - `POST /{client}/sse/{user}/messages/`  → client→server JSON-RPC messages
 *   - `POST /messages/`                       → base message route (sessionId in query)
 *   - `*    /{client}/http/{user}`            → Streamable HTTP (MCP 2025-03-26+)
 *
 * Per-connection model: the SDK `Server` is 1:1 with a transport, so each GET
 * spawns a FRESH `McpServer` (via `serverFactory`) + `SSEServerTransport`, keyed
 * by the SDK-generated `sessionId`. The `user_id` is parsed from the URL path
 * (OpenMemory's local-first, no-bearer scoping) and bound per message via
 * `withScope` so tool handlers resolve the right user (blueprint D3).
 *
 * The `{client}` path segment is part of the OpenMemory route shape but is NOT
 * yet surfaced as `mcp_client` metadata on stored memories — that enrichment
 * (blueprint D3 / Q2) is DEFERRED to a follow-up: threading it would widen the
 * core `ScopedContext` contract, which is out of scope for this MCP-compat cycle.
 * The segment is still required structurally (it forms the messages endpoint).
 *
 * Uses the SDK's existing `SSEServerTransport` — NO new dependency (blueprint Corner 2).
 *
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { withScope } from '@usetheo/memory-agent-core';

import type { McpServer } from '../server.js';

const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** ADR-0015 #3 — non-localhost bind requires TLS (the SSE path has no bearer auth). */
function assertNonLocalhostHasTls(host: string, hasTls: boolean): void {
  if (LOCALHOST_HOSTS.has(host) || hasTls) return;
  throw new Error(
    `connectSse: refusing to start on non-localhost host "${host}" without TLS. ` +
      `The SSE compat surface is unauthenticated (local-first); bind to localhost or supply tls.`,
  );
}

export interface SseOptions {
  readonly port: number;
  readonly host: string;
  /** A fresh McpServer per SSE connection (SDK Server is 1:1 with a transport). */
  readonly serverFactory: () => McpServer;
  readonly tls?: { readonly cert: string; readonly key: string };
}

export interface SseHandle {
  readonly host: string;
  readonly port: number;
  address(): AddressInfo | string | null;
  close(): Promise<void>;
}

/** Path shapes (capture client_name + user_id). */
const SSE_GET_RE = /^\/([^/]+)\/sse\/([^/]+)\/?$/;
const SSE_MSG_RE = /^\/([^/]+)\/sse\/([^/]+)\/messages\/?$/;
const HTTP_RE = /^\/([^/]+)\/http\/([^/]+)\/?$/;

interface Session {
  readonly transport: SSEServerTransport;
  readonly server: McpServer;
  readonly userId: string;
}

export async function connectSse(options: SseOptions): Promise<SseHandle> {
  assertNonLocalhostHasTls(options.host, options.tls !== undefined);

  const sessions = new Map<string, Session>();

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    void route(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[themory-mcp sse] error: ${message}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error\n');
      }
    });
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // 1. Open SSE stream: GET /{client}/sse/{user}
    const getMatch = SSE_GET_RE.exec(path);
    if (method === 'GET' && getMatch) {
      const userId = decodeURIComponent(getMatch[2] ?? '');
      const messagesEndpoint = `/${getMatch[1]}/sse/${getMatch[2]}/messages/`;
      const transport = new SSEServerTransport(messagesEndpoint, res);
      const server = options.serverFactory();
      const session: Session = { transport, server, userId };
      sessions.set(transport.sessionId, session);
      transport.onclose = (): void => {
        sessions.delete(transport.sessionId);
      };
      res.on('close', () => {
        sessions.delete(transport.sessionId);
      });
      await server.start(transport);
      return;
    }

    // 2. Client→server messages: POST /{client}/sse/{user}/messages/ (sessionId in query)
    if (method === 'POST' && (SSE_MSG_RE.test(path) || path === '/messages/' || path === '/messages')) {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const session = sessions.get(sessionId);
      if (session === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Unknown or expired SSE session\n');
        return;
      }
      // Bind the path-derived user scope for the duration of this message so the
      // compat tool handlers resolve memory.user(<user>) (blueprint D3).
      await withScope({ session: { userId: session.userId } }, () =>
        session.transport.handlePostMessage(req, res),
      );
      return;
    }

    // 3. Streamable HTTP: /{client}/http/{user} (MCP 2025-03-26+). Per-connection
    //    stateful transport + fresh server, scope bound from the path.
    //
    //    Deliberately hand-rolled here rather than delegating to
    //    `connectStreamableHttp`: that helper owns its OWN http.Server + bearer-auth
    //    pipeline and binds scope from the Authorization header, NOT from the URL
    //    path. The compat surface needs the OpenMemory path-param scoping
    //    (`/{client}/http/{user}` → withScope userId) on THIS shared server, so the
    //    transport is constructed inline. (blueprint D2 / Q2 path-scoping)
    const httpMatch = HTTP_RE.exec(path);
    if (httpMatch) {
      const userId = decodeURIComponent(httpMatch[2] ?? '');
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      const server = options.serverFactory();
      await server.start(transport);
      await withScope({ session: { userId } }, () => transport.handleRequest(req, res));
      return;
    }

    // 4. Unknown path.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }

  const httpServer: Server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address();
  const resolvedPort = addr !== null && typeof addr === 'object' ? addr.port : options.port;

  let closed = false;
  return {
    host: options.host,
    port: resolvedPort,
    address: () => httpServer.address(),
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      for (const s of sessions.values()) {
        await s.server.stop().catch(() => undefined);
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
