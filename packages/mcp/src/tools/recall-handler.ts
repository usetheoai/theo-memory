/**
 * `recall` dispatch handler — T5.1.
 *
 * EC-6 absorbed: empty-recall shape lock `{content: [{text: 'No memories matched...'}], structuredContent: {results: []}, isError: false}`.
 * createdAt:Date is mapped to ISO string at the wire boundary (per OUTPUT_SCHEMA T2.1).
 *
 * @see ADR D2 — schema + verb separation
 * @see ADR D3 — scope binding
 * @see ADR D4 — reuse memoryFromCtx
 * @see EC-6 — empty-recall content shape lock
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MemoryItemWithScore } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';

import { INPUT_SCHEMA, TOOL_NAME } from './recall-schema.js';
import { routeScopedMemory } from './route-scoped-memory.js';


export { TOOL_NAME };

function toWireResult(hit: MemoryItemWithScore): Record<string, unknown> {
  return {
    id: hit.id,
    text: hit.text,
    score: hit.score,
    scope: hit.scope,
    createdAt: hit.createdAt.toISOString(),
    // When the fact was said, which differs from createdAt for anything written with observedAt.
    tValid: hit.tValid?.toISOString() ?? null,
    ...(hit.eventTime !== undefined ? { eventTime: hit.eventTime } : {}),
    ...(hit.durability !== undefined ? { durability: hit.durability } : {}),
    metadata: hit.metadata,
    ...(hit.sources !== undefined
      ? { sources: hit.sources.map((s) => ({ role: s.role, content: s.content, observedAt: s.observedAt?.toISOString() ?? null })) }
      : {}),
  };
}

export async function recallHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  // M8 routing (ADR D6): search GLOBAL (no sessionId) vs SESSION (sessionId), always
  // under the auth-trusted context user.
  const scoped = routeScopedMemory(deps.memoryFactory(), parsed.sessionId);
  // M0 — parity with REST: graph-aware + point-in-time. Reconstruct graphExpand with
  // per-key conditional spread so no `| undefined` leaks (exactOptionalPropertyTypes);
  // spread-when-present keeps the call byte-unchanged when omitted. The temporal
  // filter (t_invalid / asOf) is applied inside the shared expansion store.
  const graphExpand =
    parsed.graphExpand === undefined
      ? undefined
      : {
          ...(parsed.graphExpand.hops !== undefined ? { hops: parsed.graphExpand.hops } : {}),
          ...(parsed.graphExpand.limit !== undefined ? { limit: parsed.graphExpand.limit } : {}),
        };
  const hits = await scoped.recall(parsed.query, {
    topK: parsed.topK,
    threshold: parsed.threshold,
    ...(graphExpand !== undefined ? { graphExpand } : {}),
    ...(parsed.asOf !== undefined ? { asOf: new Date(parsed.asOf) } : {}),
    ...(parsed.includeSources !== undefined ? { includeSources: parsed.includeSources } : {}),
  });

  // EC-6: empty-recall shape lock
  if (hits.length === 0) {
    return {
      content: [{ type: 'text', text: 'No memories matched the query.' }],
      structuredContent: { results: [] },
      isError: false,
    };
  }

  const results = hits.map(toWireResult);
  return {
    content: [{ type: 'text', text: JSON.stringify(results) }],
    structuredContent: { results },
    isError: false,
  };
}
