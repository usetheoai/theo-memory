/**
 * GET /v1/scopes/:type/:id/memories — paginated listing.
 *
 * - EC-13: scope type enum case-sensitive {user,session,agent,skill}
 * - EC-14: limit cap at 100 (DOS protection)
 * - EC-15: cursor two-layer validation (base64 decode → JSON parse → zod
 *   shape). Per SEPA pre-RED iter 4 MAJOR — `Buffer.from(garbage, 'base64')`
 *   does NOT throw; relying on decode alone leaks malformed cursors through.
 *
 * Pagination strategy: `getAll` returns all items in scope; handler filters
 * in-memory by `(createdAt, id)` tuple < `cursor.{lastCreatedAt, lastId}` then
 * slices to `limit`. **Honesty note (per Acceptance Criteria — SEPA pre-RED
 * iter 4 MAJOR Option A bounded):** this is O(scope_size) per request. A
 * dedicated cycle MAY add `GetAllOptions.cursor` to push the predicate into
 * the store; the ADR for that change is out-of-scope for T1.3.
 */
import { Buffer } from 'node:buffer';

import type { Context } from 'hono';
import { z } from 'zod';

import type { MemoryItem } from '../../core/memory-item.js';
import type { Memory, ScopedMemory } from '../../core/memory-store.js';

const SCOPE_TYPES = ['user', 'session', 'agent', 'skill'] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];

const ScopeTypeSchema = z.enum(SCOPE_TYPES);

const CursorSchema = z.object({
  lastId: z.string().min(1),
  lastCreatedAt: z.string().datetime(),
});

const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function pathParamsToScoped(memory: Memory, type: ScopeType, id: string): ScopedMemory {
  switch (type) {
    case 'user':
      return memory.user(id);
    case 'session':
      return memory.session(id);
    case 'agent':
      return memory.agent(id);
    case 'skill':
      return memory.skills(id) as unknown as ScopedMemory;
  }
}

function decodeCursor(raw: string): z.infer<typeof CursorSchema> | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  const result = CursorSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function encodeCursor(item: MemoryItem): string {
  return Buffer.from(
    JSON.stringify({ lastId: item.id, lastCreatedAt: item.createdAt.toISOString() }),
    'utf-8',
  ).toString('base64');
}

export async function scopesHandler(c: Context, memory: Memory): Promise<Response> {
  const rawType = c.req.param('type');
  const id = c.req.param('id');

  const typeParse = ScopeTypeSchema.safeParse(rawType);
  if (!typeParse.success || id === undefined || id.length === 0) {
    return c.notFound();
  }

  const queryParse = QuerySchema.safeParse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
  });
  if (!queryParse.success) {
    return c.json(
      {
        code: 'INVALID_QUERY',
        message: queryParse.error.issues[0]?.message ?? 'Invalid query string',
      },
      422,
    );
  }
  const { cursor: rawCursor, limit } = queryParse.data;

  let cursor: z.infer<typeof CursorSchema> | null = null;
  if (rawCursor !== undefined) {
    cursor = decodeCursor(rawCursor);
    if (cursor === null) {
      return c.json(
        { code: 'INVALID_CURSOR', message: 'cursor must be base64-encoded JSON with { lastId, lastCreatedAt }' },
        400,
      );
    }
  }

  const scoped = pathParamsToScoped(memory, typeParse.data, id);
  const all = await scoped.getAll();
  let filtered: readonly MemoryItem[] = all;
  if (cursor !== null) {
    const cutoff = new Date(cursor.lastCreatedAt).getTime();
    filtered = all.filter((m) => {
      const ts = m.createdAt.getTime();
      return ts < cutoff || (ts === cutoff && m.id < cursor.lastId);
    });
  }

  const page = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const nextCursor = hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : undefined;

  return c.json({ items: page, nextCursor }, 200);
}
