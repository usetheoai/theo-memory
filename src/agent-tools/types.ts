/**
 * Public + internal types for `@usetheo/memory/agent-tools` (v0.3 MCP server subpath).
 *
 * @see ADR D1 — Transport selection: stdio (primary) + streamable-HTTP (secondary)
 * @see ADR D8 — Package surface (subpath + bin + bundle isolation)
 */
import type { Memory } from '../core/memory-store.js';

/**
 * Transport flavor for the MCP server.
 *
 * Per ADR D1: ship `stdio` (default — local CLI via `npx @usetheo/memory/agent-tools`)
 * and `streamable-http` (for HTTP deploy paths, TheoCloud v0.5 alignment).
 * SSE explicitly skipped (4× independently confirmed deprecated). `fastmcp` wrapper
 * deferred until v0.5+ OAuth scenarios.
 */
export type TransportKind = 'stdio' | 'streamable-http';

/**
 * Constructor options for the MCP server class (implementation lands at T1.1).
 *
 * Stub-shape only at T0.2 — fields finalize as Phase 1 + 6 wire concrete behavior.
 *
 * @see ADR D3 — Cross-tool isolation via `AsyncLocalStorage<ScopedContext>`
 * @see ADR D4 — SDK integration via SDK's existing MCP client (no SDK changes)
 */
export interface McpServerOptions {
  /** Server identity advertised in MCP `initialize` handshake. Defaults to `'themory'`. */
  readonly name?: string;
  /** Server version advertised in MCP `initialize` handshake. Defaults to package.json#version. */
  readonly version?: string;
  /**
   * Factory producing the Memory runtime. Called once per `tools/call` request
   * (per ADR D3 + D4 — handler resolves scoped memory via `memoryFromCtx`).
   * Optional at construction time so the server can still serve `tools/list`
   * without a memory backend; absence at `tools/call` time surfaces a Tool
   * Execution Error per ADR D6.
   */
  readonly memoryFactory?: () => Memory;
}
