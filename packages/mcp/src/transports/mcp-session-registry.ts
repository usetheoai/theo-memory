/**
 * Session registry for the Streamable HTTP transport.
 *
 * The MCP Streamable HTTP contract is one session per client, identified by the
 * `Mcp-Session-Id` header. Each session owns its own SDK transport, and an
 * `McpServer` binds exactly one transport at a time — so a session also owns its
 * own server instance. Keeping that lifecycle here leaves `streamable-http.ts`
 * responsible only for binding the listener and gating requests.
 *
 * M7 (2026-07-21): before this module, the transport was a singleton. An SDK
 * transport binds its session at the first `initialize`, so the second client to
 * connect was rejected with `-32600 "Server already initialized"` — only ONE MCP
 * client could ever use the server. Regression test:
 * `streamable-http-multisession.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer } from '../server.js';

/**
 * How the caller supplies MCP servers. A factory (not an instance) is required
 * because every session needs its own server; the expensive Memory backend is
 * shared through the caller's closure, so each call is cheap.
 */
export type McpServerFactory = () => McpServer;

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: McpServer;
  /**
   * Guards the stop cycle. `server.stop()` closes the transport, which fires
   * `onclose`, which would call `server.stop()` again — that recursed until
   * "Maximum call stack size exceeded". BOTH entry points (onclose and closeAll)
   * set it, so the cycle cannot start from either direction.
   */
  stopping: boolean;
}

/** Reads the session header, tolerating node's `string | string[]` typing. */
function readSessionId(req: IncomingMessage): string | undefined {
  const raw = req.headers['mcp-session-id'];
  return Array.isArray(raw) ? raw[0] : raw;
}

export class McpSessionRegistry {
  private readonly sessions = new Map<string, Session>();
  /** Sessions created but not yet through `initialize` — see `open()`. */
  private readonly pending = new Set<Session>();

  constructor(private readonly createServer: McpServerFactory) {}

  /** Live session count — for tests and for operational visibility. */
  get size(): number {
    return this.sessions.size + this.pending.size;
  }

  /**
   * Resolves the transport that should handle this request.
   *
   * No session header → a new session (the `initialize` path). A header naming a
   * session we know → that session's transport. A header we do NOT know is never
   * silently upgraded into a new session: that would hand the client a different
   * session than the one it believes it is on. It gets 404, the spec's signal to
   * re-`initialize`, and this method returns `undefined` to mean "already answered".
   */
  async resolve(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<StreamableHTTPServerTransport | undefined> {
    const sessionId = readSessionId(req);
    if (sessionId === undefined) return this.open();

    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) return existing.transport;

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: null,
      }),
    );
    return undefined;
  }

  /** Stops every live session. Called when the listener closes. */
  async closeAll(): Promise<void> {
    const live = [...this.sessions.values(), ...this.pending];
    this.sessions.clear();
    this.pending.clear();
    await Promise.all(
      live.map((s) => {
        if (s.stopping) return Promise.resolve();
        s.stopping = true;
        return s.server.stop();
      }),
    );
  }

  /**
   * Creates a session. Registration happens in `onsessioninitialized` because that
   * is the only point where the SDK-minted id and the transport are both known —
   * registering earlier would leave an unroutable entry in the map.
   */
  private async open(): Promise<StreamableHTTPServerTransport> {
    const server = this.createServer();
    const session: Session = {
      transport: undefined as unknown as StreamableHTTPServerTransport,
      server,
      stopping: false,
    };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        this.sessions.set(sessionId, session);
        this.pending.delete(session);
      },
    });
    Object.assign(session, { transport });
    // Until `initialize` succeeds the session has no id, so it is in no map and
    // `closeAll()` cannot reach it. Park it in `pending` so an abandoned handshake
    // — or a header-less request that the SDK rejects outright — is still torn down
    // instead of pinning an McpServer for the process lifetime.
    this.pending.add(session);
    // Evict on close: a disconnected client must not pin its server either.
    transport.onclose = (): void => {
      const id = transport.sessionId;
      if (id !== undefined) this.sessions.delete(id);
      this.pending.delete(session);
      if (session.stopping) return;
      session.stopping = true;
      void server.stop();
    };
    // The SDK's `onclose` type is `(() => void) | undefined`, which does not
    // satisfy Transport's strict `() => void` under exactOptionalPropertyTypes.
    // Cast at the boundary — the runtime contract is the SDK's, not the stub's.
    await server.start(transport as unknown as Transport);
    return transport;
  }
}
