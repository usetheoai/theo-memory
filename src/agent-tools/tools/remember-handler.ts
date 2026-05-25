/**
 * `remember` dispatch handler — T5.1.
 *
 * Validates args via T2.1 zod schema, resolves scoped memory via T3.1 `getScope()`
 * + `memoryFromCtx`, calls `ScopedMemory.remember`, returns CallToolResult.
 *
 * Errors bubble to dispatch's try/catch → T4.1 classifier → ADR D6 wire shape.
 *
 * @see ADR D2 — schema + verb separation
 * @see ADR D3 — scope binding via AsyncLocalStorage
 * @see ADR D4 — reuse memoryFromCtx
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { Memory } from '../../core/memory-store.js';
import { memoryFromCtx } from '../../theokit/index.js';
import { getScope } from '../scope.js';

import { INPUT_SCHEMA, TOOL_NAME } from './remember-schema.js';

export { TOOL_NAME };

export async function rememberHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  const scoped = memoryFromCtx(getScope(), deps.memoryFactory());
  await scoped.remember(parsed.content, parsed.metadata ? { metadata: parsed.metadata } : undefined);
  return {
    content: [{ type: 'text', text: 'Memory persisted.' }],
    isError: false,
  };
}
