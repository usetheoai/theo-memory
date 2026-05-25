/**
 * stdio transport adapter — T6.1.
 *
 * Thin wrapper around `@modelcontextprotocol/sdk/server/stdio.js#StdioServerTransport`.
 * SDK's `StdioServerTransport` defaults to `process.stdin/stdout`; the DI overload
 * `(stdin?, stdout?)` is reserved for unit tests.
 *
 * @see ADR D1 — stdio is the primary transport for local CLI deployment
 * @see REDACTED blueprint Q4 — Template Method pattern (lifecycle owned by server; transport wraps stdin/stdout)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { McpServer } from '../server.js';

/**
 * Connects the McpServer to a stdio transport. After this resolves, the server
 * is live on process.stdin/stdout; the process stays alive until stdin closes.
 */
export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.start(transport);
}
