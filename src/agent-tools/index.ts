/**
 * Public barrel for `@usetheo/memory/agent-tools` (v0.3 MCP server subpath).
 *
 * Stub barrel at T0.2 — exports `createMcpServer` placeholder + the public types
 * from `./types.ts`. Real `McpServer` class lands at T1.1 (Phase 1 bootstrap).
 *
 * @see ADR D4 — SDK integration via SDK's existing MCP client (no SDK changes)
 * @see ADR D8 — Package surface: this subpath, not the main `@usetheo/memory` barrel,
 *   ships the MCP server entry. Default barrel MUST NOT re-export anything from here
 *   (bundle isolation verified by `tests/integration/agent-tools/public-paths.test.ts`).
 */

import type { McpServerOptions } from './types.js';

export type { TransportKind, McpServerOptions } from './types.js';

/**
 * Constructs an MCP server bound to a TheMemory runtime.
 *
 * Stub at T0.2 — throws when called. Real implementation lands at T1.1
 * (the `McpServer` class wrapping `@modelcontextprotocol/sdk/server`).
 *
 * @param _options server identity + version (defaults at T1.1)
 * @returns an MCP server handle (shape finalized at T1.1)
 * @throws Error — always at T0.2; remove this throw at T1.1 when McpServer ships
 */
export function createMcpServer(_options?: McpServerOptions): never {
  throw new Error(
    'createMcpServer: implementation deferred to T1.1 (Phase 1 — McpServer wrapper class).',
  );
}
