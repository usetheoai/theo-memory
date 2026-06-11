/**
 * Public subpath `@usetheo/memory/cache-pg` — Postgres-backed semantic recall
 * cache. Surfaces `PgvectorRecallCacheStore` (the default `RecallCacheStore`
 * impl) + the 13th-DIP types so consumers can:
 *   - Build a custom cache wiring (drop-in alternative to the factory's
 *     POJO-config path), or
 *   - Reference the metric instrument names for dashboards.
 *
 * Mirrors the `embedders/local` v1.4 precedent (subpath isolation per
 * blueprint Rec #3 — default `@usetheo/memory` barrel does NOT pull this
 * module transitively).
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T4.1
 * @see package.json#exports."./cache-pg"
 */

export {
  PgvectorRecallCacheStore,
  type PgvectorRecallCacheStoreOptions,
} from './pgvector-recall-cache-store.js';
export {
  getRecallCacheHitCounter,
  getRecallCacheHitDurationHistogram,
  getRecallCacheMissDurationHistogram,
} from './recall-cache-metrics.js';
// Re-export the 13th-DIP contract types so consumers using the subpath do not
// need to mix imports across `@usetheo/memory/contract` AND `@usetheo/memory/cache-pg`.
export type {
  CachedResult,
  RecallCacheStore,
  RecallCacheStoreConfig,
  ScopeTierTtlConfig,
} from '../../../domain/dip/recall-cache-store.js';
export {
  DEFAULT_MAX_SIZE_PER_SCOPE,
  DEFAULT_THRESHOLD,
  DEFAULT_TTL_SECONDS_BY_SCOPE_TIER,
  validateRecallCacheStoreConfig,
} from '../../../domain/dip/recall-cache-store.js';
