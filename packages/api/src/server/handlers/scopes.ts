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

import type { MemoryItem } from '@usetheo/memory/contract';
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';
import type { Context } from 'hono';
import { z } from 'zod';

import { attributedPeerOf } from './_attributed-peer.js';
import { actingUserId, workspaceBoundMemory } from './_body-parsing.js';

/**
 * M27 T5.1 — surface the stored `attributed_to` (WHO) as a top-level field on each listed
 * memory so the dashboard/gateway can show it directly (it lives in `MemoryItem.metadata`
 * per `_attributed-peer.ts`). `null` when unattributed.
 */
function withAttributedTo(items: readonly MemoryItem[]): readonly (MemoryItem & { attributed_to: string | null })[] {
  return items.map((m) => ({ ...m, attributed_to: attributedPeerOf(m) ?? null }));
}

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
  /**
   * Dashboard pager (2026-07-22) — SQL-level page offset. Previously NOT parsed:
   * the gateway forwarded `offset` and every page silently returned the same
   * first items. Applied at the store (`created_at DESC, id ASC` deterministic
   * order); combines with `category` (store-level) — when `cursor`/`from`/`to`
   * (in-memory filters) are present the offset applies to the FILTERED set.
   */
  offset: z.coerce.number().int().min(0).default(0),
  /**
   * Entity filter (theo-cloud#252) — only memories LINKED to this entity
   * (surface name; normalization + memory_entities join happen at the store).
   * The server-side filter the dashboard's per-entity cascade-forget requires;
   * without it the cascade deleted the first GLOBAL page.
   */
  entity: z.string().min(1).max(512).optional(),
  /**
   * themory-category-filter-server-side T4.1 / ADR D3 — operator-supplied
   * category filter (1-64 chars). Empty string is rejected at the boundary
   * (zod min(1)) per ADR D3; lengths > 64 are rejected per the same ADR.
   * The underlying `LocalScopedMemory.getAll` ALSO normalizes empty-string
   * to undefined (EC-3 defense-in-depth for direct SDK callers).
   */
  category: z.string().min(1).max(64).optional(),
  /**
   * theo-memory-dashboard-full-integration ADR D3 — optional RFC3339
   * created_at range filter. `from` is an inclusive lower bound, `to` an
   * inclusive upper bound. Invalid datetimes are rejected at the boundary
   * (422 INVALID_QUERY). The gateway dashboard's Memories From/To inputs
   * thread through to these params; without server-side support they were a
   * no-op control (dishonest per Inquebrável Rule 3).
   */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function pathParamsToScoped(
  memory: Memory,
  type: Exclude<ScopeType, 'skill'>,
  id: string,
  userId?: string,
): ScopedMemory {
  switch (type) {
    case 'user':
      // M8 F-arch-1: bind the user tier to the auth Principal (userId) when present
      // so a user-Principal can only address its OWN global scope; null (admin) → path id.
      return memory.user(userId ?? id);
    case 'session':
      // M8 (ADR D6): bind the acting user so the scope is (workspace, user, session).
      return memory.session(id, userId);
    case 'agent':
      return memory.agent(id, userId);
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

  // fixes-cycle-1 T1.1 / F-rev-1 absorption (2026-06-03): skill scope listing
  // is exposed ONLY via the SDK Memory.skills(repoId) per CLAUDE.md ADR-0010.
  // Short-circuit BEFORE the legacy dispatch (which used to cast
  // memory.skills(id) as ScopedMemory then call getAll() — a method that does
  // not exist on ScopedSkillMemory; the cast bypassed TypeScript and crashed
  // into 500 at runtime). EC-4 absorption: this branch lands BEFORE any call
  // to memory.skills().
  if (typeParse.data === 'skill') {
    return c.json(
      {
        code: 'SKILL_LISTING_NOT_IMPLEMENTED',
        message:
          'Skill scope listing is not exposed via REST at v0.1.0-alpha. Use the SDK Memory.skills(repoId).recall(...) directly. See README § Skill scope.',
      },
      501,
    );
  }

  const queryParse = QuerySchema.safeParse({
    cursor: c.req.query('cursor'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
    entity: c.req.query('entity'),
    category: c.req.query('category'),
    from: c.req.query('from'),
    to: c.req.query('to'),
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
  const { cursor: rawCursor, limit, offset, entity, category, from, to } = queryParse.data;

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

  // multi-tenant-workspace-isolation T3.1: list ONLY the Principal's workspace (ADR D3).
  const scoped = pathParamsToScoped(workspaceBoundMemory(c, memory), typeParse.data, id, actingUserId(c));

  // Dashboard pager fast path (2026-07-22): no cursor and no in-memory date
  // filters → REAL SQL pagination (store-level offset + limit) and the true
  // scope total. Fixes both live defects: `offset` silently ignored end-to-end,
  // AND the 100-row getAll cap that made items 101+ unreachable even via cursor.
  const hasInMemoryFilters = rawCursor !== undefined || from !== undefined || to !== undefined;
  if (!hasInMemoryFilters) {
    // limit+1 probe: exact hasMore without a second query (and a defensive
    // slice so a store over-returning beyond topK never leaks past the limit).
    const raw = await scoped.getAll({
      topK: limit + 1,
      offset,
      ...(entity !== undefined ? { entity } : {}),
      ...(category !== undefined ? { category } : {}),
    });
    const page = raw.slice(0, limit);
    const hasMore = raw.length > limit;
    // Entity-filtered requests omit `total` — scoped.count() is scope-wide and
    // would misreport the filtered set (the cascade pages via hasMore instead).
    const total =
      entity === undefined && typeof scoped.count === 'function' ? await scoped.count() : undefined;
    const nextCursor =
      hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : undefined;
    // Fail-closed echo (incident 2026-07-23): the applied entity filter is
    // ECHOED so consumers can verify it was honored — a provider that ignores
    // unknown query keys returns no echo, and a cascade-delete client MUST
    // abort rather than treat the unfiltered scope as the entity's memories.
    return c.json(
      {
        items: withAttributedTo(page),
        nextCursor,
        ...(total !== undefined ? { total } : {}),
        ...(entity !== undefined ? { entity } : {}),
      },
      200,
    );
  }

  // Legacy path — cursor / date-range filters applied in-memory over the getAll
  // page (pre-existing O(scope≤topK) honesty note); `offset` slices the FILTERED set.
  // themory-category-filter-server-side T4.1 — thread category into getAll
  // when supplied. zod min(1) already rejected empty string; LocalScopedMemory.getAll
  // performs EC-3 defense-in-depth normalization for direct SDK callers.
  const all = await scoped.getAll({
    ...(entity !== undefined ? { entity } : {}),
    ...(category !== undefined ? { category } : {}),
  });
  let filtered: readonly MemoryItem[] = all;
  // ADR D3 — created_at range filter (inclusive bounds). Applied in-memory,
  // consistent with the existing cursor filter (same O(scope) honesty note).
  if (from !== undefined || to !== undefined) {
    const fromTs = from !== undefined ? new Date(from).getTime() : -Infinity;
    const toTs = to !== undefined ? new Date(to).getTime() : Infinity;
    filtered = filtered.filter((m) => {
      const ts = m.createdAt.getTime();
      return ts >= fromTs && ts <= toTs;
    });
  }
  if (cursor !== null) {
    // F-arch-1/F-xval-1 fix: compose the cursor predicate onto the ALREADY
    // date-filtered set (`filtered`), NOT the raw `all`. Reading `all` here
    // silently dropped the from/to filter on every paginated continuation.
    const cutoff = new Date(cursor.lastCreatedAt).getTime();
    filtered = filtered.filter((m) => {
      const ts = m.createdAt.getTime();
      return ts < cutoff || (ts === cutoff && m.id < cursor.lastId);
    });
  }

  const page = filtered.slice(offset, offset + limit);
  const hasMore = filtered.length > offset + limit;
  const nextCursor = hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!) : undefined;

  return c.json({ items: withAttributedTo(page), nextCursor, ...(entity !== undefined ? { entity } : {}) }, 200);
}
