/**
 * `episodes` tool — input + output schemas, metadata, description (G3-MCP).
 *
 * Exposes the SHIPPED episodic read surface (`ScopedMemory.episodes()`, v0.14.0,
 * SDK + REST) over MCP. A temporal, cursor-paginated, bi-temporal-aware list of
 * the active scope's memories — NOT semantic search (that is `recall`). The
 * dispatch handler routes valid input to `memory.episodes(options)`.
 *
 * @see packages/core/src/domain/episode.ts — EpisodeListOptions / EpisodePage
 * @see ADR D2 (first-class-episodes) — episode list is TEMPORAL, not semantic
 */
import { EPISODE_LIMIT_MAX } from '@usetheo/memory/contract';
import { z } from 'zod';


import { MAX_QUERY_BYTES } from './constants.js';

export const TOOL_NAME = 'episodes' as const;

export const DESCRIPTION =
  'List the active scope memories as a cursor-paginated, chronological episodic log (message-history style). Use to iterate a scope timeline, replay events at a point in time (asOf), or filter by partial text. NOT semantic search — use recall for relevance. Returns items + an optional nextCursor to fetch the following page.';

/**
 * Input shape for `tools/call episodes`. All optional — an empty call returns the
 * newest page of the scope's live memories.
 *
 * `after`/`before` are opaque cursors echoed back from a prior `nextCursor`.
 * D4: `after` and `before` are mutually exclusive (zod `.refine` → -32602).
 * `asOf` is an ISO 8601 datetime; the handler converts it to a Date for the core
 * option (invalid ISO → zod failure → -32602, mirrors REST 422).
 */
export const INPUT_SCHEMA = z
  .object({
    /** Opaque cursor — return the page AFTER this position (in the active order). */
    after: z.string().min(1).optional(),
    /** Opaque cursor — return the page BEFORE this position (in the active order). */
    before: z.string().min(1).optional(),
    /** Page size. Default 50; capped at EPISODE_LIMIT_MAX (200). */
    limit: z.number().int().min(1).max(EPISODE_LIMIT_MAX).optional(),
    /** Temporal order. Default 'desc' (newest-first); 'asc' for chronological replay. */
    order: z.enum(['asc', 'desc']).optional(),
    /** Partial-text filter (ILIKE, literal — NOT semantic). Capped at MAX_QUERY_BYTES. */
    queryText: z.string().min(1).max(MAX_QUERY_BYTES).optional(),
    /** Bi-temporal point-in-time replay (ISO 8601 datetime). */
    asOf: z.string().datetime().optional(),
  })
  .refine((v) => !(v.after !== undefined && v.before !== undefined), {
    message: 'after and before are mutually exclusive',
    path: ['after'],
  });

export type EpisodesInput = z.infer<typeof INPUT_SCHEMA>;

/**
 * Output shape for `tools/call episodes.structuredContent`.
 *
 * LLM-visible subset of `MemoryItem` (mirrors recall's `toWireResult`, minus
 * `score`): drops `hash` (internal dedup), `updatedAt` (==createdAt under ADD-only
 * ADR-0003), `tValid`/`tInvalid` (bi-temporal columns; `asOf` is the query surface,
 * not a row field), `attributedTo` (deferred to v1.2 alongside recall).
 *
 * `nextCursor` is present only when more rows follow — the consumer echoes it as
 * `after` to fetch the next page.
 */
const SCOPE_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string() }),
  z.object({ kind: z.literal('session'), sessionId: z.string(), userId: z.string().optional() }),
  z.object({ kind: z.literal('agent'), agentId: z.string() }),
]);

export const OUTPUT_SCHEMA = z.object({
  items: z.array(
    z.object({
      /** UUID v4 — usable as forget(id) arg. */
      id: z.string(),
      /** The memory text, post-extraction. */
      text: z.string(),
      /** Typed scope (User/Session/Agent) the memory was written under. */
      scope: SCOPE_SCHEMA,
      /** Write timestamp (ISO 8601 string at wire boundary). */
      createdAt: z.string(),
      /** Flat key/value payload set at write time. */
      metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    }),
  ),
  /** Opaque cursor for the next page; omitted when no more rows follow. */
  nextCursor: z.string().optional(),
});

export type EpisodesOutput = z.infer<typeof OUTPUT_SCHEMA>;
