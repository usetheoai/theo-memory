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
 *  - `entity_count`       = distinct non-null `attributedTo` peers
 *  - `add_events`         = active rows (each surviving row is one add)
 *  - `retrieval_api_usage`= 0 — no persisted source (recall calls are not
 *                           logged); a recall counter is a separate follow-up.
 */
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { workspaceBoundMemory } from './_body-parsing.js';

const SCOPE_TYPES = ['user', 'session', 'agent'] as const;
const ScopeTypeSchema = z.enum(SCOPE_TYPES);
type ScopeType = (typeof SCOPE_TYPES)[number];

function pathParamsToScoped(memory: Memory, type: ScopeType, id: string): ScopedMemory {
  switch (type) {
    case 'user':
      return memory.user(id);
    case 'session':
      return memory.session(id);
    case 'agent':
      return memory.agent(id);
  }
}

/**
 * Read a memory's attributed peer. `getAll()` projects `attributed_to` into
 * `metadata` (not the top-level `attributedTo` field), so we read metadata as
 * the source of truth with the top-level field as a fallback (stubs/future).
 * Returns undefined for null/empty/missing. Shared shape with entities.ts.
 */
function peerOf(m: { attributedTo?: string; metadata?: Readonly<Record<string, unknown>> }): string | undefined {
  if (typeof m.attributedTo === 'string' && m.attributedTo !== '') return m.attributedTo;
  const fromMeta = m.metadata?.['attributed_to'];
  if (typeof fromMeta === 'string' && fromMeta !== '') return fromMeta;
  return undefined;
}

export async function metricsHandler(c: Context, memory: Memory): Promise<Response> {
  const rawType = c.req.param('type');
  const id = c.req.param('id');

  const typeParse = ScopeTypeSchema.safeParse(rawType);
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }

  const scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), typeParse.data, id);
  const items = await scoped.getAll();

  const entities = new Set<string>();
  for (const m of items) {
    const peer = peerOf(m);
    if (peer !== undefined) entities.add(peer);
  }

  return c.json(
    {
      total_memories: items.length,
      entity_count: entities.size,
      add_events: items.length,
      retrieval_api_usage: 0,
    },
    200,
  );
}
