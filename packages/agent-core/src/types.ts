/**
 * Public + internal types for `@usetheo/memory/agent-tools` (v0.3 MCP server subpath).
 *
 * @see ADR D1 — Transport selection: stdio (primary) + streamable-HTTP (secondary)
 * @see ADR D8 — Package surface (subpath + bin + bundle isolation)
 */
import type { Memory } from '@usetheo/memory/contract';

/**
 * Transport flavor for the MCP server.
 *
 * Per ADR D1: `stdio` (default — local CLI via `themory mcp`) and
 * `streamable-http` (HTTP deploy paths, TheoCloud v0.5 alignment) are the native
 * transports. `sse` was added by the OpenMemory MCP-compat cycle (Roadmap Item
 * 26): it is NOT used by the native server (which still ships stdio + streamable-
 * http only); it backs the opt-in `--compat openmemory` surface, whose clients
 * (Cursor/Claude/Windsurf/Cline) speak the OpenMemory SSE convention. `fastmcp`
 * wrapper deferred until v0.5+ OAuth scenarios.
 */
export type TransportKind = 'stdio' | 'streamable-http' | 'sse';

/**
 * Tool surface the MCP server exposes.
 *
 * `native` (default) = TheMemory's verbs (`remember`/`recall`/`forget`/`reflect`).
 * `openmemory` = the OpenMemory-shape alias set (`add_memories`/`search_memory`/
 * `list_memories`/`delete_memories`) for drop-in compatibility with OpenMemory-wired
 * MCP clients. Roadmap Item 26 (P0 sub-goal 3).
 */
export type ToolsetKind = 'native' | 'openmemory';

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
  /**
   * Tool surface to expose. Defaults to `'native'`. When `'openmemory'`, the
   * server's `tools/list` + `tools/call` use the OpenMemory alias set instead
   * of the native verbs (Roadmap Item 26).
   */
  readonly toolset?: ToolsetKind;
}
