/**
 * GET /v1/scopes/:type/:id/messages/search — hybrid search over the raw messages the scope can
 * see (ADR-0031): Okapi BM25 fused with embedding similarity by Reciprocal Rank Fusion. Separate
 * from recall; reaches a turn extraction kept no fact of, also when the query is a paraphrase.
 *
 * Same scope boundary as the episodes and listing endpoints: the user tier binds to the acting
 * Principal, session and agent tiers carry its userId. Query validation failures answer 422; a
 * foreign or empty scope answers `200 { items: [] }` so existence never leaks across tenants. A
 * runtime created with `messageLog: false` answers 501 through the error mapper.
 */
import type { LoggedMessage, Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { actingUserId, workspaceBoundMemory } from './_body-parsing.js';

const ScopeTypeSchema = z.enum(['user', 'session', 'agent']);

export const MessageSearchQuerySchema = z
  .object({
    q: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    asOf: z.string().min(1).optional(),
    /** Turns to return on each side of every result, 0..5 (ADR-0031). */
    surroundingTurns: z.coerce.number().int().min(0).max(5).optional(),
  })
  .strict();

const LoggedMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  observed_at: z.string().nullable(),
  logged_at: z.string(),
});

/** One search result as the endpoint returns it; `surrounding` only when `surroundingTurns` was asked. */
export const MessageSearchItemSchema = LoggedMessageSchema.extend({
  score: z.number(),
  surrounding: z.object({ before: z.array(LoggedMessageSchema), after: z.array(LoggedMessageSchema) }).optional(),
});

function toLoggedJson(m: LoggedMessage): z.infer<typeof LoggedMessageSchema> {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    observed_at: m.observedAt === null ? null : m.observedAt.toISOString(),
    logged_at: m.loggedAt.toISOString(),
  };
}

function scopedFor(memory: Memory, type: z.infer<typeof ScopeTypeSchema>, id: string, userId?: string): ScopedMemory {
  switch (type) {
    case 'user':
      return memory.user(userId ?? id);
    case 'session':
      return memory.session(id, userId);
    case 'agent':
      return memory.agent(id, userId);
  }
}

export async function messagesSearchHandler(c: Context, memory: Memory): Promise<Response> {
  const typeParse = ScopeTypeSchema.safeParse(c.req.param('type'));
  const id = c.req.param('id');
  if (!typeParse.success || id === undefined || id.length === 0) return c.notFound();

  const queryParse = MessageSearchQuerySchema.safeParse(c.req.query());
  if (!queryParse.success) {
    return c.json({ code: 'INVALID_QUERY', message: queryParse.error.issues[0]?.message ?? 'Query invalid' }, 422);
  }
  const { q, limit, asOf: rawAsOf, surroundingTurns } = queryParse.data;
  const asOf = rawAsOf === undefined ? undefined : new Date(rawAsOf);
  if (asOf !== undefined && Number.isNaN(asOf.getTime())) {
    return c.json({ code: 'INVALID_QUERY', message: 'asOf must be a valid date.' }, 422);
  }

  const scoped = scopedFor(workspaceBoundMemory(c, memory), typeParse.data, id, actingUserId(c));
  const found = await scoped.searchMessages(q, {
    ...(limit !== undefined ? { limit } : {}),
    ...(asOf !== undefined ? { asOf } : {}),
    ...(surroundingTurns !== undefined ? { surroundingTurns } : {}),
  });
  const items: z.infer<typeof MessageSearchItemSchema>[] = found.map((m) => ({
    ...toLoggedJson(m),
    score: m.score,
    ...(m.surrounding !== undefined
      ? { surrounding: { before: m.surrounding.before.map(toLoggedJson), after: m.surrounding.after.map(toLoggedJson) } }
      : {}),
  }));
  return c.json({ items }, 200);
}
