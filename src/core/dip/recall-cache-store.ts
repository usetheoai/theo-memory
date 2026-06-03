/**
 * RecallCacheStore DIP — 13th dependency-inversion contract for semantic
 * recall result caching (Roadmap Item 19 / v1.5).
 *
 * Caches the result of `Memory.recall(query)` keyed by `(scope, queryEmbedding)`
 * so near-duplicate queries within a scope skip the 9-step search pipeline.
 *
 * **4 methods total** (within ADR-0008 method-count cap):
 *   - `get`             — semantic lookup with cosine ≥ threshold + non-expired
 *   - `set`             — write-through populate post-miss
 *   - `invalidateScope` — write-triggered correctness gate (Item 19 AC#3)
 *   - `clearExpired`    — TTL-driven housekeeping sweep
 *
 * **Design decisions** (locked by blueprint v1.0 — see § ADRs of plan v1.1):
 *   - Default similarity threshold: cosine ≥ 0.8 — validated by independent
 *     convergence of embedchain (`similarity_threshold=0.8`) and REDACTED
 *     (`distance_threshold=0.2 ≈ similarity 0.8` via algebra `1 - distance`).
 *     REDACTED's known calibration failure at distance 0.3 (similarity 0.7)
 *     confirms 0.7 is too strict for OpenAI-class embeddings.
 *   - TTL gated by scope-tier: user 24h / agent 1h / session 10min / repo 1h.
 *     `repo` is the skill-scope tier per ADR-0010 (the 4th tier added by v0.6;
 *     surfaced via `Memory.skills(repoId)`).
 *   - LRU eviction at max_size=1000 per scope — empirical consumer-pairing
 *     from embedchain `gptcache_data_manager(max_size=1000, eviction="LRU")`.
 *   - Cache key = `(scope_key, query_embedding)`. Does NOT include `asOf`,
 *     `attributedTo`, or `topK`; recall paths with those options BYPASS the
 *     cache entirely per ADR D8 (v1.5.0 cache applicability boundary).
 *
 * **DIP boundary discipline** (architecture.md § 3):
 *   This module lives in `src/core/` — ZERO I/O, ZERO imports from
 *   `src/local/` or `src/cloud/`. The default impl ships at
 *   `src/local/recall-cache/pgvector-recall-cache-store.ts` (T1.1).
 *
 * @see Plan semantic-recall-cache-v1-5 § ADR D1 (4-method DIP)
 * @see Plan semantic-recall-cache-v1-5 § ADR D2 (threshold default 0.8)
 * @see Plan semantic-recall-cache-v1-5 § ADR D3 (4 scope-tier TTL spread)
 * @see Plan semantic-recall-cache-v1-5 § ADR D8 (cache applicability boundary)
 * @see Blueprint semantic-recall-cache § Q4 + Q7 (threshold convergence)
 * @see ADR-0008 (DIP method-count cap)
 * @see ADR-0010 (RepoScope = 4th tier surfaced via Memory.skills(repoId))
 */
import { InvalidCacheConfig } from '../errors.js';
import type { MemoryItemWithScore } from '../memory-item.js';
import type { Scope } from '../scope.js';

/**
 * Result of a successful cache hit. Carries metadata enabling consumers
 * (or downstream observability) to inspect WHY the hit was served — honoring
 * the project-level auditability principle in CLAUDE.md.
 */
export interface CachedResult {
  /** The previously-cached recall results, returned as-is on hit. */
  readonly results: readonly MemoryItemWithScore[];
  /** Timestamp of the original cache populate (the `set()` call). */
  readonly cachedAt: Date;
  /** Observed cosine similarity of the hitting query against the cached one. */
  readonly similarity: number;
}

/**
 * TTL configuration per scope-tier. ALL four tiers are required so that
 * `Memory.skills(repoId).recall(...)` and the standard 3-tier paths share a
 * common, exhaustive contract. Per blueprint D3 defaults:
 *   user    → 86400 (24h)   — long-lived account context
 *   agent   → 3600  (1h)    — mid-lived skill / persona scope
 *   session → 600   (10min) — short-lived conversation / run
 *   repo    → 3600  (1h)    — skill consolidation mid-frequency (ADR-0010)
 */
export interface ScopeTierTtlConfig {
  readonly user: number;
  readonly agent: number;
  readonly session: number;
  readonly repo: number;
}

/**
 * Config consumed by `PgvectorRecallCacheStore` (and any future impl).
 * Validator at {@link validateRecallCacheStoreConfig} enforces invariants
 * BEFORE construction.
 *
 * @see Plan semantic-recall-cache-v1-5 § T0.1 § Deep Dives
 */
export interface RecallCacheStoreConfig {
  /**
   * Cosine similarity threshold for cache hit. Range `[0, 1]`.
   * Default 0.8 (blueprint convergence). 0 hits everything; 1 = exact-only.
   * NaN / Infinity rejected by validator (IEEE 754 NaN-comparison gap absorption).
   */
  readonly threshold?: number;

  /** Per-tier TTL override. If absent, ADR D3 defaults apply. */
  readonly ttlSecondsByScopeTier?: ScopeTierTtlConfig;

  /**
   * Per-scope row cap for LRU eviction. Default 1000 (empirical consumer
   * default per embedchain Q4). Values < 10 cause cache thrashing — README
   * warns against, but validator only enforces `>= 1`.
   */
  readonly maxSizePerScope?: number;
}

/**
 * 13th DIP. Contract for the v1.5 semantic recall cache.
 *
 * Implementations live OUTSIDE `src/core/` per DIP boundary discipline.
 */
export interface RecallCacheStore {
  /**
   * Returns a cached result if a row in the same scope has cosine similarity
   * to `queryEmbedding` ≥ effective threshold AND is non-expired; otherwise
   * `undefined`. PURE READ — no side effects, no eviction.
   */
  get(queryEmbedding: readonly number[], scope: Scope): Promise<CachedResult | undefined>;

  /**
   * Populates the cache for the given `(scope, queryEmbedding)` slot.
   * `ttlSeconds` is the scope-tier TTL resolved by the factory; impl writes
   * `expires_at = NOW() + ttlSeconds * INTERVAL '1 second'`.
   *
   * Capacity-bounded (per `maxSizePerScope`): impl MUST evict oldest row in
   * scope BEFORE inserting when at cap — atomically within a SERIALIZABLE
   * transaction to defend against concurrent-set race (EC-7 absorption).
   */
  set(
    queryEmbedding: readonly number[],
    scope: Scope,
    results: readonly MemoryItemWithScore[],
    ttlSeconds: number,
  ): Promise<void>;

  /**
   * Deletes ALL cache rows for the given scope. Called by `Memory.remember()`,
   * `Memory.forget()`, and `Memory.reflect()` post-success per ADR D3
   * (v1.1 amendment) to honor Item 19 acceptance criterion #3.
   *
   * Returns the number of rows deleted (observability + dogfood evidence).
   */
  invalidateScope(scope: Scope): Promise<number>;

  /**
   * Sweep: deletes rows where `expires_at IS NOT NULL AND expires_at <= NOW()`.
   * Intended for cron-driven housekeeping; not called on hot read path.
   * Returns the number of rows deleted.
   */
  clearExpired(): Promise<number>;
}

/**
 * Default ScopeTierTtlConfig per blueprint D3 + ADR D3 (v1.1 4-tier amendment).
 * Used when consumer provides partial config OR omits `ttlSecondsByScopeTier`.
 */
export const DEFAULT_TTL_SECONDS_BY_SCOPE_TIER: ScopeTierTtlConfig = Object.freeze({
  user: 86_400, // 24h — long-lived account memory
  agent: 3_600, // 1h — mid-lived persona/skill scope
  session: 600, // 10min — short-lived run context (mirrors OpenAI prompt-cache default)
  repo: 3_600, // 1h — skill consolidation mid-frequency (ADR-0010)
});

/**
 * Default cosine similarity threshold for cache hit per blueprint D2.
 * Convergent across embedchain (similarity 0.8) AND REDACTED (distance 0.2).
 */
export const DEFAULT_THRESHOLD = 0.8;

/**
 * Default per-scope row cap for LRU eviction per blueprint Rec #8.
 * Empirical consumer default from embedchain `gptcache_data_manager(max_size=1000)`.
 */
export const DEFAULT_MAX_SIZE_PER_SCOPE = 1_000;

/**
 * Config validator. Throws {@link InvalidCacheConfig} at factory time
 * (fail-fast per architecture.md § 8).
 *
 * EC-1 absorption (IEEE 754 NaN comparison gap): `NaN < 0` and `NaN > 1` BOTH
 * return `false`. Without {@link Number.isFinite} guard, `threshold=NaN` or
 * `threshold=Infinity` would silently pass the range check and produce a
 * cache stuck in MISS-only state without warning. Mirror v1.4
 * `adapters-openrouter-local-embedder` T0.1 `Number.isInteger` precedent.
 *
 * EC-3 absorption: TTL config has 4 tiers including `repo` (skill scope per
 * ADR-0010). Per-tier negative TTL would mean immediate expiry — treat as
 * config bug.
 *
 * @throws {InvalidCacheConfig} on out-of-bounds threshold, non-positive-integer
 *   maxSize, NaN/Infinity numeric values, or negative TTL.
 */
export function validateRecallCacheStoreConfig(config: RecallCacheStoreConfig): void {
  if (config.threshold !== undefined) {
    if (!Number.isFinite(config.threshold)) {
      throw new InvalidCacheConfig(`threshold must be a finite number; got ${String(config.threshold)}`);
    }
    if (config.threshold < 0 || config.threshold > 1) {
      throw new InvalidCacheConfig(`threshold must be in [0, 1]; got ${config.threshold}`);
    }
  }
  if (config.maxSizePerScope !== undefined) {
    if (!Number.isInteger(config.maxSizePerScope) || config.maxSizePerScope <= 0) {
      throw new InvalidCacheConfig(
        `maxSizePerScope must be a positive integer; got ${String(config.maxSizePerScope)}`,
      );
    }
  }
  if (config.ttlSecondsByScopeTier !== undefined) {
    const tiers = ['user', 'agent', 'session', 'repo'] as const;
    for (const tier of tiers) {
      const ttl = config.ttlSecondsByScopeTier[tier];
      if (ttl !== undefined && (!Number.isFinite(ttl) || ttl < 0)) {
        throw new InvalidCacheConfig(
          `ttlSecondsByScopeTier.${tier} must be a non-negative finite number; got ${String(ttl)}`,
        );
      }
    }
  }
}
