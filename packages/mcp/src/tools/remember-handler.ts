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
import type { Memory } from '@usetheo/memory/contract';
import type { RememberOptions } from '@usetheo/memory/contract';

import { INPUT_SCHEMA, TOOL_NAME } from './remember-schema.js';
import { routeScopedMemory } from './route-scoped-memory.js';


export { TOOL_NAME };

function buildRememberOptions(
  metadata: Record<string, string | number | boolean | null> | undefined,
  infer: boolean | undefined,
): RememberOptions | undefined {
  if (metadata !== undefined && infer !== undefined) return { metadata, infer };
  if (metadata !== undefined) return { metadata };
  if (infer !== undefined) return { infer };
  return undefined;
}

export async function rememberHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  // M8 routing (ADR D6): the agent chose GLOBAL (no sessionId) vs SESSION (sessionId);
  // the user is always the auth-trusted context user (routeScopedMemory never binds an
  // agent-supplied user).
  const scoped = routeScopedMemory(deps.memoryFactory(), parsed.sessionId);

  const baseOptions = buildRememberOptions(parsed.metadata, parsed.infer);
  const evidenceOptions = parsed.evidence === undefined ? baseOptions : { ...baseOptions, evidence: parsed.evidence };

  const finalOptions = parsed.strictExtraction === undefined ? evidenceOptions : { ...evidenceOptions, strictExtraction: parsed.strictExtraction };
  const contextOptions = parsed.idempotencyKey === undefined && parsed.expiresAt === undefined && parsed.observedAt === undefined ? finalOptions : {
    ...finalOptions,
    ...(parsed.idempotencyKey !== undefined ? { idempotencyKey: parsed.idempotencyKey } : {}),
    ...(parsed.expiresAt !== undefined ? { expiresAt: new Date(parsed.expiresAt) } : {}),
    ...(parsed.observedAt !== undefined ? { observedAt: new Date(parsed.observedAt) } : {}),
  };
  const items = await scoped.remember(parsed.content, contextOptions);

  // Honest disclosure (Inquebrável Rule 3): propagate actual result instead of returning
  // silent "Memory persisted." regardless of outcome. items=[] happens when the LLM
  // extraction pipeline returns drafts=[] OR fails (catch in pipeline.ts swallows provider
  // errors — see extraction_failed / extraction_zero_facts OTel events for distinction).
  // Without this, data-loss is invisible to MCP callers (issue #1 in /tmp/themory-issue.md).
  if (items.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'No facts were extracted from the content; nothing was persisted. The LLM extractor returned an empty result (drafts=[]) or the provider call failed. Check OTel events `extraction_failed` and `extraction_zero_facts` to distinguish.',
      }],
      isError: true,
    };
  }

  const ids = items.map((i) => i.id).join(', ');
  // ADR-0029: the agent must know which earlier memories this write made no longer current.
  const replaced = items.flatMap((i) => i.supersedes ?? []);
  const replacedNote = replaced.length === 0
    ? ''
    : `. Replaced ${replaced.length} earlier memor${replaced.length === 1 ? 'y' : 'ies'}: ${replaced.join(', ')}`;
  return {
    content: [{
      type: 'text',
      text: `Persisted ${items.length} memory item${items.length === 1 ? '' : 's'}: ${ids}${replacedNote}`,
    }],
    isError: false,
  };
}
