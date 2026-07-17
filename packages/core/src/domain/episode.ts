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

// Portable base64url codec over UTF-8 bytes — uses ONLY `Uint8Array` (lib.es2015),
// no `Buffer` / `btoa` / `TextEncoder` Node-or-DOM globals. This keeps the domain
// layer platform-agnostic so consumers compiling the public barrel under bare
// `moduleResolution: node16/nodenext/bundler` (no `@types/node`) type-check
// cleanly. (cross-encoder-reranker cycle: reconciles M2-episodes drift surfaced
// by the public-paths EC-9 moduleResolution fixture.)
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_LOOKUP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < B64URL_ALPHABET.length; i++) {
    m[B64URL_ALPHABET[i] as string] = i;
  }
  return m;
})();

function utf8Encode(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    // Combine surrogate pairs into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return out;
}

function utf8Decode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++] ?? 0;
    let code: number;
    if (b0 < 0x80) {
      code = b0;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = ((b0 & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    } else if ((b0 & 0xf0) === 0xe0) {
      code = ((b0 & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    } else {
      code =
        ((b0 & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
    }
    if (code > 0xffff) {
      code -= 0x10000;
      str += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      str += String.fromCharCode(code);
    }
  }
  return str;
}

function base64UrlEncode(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += B64URL_ALPHABET[(n >> 18) & 0x3f];
    out += B64URL_ALPHABET[(n >> 12) & 0x3f];
    out += b1 === undefined ? '' : B64URL_ALPHABET[(n >> 6) & 0x3f];
    out += b2 === undefined ? '' : B64URL_ALPHABET[n & 0x3f];
  }
  return out;
}

function base64UrlDecode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = B64URL_LOOKUP[str[i] as string];
    const c1 = B64URL_LOOKUP[str[i + 1] as string];
    if (c0 === undefined || c1 === undefined) {
      throw new InvalidScope('episode cursor is malformed (not base64url)');
    }
    const c2raw = str[i + 2];
    const c3raw = str[i + 3];
    const n = (c0 << 18) | (c1 << 12) | ((B64URL_LOOKUP[c2raw as string] ?? 0) << 6) | (B64URL_LOOKUP[c3raw as string] ?? 0);
    bytes.push((n >> 16) & 0xff);
    if (c2raw !== undefined && c2raw !== '') bytes.push((n >> 8) & 0xff);
    if (c3raw !== undefined && c3raw !== '') bytes.push(n & 0xff);
  }
  return Uint8Array.from(bytes);
}

/** Encode a `(created_at, id)` position to an opaque cursor (full ms precision). */
export function encodeEpisodeCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}${CURSOR_SEPARATOR}${id}`;
  return base64UrlEncode(utf8Encode(raw));
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
    raw = utf8Decode(base64UrlDecode(cursor));
  } catch (err) {
    if (err instanceof InvalidScope) {
      throw err;
    }
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
