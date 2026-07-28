/**
 * `episodes` dispatch handler (G3-MCP).
 *
 * Temporal episodic read surface over MCP: delegates to the SHIPPED
 * `ScopedMemory.episodes(options)` (v0.14.0) via the SAME scope binding as
 * `recall` (`memoryFromCtx(getScope(), ...)`). `createdAt:Date` is mapped to an
 * ISO string at the wire boundary; `nextCursor` is forwarded so the consumer can
 * page (EC-1). Absent options are omitted so `episodes()` sees only present keys
 * (EC-2 — never `queryText:''`). `asOf` ISO string is parsed to a Date (D4).
 *
 * @see packages/core/src/domain/episode.ts — EpisodeListOptions / EpisodePage
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { EpisodeListOptions, Memory, MemoryItem } from '@usetheo/memory/contract';
import { memoryFromCtx } from '@usetheo/memory/theokit';
import { getScope } from '@usetheo/memory-agent-core';

import { INPUT_SCHEMA, TOOL_NAME } from './episodes-schema.js';
import { workspaceScopedMemory } from './workspace-scoped-memory.js';


export { TOOL_NAME };

function toWireItem(item: MemoryItem): Record<string, unknown> {
  return {
    id: item.id,
    text: item.text,
    scope: item.scope,
    createdAt: item.createdAt.toISOString(),
    metadata: item.metadata,
  };
}

export async function episodesHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);

  // EC-2: build options with ONLY present keys — never forward `queryText:''` /
  // `order:undefined`. asOf ISO string → Date (D4).
  const options: { -readonly [K in keyof EpisodeListOptions]?: EpisodeListOptions[K] } = {};
  if (parsed.after !== undefined) options.after = parsed.after;
  if (parsed.before !== undefined) options.before = parsed.before;
  if (parsed.limit !== undefined) options.limit = parsed.limit;
  if (parsed.order !== undefined) options.order = parsed.order;
  if (parsed.queryText !== undefined) options.queryText = parsed.queryText;
  if (parsed.asOf !== undefined) options.asOf = new Date(parsed.asOf);

  const scoped = memoryFromCtx(getScope(), workspaceScopedMemory(deps.memoryFactory()));
  const page =
    Object.keys(options).length > 0 ? await scoped.episodes(options) : await scoped.episodes();

  const items = page.items.map(toWireItem);
  // EC-1: forward nextCursor so the consumer can page; omit the key when absent.
  const structuredContent: { items: Record<string, unknown>[]; nextCursor?: string } = { items };
  if (page.nextCursor !== undefined) {
    structuredContent.nextCursor = page.nextCursor;
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
    isError: false,
  };
}
