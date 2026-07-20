/**
 * GET /v1/recall-traces/:recallId — the accountable-forgetting READ surface (S2).
 *
 * Returns the candidates a recall DROPPED (semantic/bm25/entity/composite/threshold
 * + drop-reason), keyed by the server-minted `recall_id` that `POST /v1/recall`
 * returned in its envelope. Read-only.
 *
 * SECURITY (S2 D3 / CWE-441): the workspace comes from the resolved Principal,
 * NEVER from the path/body; `getByRecallId` filters by it at the store boundary.
 * A `recall_id` minted under another workspace — or one that never existed — both
 * return 404 (no oracle distinguishing them, so a recall_id cannot be enumerated
 * across tenants). Fail-closed.
 *
 * @see plan explainable-recall-read § Phase 4 / T4.1
 */
import type { RecallTraceStore } from '@usetheo/memory/contract';
import type { Context } from 'hono';

import { getPrincipal } from '../auth/middleware.js';

export async function recallTracesHandler(c: Context, store: RecallTraceStore): Promise<Response> {
  const recallId = c.req.param('recallId');
  const workspaceId = getPrincipal(c).workspaceId;
  const drops = await store.getByRecallId(recallId, workspaceId);
  if (drops.length === 0) {
    return c.json(
      { code: 'NOT_FOUND', message: 'No recall trace for this recall_id in this workspace' },
      404,
    );
  }
  return c.json({ recallId, drops }, 200);
}
