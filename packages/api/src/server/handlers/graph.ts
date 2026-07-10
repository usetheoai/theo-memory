/**
 * GET /v1/scopes/:type/:id/graph — subject-scoped `{nodes, edges}` graph.
 *
 * entity-relation-extraction-slice2 T3.1 (ADR D4). Composes the NODES half from
 * `MemoryEntityStore.list` (reusing the entities aggregation) with the EDGES half
 * from `MemoryGraphStore.listEdges`. D6: when the graph store is absent, `edges`
 * is `[]` (an empty-edges graph is still a valid graph — Strangler-Fig parity
 * with the entities handler's attributed fallback). NO graph DB — two Postgres
 * tables + JOINs (ADR D2).
 *
 * SCOPE = SUBJECT (same cross-tenant-leak rationale as metrics.ts / entities.ts).
 *
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md § T3.1
 */
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import type {
  Filters,
  MemoryEntityStore,
  MemoryGraphStore,
  Principal,
} from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

const SCOPE_TYPES = ['user', 'session', 'agent'] as const;
const ScopeTypeSchema = z.enum(SCOPE_TYPES);
type ScopeType = (typeof SCOPE_TYPES)[number];

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

export async function graphHandler(
  c: Context,
  memoryEntityStore?: MemoryEntityStore,
  memoryGraphStore?: MemoryGraphStore,
): Promise<Response> {
  const rawType = c.req.param('type');
  const id = c.req.param('id');

  const typeParse = ScopeTypeSchema.safeParse(rawType);
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }

  const principal = c.get('principal') as Principal | undefined;
  const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const filters = filtersFor(typeParse.data, id);

  // NODES — real entities when the read port is wired; empty otherwise (the
  // attributed fallback lives on the dedicated /entities route, not here).
  const nodeSummaries =
    memoryEntityStore !== undefined ? await memoryEntityStore.list({ workspaceId, filters }) : [];
  const nodes = nodeSummaries.map((s) => ({
    id: s.name,
    scope_type: typeParse.data,
    memory_count: s.memoryCount,
    last_seen_at: s.lastSeenAt,
  }));

  // EDGES — D6: empty when the graph store is absent. M1: active edges only by
  // default; `?includeSuperseded=true` surfaces invalidated edges (audit view).
  const includeSuperseded = c.req.query('includeSuperseded') === 'true';
  const edgeSummaries =
    memoryGraphStore !== undefined
      ? await memoryGraphStore.listEdges({ workspaceId, filters, includeSuperseded })
      : [];
  const edges = edgeSummaries.map((e) => ({
    source: e.source,
    relation: e.relation,
    target: e.target,
    memory_count: e.memoryCount,
    // M1 — active vs superseded, so the graph view can distinguish them.
    active: e.active,
  }));

  return c.json({ nodes, edges }, 200);
}
