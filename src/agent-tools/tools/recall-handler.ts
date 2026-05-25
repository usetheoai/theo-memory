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

import type { MemoryItemWithScore } from '../../core/memory-item.js';
import type { Memory } from '../../core/memory-store.js';
import { memoryFromCtx } from '../../theokit/index.js';
import { getScope } from '../scope.js';

import { INPUT_SCHEMA, TOOL_NAME } from './recall-schema.js';

export { TOOL_NAME };

function toWireResult(hit: MemoryItemWithScore): Record<string, unknown> {
  return {
    id: hit.id,
    text: hit.text,
    score: hit.score,
    scope: hit.scope,
    createdAt: hit.createdAt.toISOString(),
    metadata: hit.metadata,
  };
}

export async function recallHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  const scoped = memoryFromCtx(getScope(), deps.memoryFactory());
  const hits = await scoped.recall(parsed.query, {
    topK: parsed.topK,
    threshold: parsed.threshold,
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
