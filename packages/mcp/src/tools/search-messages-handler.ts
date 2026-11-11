/**
 * `search_messages` dispatch handler (ADR-0031). Binds the scope exactly like `recall`
 * (`routeScopedMemory`: the authenticated user, optionally one of that user's sessions) and
 * delegates to `ScopedMemory.searchMessages`.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Memory } from '@usetheo/memory/contract';

import { routeScopedMemory } from './route-scoped-memory.js';
import { INPUT_SCHEMA, TOOL_NAME, type SearchMessagesOutput } from './search-messages-schema.js';

export { TOOL_NAME };

export async function searchMessagesHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  const scoped = routeScopedMemory(deps.memoryFactory(), parsed.sessionId);
  const found = await scoped.searchMessages(parsed.query, {
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    ...(parsed.asOf !== undefined ? { asOf: new Date(parsed.asOf) } : {}),
  });
  const structuredContent: SearchMessagesOutput = {
    messages: found.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      score: m.score,
      observedAt: m.observedAt === null ? null : m.observedAt.toISOString(),
      loggedAt: m.loggedAt.toISOString(),
    })),
  };
  const text = found.length === 0
    ? 'No messages matched the query.'
    : found.map((m, i) => `${String(i + 1)}. [${m.role}] ${m.content}`).join('\n');
  return { content: [{ type: 'text', text }], structuredContent, isError: false };
}
