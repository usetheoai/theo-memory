/**
 * GET /v1/scopes/:type/:id/entities — subject-scoped entity aggregation.
 *
 * Plan theo-memory-dashboard-full-integration, T2.2 (ADR D2 amendment 2026-06-19).
 *
 * SCOPE = SUBJECT (see metrics.ts for the cross-tenant-leak rationale).
 *
 * "Entities" = the distinct `attributedTo` peers across the subject's active
 * memories — i.e. WHO the agent has learned facts about/from (the v1.1
 * multi-peer attribution column, a REAL populated source). Each entity carries
 * its memory count and the most recent `createdAt` it appears in.
 *
 * Honest scope note: the standalone `entities` table is an entity-boost
 * retrieval store that the current write pipeline does not populate, so a richer
 * NER-style extraction is a separate follow-up. Deriving from `attributedTo`
 * ships REAL data today without fabricating aggregates (Inquebrável Rule 3).
 */
import { DEFAULT_WORKSPACE_ID } from '@usetheo/memory/contract';
import type { Filters, Memory, MemoryEntityStore, Principal, ScopedMemory } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { attributedPeerOf } from './_attributed-peer.js';
import { actingUserId, workspaceBoundMemory } from './_body-parsing.js';

const SCOPE_TYPES = ['user', 'session', 'agent'] as const;
const ScopeTypeSchema = z.enum(SCOPE_TYPES);
type ScopeType = (typeof SCOPE_TYPES)[number];

function pathParamsToScoped(memory: Memory, type: ScopeType, id: string, userId?: string): ScopedMemory {
  switch (type) {
    case 'user':
      // M8 F-arch-1: bind the user tier to the auth Principal (userId) when present
      // so a user-Principal can only address its OWN global scope; null (admin) → path id.
      return memory.user(userId ?? id);
    case 'session':
      return memory.session(id, userId);
    case 'agent':
      return memory.agent(id, userId);
  }
}

interface EntityAccumulator {
  memory_count: number;
  last_seen_at: string;
}


/** Build the Filters for a scope type+id, threading the acting user.
 *
 *  M8 isolation (#118-session): session/agent-tier entities carry BOTH
 *  `session_id`/`agent_id` AND `user_id` (the write path derives them from the
 *  source memory's scope columns). The store's listing predicate is
 *  `COALESCE(user_id,'') = COALESCE($2,'')`, so omitting the user made the
 *  SESSION/AGENT tabs match ZERO rows — the tab rendered "No entities" over a
 *  session with 237 memories and 712 linked entities. The user tier binds to the
 *  Principal when present (a user-Principal can only address its OWN scope). */
function filtersFor(type: ScopeType, id: string, userId?: string): Filters {
  switch (type) {
    case 'user':
      return { user_id: userId ?? id };
    case 'session':
      return { session_id: id, ...(userId !== undefined ? { user_id: userId } : {}) };
    case 'agent':
      return { agent_id: id, ...(userId !== undefined ? { user_id: userId } : {}) };
  }
}

export async function entitiesHandler(
  c: Context,
  memory: Memory,
  memoryEntityStore?: MemoryEntityStore,
): Promise<Response> {
  const rawType = c.req.param('type');
  const id = c.req.param('id');

  const typeParse = ScopeTypeSchema.safeParse(rawType);
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }

  // ADR D4: when the read port is wired, serve REAL entities from the table.
  // The shape stays {entities:[{id, memory_count, last_seen_at}]} (id = entity
  // name, byte-compatible with the attributed_to derivation below). A port
  // rejection propagates → the app onError maps it to 500 (never a masked []).
  if (memoryEntityStore !== undefined) {
    const principal = c.get('principal') as Principal | undefined;
    const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const summaries = await memoryEntityStore.list({
      workspaceId,
      filters: filtersFor(typeParse.data, id, actingUserId(c)),
    });
    const entities = summaries.map((s) => ({
      id: s.name,
      scope_type: typeParse.data,
      memory_count: s.memoryCount,
      last_seen_at: s.lastSeenAt,
      // M2 — on-demand active-relations digest (evolves with M1 supersession).
      summary: s.summary,
    }));
    return c.json({ entities }, 200);
  }

  const scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), typeParse.data, id, actingUserId(c));
  const items = await scoped.getAll();

  const acc = new Map<string, EntityAccumulator>();
  for (const m of items) {
    const name = attributedPeerOf(m);
    if (name === undefined) continue;
    const createdAt = m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt);
    const existing = acc.get(name);
    if (existing === undefined) {
      acc.set(name, { memory_count: 1, last_seen_at: createdAt });
    } else {
      existing.memory_count += 1;
      if (createdAt > existing.last_seen_at) existing.last_seen_at = createdAt;
    }
  }

  const entities = Array.from(acc.entries())
    .map(([name, v]) => ({
      id: name,
      scope_type: typeParse.data,
      memory_count: v.memory_count,
      last_seen_at: v.last_seen_at,
    }))
    .sort((a, b) => b.memory_count - a.memory_count);

  return c.json({ entities }, 200);
}
