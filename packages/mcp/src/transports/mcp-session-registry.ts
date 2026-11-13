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
  /**
   * The authenticated principal that opened the session, or `undefined` when the
   * transport runs without auth. A request naming this session under another
   * principal is answered 404, exactly like an unknown id (usetheoai/theo#477).
   */
  readonly owner: string | undefined;
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
    owner?: string,
  ): Promise<StreamableHTTPServerTransport | undefined> {
    const sessionId = readSessionId(req);
    if (sessionId === undefined) return this.open(res, owner);

    // A session belongs to the principal that opened it. Another principal presenting its id
    // gets the same 404 as an unknown id — never a hint that the session exists.
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined && existing.owner === owner) return existing.transport;

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
  /**
   * Drops a session from `pending` and stops its server at most once.
   *
   * `stopping` is what makes this safe from every entry point: `server.stop()` closes
   * the transport, which fires `onclose`, which calls back here. Without the flag that
   * recursed until "Maximum call stack size exceeded".
   */
  private evict(session: Session): void {
    this.pending.delete(session);
    if (session.stopping) return;
    session.stopping = true;
    void session.server.stop();
  }

  private async open(res: ServerResponse, owner: string | undefined): Promise<StreamableHTTPServerTransport> {
    const server = this.createServer();
    const session: Session = {
      transport: undefined as unknown as StreamableHTTPServerTransport,
      server,
      stopping: false,
      owner,
    };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        this.sessions.set(sessionId, session);
        this.pending.delete(session);
      },
    });
    Object.assign(session, { transport });
    // Until `initialize` succeeds the session has no id, so it is in no map.
    this.pending.add(session);
    // Evict as soon as THIS response ends without a session having been established.
    //
    // Every sessionless request lands here, not just `initialize`: the SDK answers a
    // sessionless non-initialize with 400 and returns early, without ever closing the
    // transport, so `onclose` does not fire. Parking in `pending` alone only cleaned
    // up at shutdown, which left growth unbounded at runtime — any client retry loop
    // could pin one McpServer per request for the process lifetime.
    //
    // `finish` fires for the rejected case AND for an initialize whose connection dies
    // before completing. When `initialize` succeeded, `transport.sessionId` is set and
    // the session has already moved into `sessions`, so this is a no-op for it.
    // 'close', not 'finish': 'finish' fires only when the response was fully written,
    // so a client that aborts mid-flight would leave its session in `pending` until
    // shutdown — the same leak in a narrower window. 'close' fires on completion AND
    // on premature termination, so it is a strict superset.
    //
    // Safe against killing a live session: the SDK assigns `sessionId` and awaits
    // `onsessioninitialized` BEFORE building the response, so by the time this runs on
    // a successful handshake the id is set and the session has already left `pending`.
    res.once('close', () => {
      if (transport.sessionId === undefined) this.evict(session);
    });
    // Evict on close: a disconnected client must not pin its server either.
    transport.onclose = (): void => {
      const id = transport.sessionId;
      if (id !== undefined) this.sessions.delete(id);
      this.evict(session);
    };
    await server.start(transport);
    return transport;
  }
}
