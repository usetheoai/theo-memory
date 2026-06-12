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

import { McpServer } from '@usetheo/memory-mcp';

import type { McpServerOptions } from './types.js';

export type { TransportKind, McpServerOptions } from './types.js';
export { McpServer } from '@usetheo/memory-mcp';
export { withScope, getScope } from './scope.js';
export { connectStdio } from '@usetheo/memory-mcp';
export { connectStreamableHttp } from '@usetheo/memory-mcp';
export type { StreamableHttpOptions, StreamableHttpHandle } from '@usetheo/memory-mcp';

// --- Shared agent-tools symbols consumed by @usetheo/memory-mcp (T2.1 dedup) ---
export {
  assertEnvOrExit,
  createAgentToolsMemory,
  LOCAL_EMBEDDER_DIM,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
  wireMemoryFromPool,
} from './agent-tools-memory.js';
export {
  classifyError,
  EXPECTED_DOMAIN_ERRORS,
  UnknownToolError,
} from './error-classifier.js';
export type {
  ClassifiedError,
  ProtocolErrorPayload,
  ToolExecutionErrorPayload,
} from './error-classifier.js';
export {
  resolveBootstrapToken,
  resolveOidcConfig,
} from './oidc-cli-resolver.js';
export type {
  ResolveOidcConfigInput,
  ResolvedOidcConfig,
} from './oidc-cli-resolver.js';

/**
 * Constructs an MCP server bound to a TheMemory runtime.
 *
 * @param options server identity + version (defaults: name='themory', version='0.3.0')
 * @returns an `McpServer` handle ready for transport binding (T6.1 stdio / T6.2 streamable-HTTP)
 */
export function createMcpServer(options?: McpServerOptions): McpServer {
  return new McpServer(options ?? {});
}
