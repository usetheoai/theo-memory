/**
 * `explain_recall` tool — input schema, metadata, description (M4).
 *
 * The MCP twin of the S2 REST `GET /v1/recall-traces/:recallId` — an agent
 * asks WHY a recall dropped candidates, by the `recallId` the recall returned.
 * Workspace-scoped (from the auth-trusted ScopedContext, never the args).
 *
 * @see packages/api/src/server/handlers/recall-traces.ts (S2 REST twin)
 */
import { z } from 'zod';

export const TOOL_NAME = 'explain_recall' as const;

export const DESCRIPTION =
  'Explain why a recall dropped candidates (accountable forgetting). Pass the recall_id ' +
  'returned by a recall; returns each dropped candidate with its score breakdown ' +
  '(semantic/bm25/entity/composite/threshold) and drop reason. Workspace-scoped.';

export const INPUT_SCHEMA = z
  .object({
    recallId: z.string().min(1),
  })
  .strict();

export type ExplainRecallInput = z.infer<typeof INPUT_SCHEMA>;
