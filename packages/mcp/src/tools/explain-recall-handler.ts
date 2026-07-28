/**
 * `explain_recall` dispatch handler (M4) — the MCP read surface for the
 * accountable-forgetting trace. Workspace comes from the auth-trusted
 * ScopedContext (never the args) → CWE-441 safe, mirroring the S2 REST handler.
 *
 * When the deployment did NOT wire a recall-trace store (tracing off), returns
 * an honest "not enabled" result rather than a misleading empty success.
 *
 * @see packages/api/src/server/handlers/recall-traces.ts (S2 REST twin)
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import type { Memory, RecallTraceStore } from '@usetheo/memory/contract';
import { getScope } from '@usetheo/memory-agent-core';

import { INPUT_SCHEMA, TOOL_NAME } from './explain-recall-schema.js';

export { TOOL_NAME };

export async function explainRecallHandler(
  args: unknown,
  deps: { memoryFactory: () => Memory; recallTraceStore?: RecallTraceStore },
): Promise<CallToolResult> {
  const parsed = INPUT_SCHEMA.parse(args);
  // Gate on scope (prevents anonymous access via stdio) + read the trusted workspace.
  const scope = getScope();
  const workspaceId = scope.workspaceId ?? DEFAULT_WORKSPACE_ID;

  if (deps.recallTraceStore === undefined) {
    return {
      content: [
        {
          type: 'text',
          text: 'Recall tracing is not enabled on this deployment (set THEOMEM_RECALL_TRACE=true to record + explain recalls).',
        },
      ],
      isError: false,
    };
  }

  const rows = await deps.recallTraceStore.getByRecallId(parsed.recallId, workspaceId);
  if (rows.length === 0) {
    return {
      content: [{ type: 'text', text: `No recall trace for recall_id ${parsed.recallId} in this workspace.` }],
      isError: false,
    };
  }
  // Project to the same wire shape as the S2 REST handler (no internal-field leak).
  const drops = rows.map((r) => ({
    memoryId: r.memoryId,
    semantic: r.semantic,
    bm25: r.bm25,
    entity: r.entity,
    composite: r.composite,
    threshold: r.threshold,
    dropReason: r.dropReason,
  }));
  return {
    content: [{ type: 'text', text: JSON.stringify({ recallId: parsed.recallId, drops }) }],
    isError: false,
  };
}
