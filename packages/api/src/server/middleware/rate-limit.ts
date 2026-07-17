/**
 * In-memory sliding-window rate limiter per ADR D2 of
 * red-team-full-system-fixes-cycle-1.
 *
 * Single-process; resets on restart. Configurable via env:
 * - THEMORY_RATE_LIMIT_WRITES (default 30/min)
 * - THEMORY_RATE_LIMIT_READS  (default 100/min)
 *
 * EC-1: IPv6 key normalization — strips `::ffff:` prefix so
 * `::ffff:127.0.0.1` and `127.0.0.1` map to the same bucket.
 */
import { createHash } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

const DEFAULT_WRITES = 30;
const DEFAULT_READS = 100;
const WINDOW_MS = 60_000; // 1 minute

function parseEnvLimit(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    process.stderr.write(
      `[themory] WARN: ${envKey}=${raw} is invalid; falling back to ${String(fallback)}\n`,
    );
    return fallback;
  }
  return n;
}

/** EC-1: normalize IPv6-mapped IPv4 addresses to raw IPv4. */
function normalizeIp(raw: string): string {
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

interface BucketEntry {
  timestamps: number[];
}

// T3.4 — cap to prevent unbounded Map growth under high cardinality traffic.
const MAX_BUCKETS = 100_000;

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs = WINDOW_MS) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Returns `{ allowed, retryAfterSec }`. */
  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // T3.4 — evict stale buckets when Map exceeds cap
    if (this.buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of this.buckets) {
        if (v.timestamps.every((t) => t <= cutoff)) this.buckets.delete(k);
        if (this.buckets.size < MAX_BUCKETS * 0.9) break;
      }
    }

    let entry = this.buckets.get(key);
    if (entry === undefined) {
      entry = { timestamps: [] };
      this.buckets.set(key, entry);
    }
    // Prune expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length >= this.limit) {
      const oldest = entry.timestamps[0] ?? now;
      const retryAfterSec = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    entry.timestamps.push(now);
    return { allowed: true, retryAfterSec: 0 };
  }
}

function extractKey(c: { req: { header: (name: string) => string | undefined; raw: Request } }): string {
  // EC-3: per-token isolation when auth is active
  // T1.3 — hash the token before storing as bucket key (CWE-200, ADR D4).
  const authHeader = c.req.header('authorization');
  if (authHeader !== undefined && authHeader.length > 0) {
    const hash = createHash('sha256').update(authHeader).digest('hex');
    return `bearer:${hash}`;
  }
  // Fallback to IP
  const forwarded = c.req.header('x-real-ip');
  if (forwarded !== undefined && forwarded.length > 0) {
    return `ip:${normalizeIp(forwarded)}`;
  }
  // Hono on Node.js: remoteAddress is on the underlying socket
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const addr = (c.req.raw as any)?.[Symbol.for('hono/conninfo')]?.remote?.address as string | undefined;
  if (addr !== undefined) return `ip:${normalizeIp(addr)}`;
  return 'ip:unknown';
}

export function rateLimitMiddleware(kind: 'write' | 'read'): MiddlewareHandler {
  const limit = kind === 'write'
    ? parseEnvLimit('THEMORY_RATE_LIMIT_WRITES', DEFAULT_WRITES)
    : parseEnvLimit('THEMORY_RATE_LIMIT_READS', DEFAULT_READS);
  const limiter = new SlidingWindowRateLimiter(limit);

  return async (c, next) => {
    const key = extractKey(c);
    const { allowed, retryAfterSec } = limiter.check(key);
    if (!allowed) {
      return c.json(
        { code: 'RATE_LIMITED', message: `Too many requests. Retry after ${String(retryAfterSec)}s.` },
        429,
        { 'Retry-After': String(retryAfterSec) },
      );
    }
    await next();
    return undefined;
  };
}

// Re-export for testing
export { normalizeIp, parseEnvLimit };
