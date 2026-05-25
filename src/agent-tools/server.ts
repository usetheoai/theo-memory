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
import { ListToolsRequestSchema, type ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { buildToolsListResponse } from './tools/list-handler.js';
import type { McpServerOptions } from './types.js';

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
