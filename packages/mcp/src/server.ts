/**
 * McpServer — thin wrapper around `@modelcontextprotocol/sdk/server/index.js#Server`.
 *
 * Owns the SDK server instance + the capability declaration. Tool registration
 * (T2.1+) and transport binding (T6.1+) wire into this wrapper.
 *
 * @see ADR D2 — Tool schema: 4 separate tools, capabilities.tools.listChanged: false (4 tools static)
 * @see ADR D4 — SDK integration via SDK's existing MCP client (no SDK changes)
 * @see ADR D8 — Package surface: exported via `@usetheo/memory-agent-core` subpath only
 */
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import { withScope, tryGetScope } from '@usetheo/memory-agent-core';
import type { McpServerOptions } from '@usetheo/memory-agent-core';

import { buildOpenMemoryToolsList, openMemoryDispatch } from './openmemory/tools.js';
import { dispatch } from './tools/dispatch.js';
import { buildToolsListResponse } from './tools/list-handler.js';

/**
 * MCP `_meta` key for per-call user-scope override. Reverse-DNS namespaced
 * per MCP spec convention. When present on `request.params._meta`, the
 * server wraps the dispatched handler in `withScope({ kind: 'user', userId }, ...)`.
 *
 * Fallback chain (first match wins):
 *  1. `request.params._meta['io.usetheo.themory/user_id']` (per-call override)
 *  2. The transport-resolved scope — on streamable-http this is the sanitized
 *     `X-Theo-User-Id` the edge injects for the authenticated caller.
 *  3. `process.env['THEOMEM_MCP_DEFAULT_USER_ID']` (server-lifetime default)
 *  4. NO scope wrapper — handlers calling `getScope()` throw `MissingScopeError`,
 *     surfacing the misconfig loudly per Inquebrável Rule 3.
 *
 * Rung 2 is load-bearing and was missing: the env default is a per-DEPLOYMENT
 * constant, so on a shared server it pins every caller — of every tenant — to one
 * user tier. Anything the edge resolved per-request MUST outrank it, or the
 * constant silently wins and the agent's memories land under an identity no
 * consumer queries (which is why the dashboard listed nothing: it reads
 * `/v1/scopes/user/{session-subject}/memories`).
 *
 * Added 2026-06-04 to close the dogfood T2.1 architectural gap (MCP stdio
 * transport had no scope binding). See
 */
const META_USER_ID_KEY = 'io.usetheo.themory/user_id';

function resolveScopedUserId(
  meta: Record<string, unknown> | undefined,
  fromTransport: string | undefined,
): string | undefined {
  const fromMeta = meta?.[META_USER_ID_KEY];
  if (typeof fromMeta === 'string' && fromMeta.length > 0) {
    return fromMeta;
  }
  if (fromTransport !== undefined && fromTransport.length > 0) {
    return fromTransport;
  }
  const fromEnv = process.env['THEOMEM_MCP_DEFAULT_USER_ID'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}

/** Locked default server identity advertised in MCP `initialize` handshake. */
const DEFAULT_SERVER_NAME = 'themory';

/** Default version when consumer does not provide one (overridable per construction). */
const DEFAULT_SERVER_VERSION = '0.3.0';

/**
 * Capability shape declared by all v0.3 McpServer instances.
 *
 * `listChanged: false` per ADR D2 — v0.3 ships 4 static tools (`remember`, `recall`,
 * `forget`, `reflect`); the tool set never changes at runtime so no `notifications/tools/list_changed`
 * traffic is emitted (the procedural skill library lands v0.6 per CLAUDE.md Roadmap Item 8).
 */
const STATIC_CAPABILITIES: ServerCapabilities = Object.freeze({
  tools: { listChanged: false },
});

export class McpServer {
  readonly name: string;
  readonly version: string;
  readonly capabilities: ServerCapabilities;
  readonly sdkServer: SdkServer;

  constructor(options: McpServerOptions) {
    this.name = options.name ?? DEFAULT_SERVER_NAME;
    this.version = options.version ?? DEFAULT_SERVER_VERSION;
    this.capabilities = STATIC_CAPABILITIES;
    this.sdkServer = new SdkServer(
      { name: this.name, version: this.version },
      { capabilities: this.capabilities },
    );
    // Toolset selection (Roadmap Item 26): native verbs (default) OR the
    // OpenMemory alias set. Both register the same JSON-RPC handlers; only the
    // list payload + the dispatch function differ.
    const openMemory = options.toolset === 'openmemory';
    this.sdkServer.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve(openMemory ? buildOpenMemoryToolsList() : buildToolsListResponse()),
    );
    const dispatchFn = openMemory ? openMemoryDispatch : dispatch;
    // Register the tools/call dispatch handler. Protocol Errors throw McpError;
    // Tool Execution Errors return CallToolResult.
    const memoryFactory = options.memoryFactory;
    const recallTraceStore = options.recallTraceStore; // M4 — backs explain_recall
    const memoryEntityStore = options.memoryEntityStore; // M14 T2.2 — backs list_entities
    this.sdkServer.setRequestHandler(CallToolRequestSchema, (req) => {
      if (memoryFactory === undefined) {
        return Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: 'Memory backend not configured on this McpServer instance. Pass memoryFactory in McpServerOptions to enable tools/call.',
            },
          ],
          isError: true,
        });
      }
      const outerScope = tryGetScope();
      const userId = resolveScopedUserId(req.params._meta, outerScope?.session?.userId);
      if (userId !== undefined) {
        // MERGE, never replace. `withScope` swaps the whole AsyncLocalStorage
        // context, so `{ session: { userId } }` alone DROPS the auth-trusted
        // `workspaceId` the transport resolved from the Principal. With
        // THEOMEM_MCP_DEFAULT_USER_ID set (as the deployed MCP service does),
        // userId is always defined, so that branch always ran and every tool call
        // executed against unbound memory keyed by one shared userId — collapsing
        // all tenants onto the same rows. Violates theo-data/CLAUDE.md invariants
        // 2 and 3 (workspace_id == tenant_id; scope from the Principal).
        return withScope({ ...outerScope, session: { userId } }, () =>
          dispatchFn(req.params.name, req.params.arguments, { memoryFactory, ...(recallTraceStore !== undefined ? { recallTraceStore } : {}), ...(memoryEntityStore !== undefined ? { memoryEntityStore } : {}) }),
        );
      }
      return dispatchFn(req.params.name, req.params.arguments, { memoryFactory, ...(recallTraceStore !== undefined ? { recallTraceStore } : {}), ...(memoryEntityStore !== undefined ? { memoryEntityStore } : {}) });
    });
  }

  /** Connects the server to a transport (stdio at T6.1, streamable-HTTP at T6.2). */
  async start(transport: Transport): Promise<void> {
    await this.sdkServer.connect(transport);
  }

  /** Gracefully closes the server connection. */
  async stop(): Promise<void> {
    await this.sdkServer.close();
  }
}
