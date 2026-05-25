/**
 * Streamable-HTTP transport adapter — T6.2.
 *
 * Wires `@modelcontextprotocol/sdk/server/streamableHttp.js#StreamableHTTPServerTransport`
 * in STATELESS mode (per Mem0 blueprint Q5 — `sessionIdGenerator: undefined`) behind
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
 * @see Mem0 blueprint Q5 — stateless mode pattern
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { McpServer } from '../server.js';

export interface StreamableHttpOptions {
  readonly port: number;
  readonly host: string;
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
  // Stateless mode per Mem0 Q5 — no session persistence across requests.
  // SDK accepts `sessionIdGenerator: undefined` at runtime per its docstring example;
  // type def omits undefined under strict exactOptionalPropertyTypes — narrow cast at boundary.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void transport.handleRequest(req, res).catch((err: unknown) => {
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
