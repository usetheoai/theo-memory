/**
 * Cache-related helpers shared between factory.ts and scoped-memory.ts.
 *
 * Extracted from factory.ts + scoped-memory.ts (T1.5 of architecture-review-fixes plan).
 */
import type { Pool } from 'pg';

import type { Embedder } from '../../domain/dip/embedder.js';
import type {
  RecallCacheStore,
  RecallCacheStoreConfig,
} from '../../domain/dip/recall-cache-store.js';
import type { Scope } from '../../domain/scope.js';

/**
 * semantic-recall-cache-v1-5 T2.1 — discriminator between the dual-shape config.
 * A pre-constructed DIP impl has the 4 method names; a POJO config does not.
 */
export function isRecallCacheStoreInstance(value: unknown): value is RecallCacheStore {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecallCacheStore).get === 'function' &&
    typeof (value as RecallCacheStore).set === 'function' &&
    typeof (value as RecallCacheStore).invalidateScope === 'function' &&
    typeof (value as RecallCacheStore).clearExpired === 'function'
  );
}

/**
 * semantic-recall-cache-v1-5 T2.1 — EC-2 absorption.
 *
 * Probe `recall_cache.query_embedding` `atttypmod` to detect embedder/table
 * dim mismatch caused by mid-deployment embedder swap WITHOUT a corresponding
 * `runMigrations({embeddingDim})`. Mirrors v1.4 `adapters-openrouter-local-embedder`
 * T2.1 pattern — pgvector v0.5.1 stores N directly in `atttypmod` (verified
 * empirically by that cycle).
 *
 * Returns `null` when the table does not yet exist (pre-migration state) so
 * the factory can defer the check until the consumer runs `runMigrations()`.
 */
export async function probeCacheTableDim(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ atttypmod: number }>(
    `SELECT a.atttypmod
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'recall_cache'
        AND a.attname = 'query_embedding'
        AND a.attisdropped = false`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return row.atttypmod;
}

/**
 * semantic-recall-cache-v1-5 T2.1 — resolve TTL per scope tier from the config.
 * Honors per-tier override → default 4-tier table fallback. Mirrors
 * `RecallCacheStore` default behavior so wraps without an explicit config
 * receive the same values as the impl's internal default.
 */
export function resolveCacheTtl(
  scope: Scope,
  cacheConfig: RecallCacheStoreConfig | RecallCacheStore | undefined,
): number {
  // Default fallback table (mirror DEFAULT_TTL_SECONDS_BY_SCOPE_TIER without
  // importing the constant — keeps the wiring module readable).
  const defaults = { user: 86_400, agent: 3_600, session: 600, repo: 3_600 } as const;
  if (cacheConfig !== undefined && !isRecallCacheStoreInstance(cacheConfig)) {
    const override = cacheConfig.ttlSecondsByScopeTier?.[scope.kind];
    if (override !== undefined) return override;
  }
  return defaults[scope.kind];
}

/**
 * semantic-recall-cache-v1-5 T2.3 — constructor.name based stub-embedder
 * detection (avoids `instanceof` coupling to the concrete stub classes — the
 * test stub classes also need to be detected). Names recognized:
 *   - `StubEmbedder` (src/local/stubs.ts — legacy zero-vector stub)
 *   - `DeterministicStubEmbedder` (src/embedders/stub.ts — deterministic
 *     non-semantic vector stub used by run-server.ts default path)
 */
export function isStubEmbedder(embedder: Embedder): boolean {
  const name = embedder.constructor.name;
  return name === 'StubEmbedder' || name === 'DeterministicStubEmbedder';
}

const STUB_EMBEDDER_CACHE_WARNING_PREFIX = 'themory cache:';

/**
 * semantic-recall-cache-v1-5 T2.3 — emit the 3-line stderr warning the cycle-1
 * T2.2 pattern locked: line 1 names the detected class; line 2 surfaces the
 * behavior delta (semantic vs coincidental hits); line 3 points to wiring docs.
 */
export function emitStubEmbedderCacheWarning(detectedClassName: string): void {
  process.stderr.write(
    `${STUB_EMBEDDER_CACHE_WARNING_PREFIX} WARNING — Cache enabled with stub embedder (${detectedClassName}).\n`,
  );
  process.stderr.write(
    `${STUB_EMBEDDER_CACHE_WARNING_PREFIX} Cache hits will be COINCIDENTAL (deterministic but non-semantic vectors), NOT semantic.\n`,
  );
  process.stderr.write(
    `${STUB_EMBEDDER_CACHE_WARNING_PREFIX} For production semantic caching, wire OpenAIEmbedder or LocalTransformerEmbedder. See README § Wiring real providers.\n`,
  );
}
