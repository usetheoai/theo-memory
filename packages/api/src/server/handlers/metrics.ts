/**
 * GET /v1/scopes/:type/:id/metrics — subject-scoped memory KPIs.
 *
 * Plan theo-memory-dashboard-full-integration, T2.1 (ADR D2 amendment 2026-06-19).
 *
 * SCOPE = SUBJECT, not workspace. The theo-cloud gateway uses one master key
 * (= one workspace) for ALL customers, isolating by subject-in-path. A
 * workspace-level aggregate would leak cross-customer totals to a single
 * customer; this endpoint therefore mirrors the existing
 * `GET /v1/scopes/:type/:id/memories` subject scoping.
 *
 * Counts are derived from the scope's active rows (`getAll()`), consistent with
 * the O(scope) honesty note on the scope listing. All numbers are REAL — none
 * fabricated (Inquebrável Rule 3):
 *
 *  - `total_memories`     = active rows in scope
 *  - `entity_count`       = distinct graph entities from `MemoryEntityStore.list()`
 *                           (the SAME source the Entities/Graph tab reads — single
 *                           source of truth, EG-3) when the entity read port is
 *                           wired; distinct non-null `attributedTo` peers as the
 *                           honest no-store fallback (in-memory adapter / tests).
 *  - `add_events`         = active rows (each surviving row is one add)
 *  - `retrieval_api_usage`= cumulative `recall()` calls for the scope, read from
 *                           the persisted counter (themory-scoped-forget-and-retrieval-counter
 *                           T2.4). 0 when no counter store is wired (in-memory
 *                           adapter / tests) — honest fallback, never fabricated.
 */
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import type {
  Filters,
  Memory,
  MemoryEntityStore,
  Principal,
  ScopedMemory,
  UsageCounterStore,
} from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { attributedPeerOf } from './_attributed-peer.js';
import { principalUserId, workspaceBoundMemory } from './_body-parsing.js';

const SCOPE_TYPES = ['user', 'session', 'agent'] as const;
const ScopeTypeSchema = z.enum(SCOPE_TYPES);
type ScopeType = (typeof SCOPE_TYPES)[number];

function pathParamsToScoped(memory: Memory, type: ScopeType, id: string, userId?: string): ScopedMemory {
  switch (type) {
    case 'user':
      return memory.user(id);
    case 'session':
      return memory.session(id, userId);
    case 'agent':
      return memory.agent(id, userId);
  }
}

/** Build the single-tier Filters for a scope type+id (others undefined). */
function filtersFor(type: ScopeType, id: string): Filters {
  switch (type) {
    case 'user':
      return { user_id: id };
    case 'session':
      return { session_id: id };
    case 'agent':
      return { agent_id: id };
  }
}

export async function metricsHandler(
  c: Context,
  memory: Memory,
  usageCounterStore?: UsageCounterStore,
  memoryEntityStore?: MemoryEntityStore,
): Promise<Response> {
  const rawType = c.req.param('type');
  const id = c.req.param('id');

  const typeParse = ScopeTypeSchema.safeParse(rawType);
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }

  const scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), typeParse.data, id, principalUserId(c));
  const items = await scoped.getAll();

  // Principal-derived workspace (mirrors the entities handler). One resolution,
  // reused by both the entity-store count and the recall counter below.
  const principal = c.get('principal') as Principal | undefined;
  const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;

  // entity_count: when the entity read port is wired, count DISTINCT graph
  // entities from the SAME source the Entities/Graph tab uses
  // (`MemoryEntityStore.list()`) — single source of truth, so the Overview card
  // cannot diverge from the Entities tab (EG-3). When NO store is wired
  // (in-memory adapter / tests), fall back to distinct non-null `attributedTo`
  // peers — honest, byte-unchanged from before; the entities handler uses the
  // identical fallback, so the two stay consistent on that path too.
  let entityCount: number;
  if (memoryEntityStore !== undefined) {
    const summaries = await memoryEntityStore.list({
      workspaceId,
      filters: filtersFor(typeParse.data, id),
    });
    entityCount = summaries.length;
  } else {
    const peers = new Set<string>();
    for (const m of items) {
      const peer = attributedPeerOf(m);
      if (peer !== undefined) peers.add(peer);
    }
    entityCount = peers.size;
  }

  // retrieval_api_usage: read the persisted per-scope recall counter when wired.
  // EC-3 — the read key must match what recall() incremented: same workspace_id
  // (from the principal, mirroring the entities handler) + same single-tier filter.
  // 0-fallback when no counter store is injected (honest, no regression).
  let retrievalApiUsage = 0;
  if (usageCounterStore !== undefined) {
    retrievalApiUsage = await usageCounterStore.getRecallCount({
      workspace_id: workspaceId,
      ...filtersFor(typeParse.data, id),
    });
  }

  return c.json(
    {
      total_memories: items.length,
      entity_count: entityCount,
      add_events: items.length,
      retrieval_api_usage: retrievalApiUsage,
    },
    200,
  );
}
