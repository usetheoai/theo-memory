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

import { McpServer } from './server.js';
import type { McpServerOptions } from './types.js';

export type { TransportKind, McpServerOptions } from './types.js';
export { McpServer } from './server.js';
export { withScope, getScope } from './scope.js';
export { connectStdio } from './transports/stdio.js';

/**
 * Constructs an MCP server bound to a TheMemory runtime.
 *
 * @param options server identity + version (defaults: name='themory', version='0.3.0')
 * @returns an `McpServer` handle ready for transport binding (T6.1 stdio / T6.2 streamable-HTTP)
 */
export function createMcpServer(options?: McpServerOptions): McpServer {
  return new McpServer(options ?? {});
}
