/**
 * `search_messages` dispatch handler (ADR-0031). Binds the scope exactly like `recall`
 * (`routeScopedMemory`: the authenticated user, optionally one of that user's sessions) and
 * delegates to `ScopedMemory.searchMessages`.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LoggedMessage, Memory } from '@usetheo/memory/contract';

import { routeScopedMemory } from './route-scoped-memory.js';
import { INPUT_SCHEMA, TOOL_NAME, type SearchMessagesOutput } from './search-messages-schema.js';

export { TOOL_NAME };

function toLoggedJson(m: LoggedMessage) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    observedAt: m.observedAt === null ? null : m.observedAt.toISOString(),
    loggedAt: m.loggedAt.toISOString(),
  };
}

export async function searchMessagesHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  const scoped = routeScopedMemory(deps.memoryFactory(), parsed.sessionId);
  const found = await scoped.searchMessages(parsed.query, {
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    ...(parsed.asOf !== undefined ? { asOf: new Date(parsed.asOf) } : {}),
    ...(parsed.surroundingTurns !== undefined ? { surroundingTurns: parsed.surroundingTurns } : {}),
  });
  const structuredContent: SearchMessagesOutput = {
    messages: found.map((m) => ({
      ...toLoggedJson(m),
      score: m.score,
      ...(m.surrounding !== undefined
        ? { surrounding: { before: m.surrounding.before.map(toLoggedJson), after: m.surrounding.after.map(toLoggedJson) } }
        : {}),
    })),
  };
  const line = (m: LoggedMessage) => `[${m.role}] ${m.content}`;
  const text = found.length === 0
    ? 'No messages matched the query.'
    : found.map((m, i) => [
      ...(m.surrounding?.before ?? []).map((n) => `   before: ${line(n)}`),
      `${String(i + 1)}. ${line(m)}`,
      ...(m.surrounding?.after ?? []).map((n) => `   after: ${line(n)}`),
    ].join('\n')).join('\n');
  return { content: [{ type: 'text', text }], structuredContent, isError: false };
}
