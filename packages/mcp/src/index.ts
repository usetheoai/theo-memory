/**
 * Public barrel for @usetheo/memory-mcp.
 * Exports the MCP server class + transport connectors + bootstrap function.
 */
export { McpServer } from './server.js';
export type { McpServerOptions } from '@usetheo/memory-agent-core';
export { runMcpServer } from './run-mcp-server.js';
export type { RunMcpServerOptions } from './run-mcp-server.js';
export { connectStdio } from './transports/stdio.js';
export { connectStreamableHttp } from './transports/streamable-http.js';
export type { StreamableHttpOptions, StreamableHttpHandle } from './transports/streamable-http.js';
// OpenMemory MCP-shape compatibility (Roadmap Item 26).
export { buildOpenMemoryToolsList, openMemoryDispatch } from './openmemory/tools.js';
