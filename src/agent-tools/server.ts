/**
 * McpServer — thin wrapper around `@modelcontextprotocol/sdk/server/index.js#Server`.
 *
 * Owns the SDK server instance + the capability declaration. Tool registration
 * (T2.1+) and transport binding (T6.1+) wire into this wrapper.
 *
 * @see ADR D2 — Tool schema: 4 separate tools, capabilities.tools.listChanged: false (4 tools static)
 * @see ADR D4 — SDK integration via SDK's existing MCP client (no SDK changes)
 * @see ADR D8 — Package surface: exported via `@usetheo/memory/agent-tools` subpath only
 */
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';

import { withScope } from './scope.js';
import { dispatch } from './tools/dispatch.js';
import { buildToolsListResponse } from './tools/list-handler.js';
import type { McpServerOptions } from './types.js';

/**
 * MCP `_meta` key for per-call user-scope override. Reverse-DNS namespaced
 * per MCP spec convention. When present on `request.params._meta`, the
 * server wraps the dispatched handler in `withScope({ kind: 'user', userId }, ...)`.
 *
 * Fallback chain (first match wins):
 *  1. `request.params._meta['io.usetheo.themory/user_id']` (per-call override)
 *  2. `process.env['THEOMEM_MCP_DEFAULT_USER_ID']` (server-lifetime default)
 *  3. NO scope wrapper — handlers calling `getScope()` throw `MissingScopeError`,
 *     surfacing the misconfig loudly per Inquebrável Rule 3.
 *
 * Added 2026-06-04 to close the dogfood T2.1 architectural gap (MCP stdio
 * transport had no scope binding). See
 * `.claude/knowledge-base/audits/dogfood-anchor-T2.1-mcp-stdio-scope-binding-gap-2026-06-04.md`.
 */
const META_USER_ID_KEY = 'io.usetheo.themory/user_id';

function resolveScopedUserId(meta: Record<string, unknown> | undefined): string | undefined {
  const fromMeta = meta?.[META_USER_ID_KEY];
  if (typeof fromMeta === 'string' && fromMeta.length > 0) {
    return fromMeta;
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
 * traffic is emitted ( skill library lands v0.6 per CLAUDE.md Roadmap Item 8).
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
    // Register the static tools/list handler at construction time (4 tools never change
    // for v0.3 per ADR D2 listChanged:false). See `tools/list-handler.ts` for shape.
    this.sdkServer.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve(buildToolsListResponse()),
    );
    // Register the tools/call dispatch handler — routes to {remember,recall,forget,reflect}
    // handlers per T5.1. Protocol Errors throw McpError; Tool Execution Errors return CallToolResult.
    const memoryFactory = options.memoryFactory;
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
      const userId = resolveScopedUserId(req.params._meta);
      if (userId !== undefined) {
        return withScope({ session: { userId } }, () =>
          dispatch(req.params.name, req.params.arguments, { memoryFactory }),
        );
      }
      return dispatch(req.params.name, req.params.arguments, { memoryFactory });
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
