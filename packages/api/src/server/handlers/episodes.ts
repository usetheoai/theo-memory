/**
 * GET /v1/scopes/:type/:id/episodes — first-class episodic / message-log read
 * surface (M2 / gap G3).
 *
 * SCOPE = SUBJECT (same boundary as scopes/entities/metrics). Lists the scope's
 * memories as a cursor-paginated, bi-temporal-aware TEMPORAL log — ordered by
 * `(created_at, id)`, `after`/`before` cursor, `order`, optional `asOf`
 * bi-temporal replay, optional literal `q` text filter. NOT semantic search.
 *
 * Validation (ADR D6 + EC-4): malformed query (bad limit / both after+before /
 * invalid asOf) → 422, consistent with the 4-verb `asOf`→422 precedent (the
 * older scopes-memories endpoint predates this and uses 400 for cursors; the
 * episode surface deliberately uses 422 for ALL query-validation failures). A
 * foreign/empty scope yields `200 { items: [] }` — a list has no single resource
 * to 404, and workspace isolation means a foreign scope simply has no rows (no
 * existence leak).
 *
 */
import type { EpisodeListOptions, Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { workspaceBoundMemory } from './_body-parsing.js';

const SCOPE_TYPES = ['user', 'session', 'agent'] as const;
const ScopeTypeSchema = z.enum(SCOPE_TYPES);
type ScopeType = (typeof SCOPE_TYPES)[number];

const QuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    asOf: z.string().min(1).optional(),
    q: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // EC-4: after + before together is ambiguous.
    if (val.after !== undefined && val.before !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at most one of `after` or `before`.',
      });
    }
  });

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

export async function episodesHandler(c: Context, memory: Memory): Promise<Response> {
  const rawType = c.req.param('type');
  const id = c.req.param('id');

  const typeParse = ScopeTypeSchema.safeParse(rawType);
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }

  const queryParse = QuerySchema.safeParse(c.req.query());
  if (!queryParse.success) {
    return c.json(
      { code: 'INVALID_QUERY', message: queryParse.error.issues[0]?.message ?? 'Query invalid' },
      422,
    );
  }
  const q = queryParse.data;

  // asOf boundary validation (mirrors recall): invalid Date → 422, no query runs.
  let asOf: Date | undefined;
  if (q.asOf !== undefined) {
    asOf = new Date(q.asOf);
    if (Number.isNaN(asOf.getTime())) {
      return c.json({ code: 'INVALID_QUERY', message: 'asOf must be a valid date.' }, 422);
    }
  }

  const options: EpisodeListOptions = {
    ...(q.after !== undefined ? { after: q.after } : {}),
    ...(q.before !== undefined ? { before: q.before } : {}),
    ...(q.limit !== undefined ? { limit: q.limit } : {}),
    ...(q.order !== undefined ? { order: q.order } : {}),
    ...(asOf !== undefined ? { asOf } : {}),
    ...(q.q !== undefined ? { queryText: q.q } : {}),
  };

  const scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), typeParse.data, id);
  const page = await scoped.episodes(options);

  const items = page.items.map((m) => ({
    id: m.id,
    text: m.text,
    scope_type: typeParse.data,
    created_at: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
    metadata: m.metadata,
  }));

  return c.json(
    page.nextCursor !== undefined ? { items, nextCursor: page.nextCursor } : { items },
    200,
  );
}
