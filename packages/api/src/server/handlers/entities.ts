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
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { attributedPeerOf } from './_attributed-peer.js';
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

interface EntityAccumulator {
  memory_count: number;
  last_seen_at: string;
}


export async function entitiesHandler(c: Context, memory: Memory): Promise<Response> {
  const rawType = c.req.param('type');
  const id = c.req.param('id');

  const typeParse = ScopeTypeSchema.safeParse(rawType);
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }

  const scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), typeParse.data, id);
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
