/**
 * Episodic / message-log read surface — types + pure cursor helpers (M2 / gap G3).
 *
 * The episode tier is a TEMPORAL projection of the existing `memories` substrate:
 * a cursor-paginated, bi-temporal-aware list of a scope's memories in
 * chronological order. It is NOT a new storage engine and NOT semantic search —
 * semantic recall stays in `recall()`. The episode boundary is the Session tier
 * (`session_id`), generalizing to user/agent tiers as the temporal projection of
 * whatever scope is addressed.
 *
 * Cursor model: `(created_at, id)` composite, encoded opaque (base64url of
 * `<iso-ms>|<id>`). `id` (UUID) is the deterministic tie-break for rows sharing a
 * millisecond timestamp — the same comparator the SQL `ORDER BY created_at, id`
 * uses. We carry no monotonic sequence column; `(created_at, id)` is sufficient
 * for v1 (a `sequence_id` column is a documented follow-up).
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T1.1 + ADRs D1/D2
 */
import { InvalidScope } from './errors.js';
import type { MemoryItem } from './memory-item.js';

/** Default page size when `EpisodeListOptions.limit` is omitted. */
export const EPISODE_LIMIT_DEFAULT = 50;

/** Hard upper bound on a single episode page (DOS guard). */
export const EPISODE_LIMIT_MAX = 200;

/**
 * Options for the episodic read surface. All optional; an empty call lists the
 * newest page of the scope's live memories.
 *
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T1.1
 */
export interface EpisodeListOptions {
  /** Opaque cursor — return the page AFTER this position (in the active order). */
  readonly after?: string;
  /** Opaque cursor — return the page BEFORE this position (in the active order). */
  readonly before?: string;
  /** Page size. Default {@link EPISODE_LIMIT_DEFAULT}; capped at {@link EPISODE_LIMIT_MAX}. */
  readonly limit?: number;
  /** Temporal order. Default `desc` (newest-first feed); `asc` for chronological replay. */
  readonly order?: 'asc' | 'desc';
  /**
   * Bi-temporal point-in-time replay. When set, the list returns the memories
   * valid at the instant via the ADR-0011 null-safe predicate
   * `(t_valid IS NULL OR t_valid <= asOf) AND (t_invalid IS NULL OR t_invalid > asOf)`.
   * Mutually exclusive with the default soft-delete exclusion: a row soft-deleted
   * AFTER `asOf` still appears at `asOf`.
   */
  readonly asOf?: Date;
  /** Optional partial-text filter (ILIKE, NOT semantic). LIKE metacharacters are escaped literally. */
  readonly queryText?: string;
}

/**
 * One page of the episodic read surface. `nextCursor` is present only when more
 * rows follow in the active order (forward pagination). `prevCursor` is reserved
 * for a future backward-pagination follow-up — v1 computes `nextCursor` only.
 */
export interface EpisodePage {
  readonly items: readonly MemoryItem[];
  readonly nextCursor?: string;
  readonly prevCursor?: string;
}

/** Decoded cursor position. */
export interface EpisodeCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const CURSOR_SEPARATOR = '|';

/** Resolve the effective page size: default when undefined, capped at the max. */
export function resolveEpisodeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return EPISODE_LIMIT_DEFAULT;
  }
  return Math.min(limit, EPISODE_LIMIT_MAX);
}

/** Encode a `(created_at, id)` position to an opaque cursor (full ms precision). */
export function encodeEpisodeCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}${CURSOR_SEPARATOR}${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor back to `(created_at, id)`.
 *
 * @throws InvalidScope — malformed base64, missing id component, or a date
 *   component that does not parse to a valid Date (→ REST 422, no SQL executed).
 */
export function decodeEpisodeCursor(cursor: string): EpisodeCursor {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new InvalidScope('episode cursor is malformed (not base64url)');
  }
  const sepIndex = raw.indexOf(CURSOR_SEPARATOR);
  if (sepIndex < 0) {
    throw new InvalidScope('episode cursor is malformed (missing id component)');
  }
  const isoPart = raw.slice(0, sepIndex);
  const id = raw.slice(sepIndex + 1);
  if (id.length === 0) {
    throw new InvalidScope('episode cursor is malformed (empty id component)');
  }
  const createdAt = new Date(isoPart);
  if (Number.isNaN(createdAt.getTime())) {
    throw new InvalidScope('episode cursor is malformed (invalid date component)');
  }
  return { createdAt, id };
}

/**
 * Escape LIKE/ILIKE metacharacters (`%`, `_`, `\`) so a `queryText` is matched
 * literally rather than as a wildcard pattern. Pair with `ILIKE ... ESCAPE '\'`.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
