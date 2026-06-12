/**
 * Public barrel for @usetheo/memory-mcp.
 * Exports the MCP server class + transport connectors + bootstrap function.
 */
export { McpServer } from './server.js';
export type { McpServerOptions } from '@usetheo/memory/agent-tools';
export { runMcpServer } from './run-mcp-server.js';
export type { RunMcpServerOptions } from './run-mcp-server.js';
export { connectStdio } from './transports/stdio.js';
export { connectStreamableHttp } from './transports/streamable-http.js';
export type { StreamableHttpOptions, StreamableHttpHandle } from './transports/streamable-http.js';
