/**
 * Public subpath `@usetheo/memory/recall-trace-pg` — Postgres-backed recall
 * trace store (the "accountable forgetting" write surface). Surfaces
 * `PgRecallTraceStore` (the default `RecallTraceStore` impl) + the 14th-DIP
 * types so consumers can build a custom wiring or reference the shapes.
 *
 * Mirrors the `cache-pg` subpath-isolation precedent — the default
 * `@usetheo/memory` barrel does NOT pull this module transitively.
 *
 * @see package.json#exports."./recall-trace-pg"
 */

export { PgRecallTraceStore } from './pg-recall-trace-store.js';

// Re-export the 14th-DIP contract types so subpath consumers don't need to mix
// imports across `@usetheo/memory/contract` AND `@usetheo/memory/recall-trace-pg`.
export type {
  DropReason,
  RecallTraceBatch,
  RecallTraceRow,
  RecallTraceStore,
  RecallTraceStoreConfig,
} from '../../../domain/dip/recall-trace-store.js';
export {
  DEFAULT_MAX_ROWS_PER_RECALL,
  MAX_ROWS_PER_RECALL,
  validateRecallTraceStoreConfig,
} from '../../../domain/dip/recall-trace-store.js';
