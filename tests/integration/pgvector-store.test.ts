/**
 * Integration test for PgvectorStore — T3.3 of v0-1-local-runtime plan v1.3.
 *
 * Runs the shared VectorStore conformance suite (T3.1) against a real
 * ankane/pgvector:v0.5.1 container via docker-compose.
 *
 * Gated by THEOMEM_PG_URI env var: when absent, tests are SKIPPED cleanly
 * (no false-green; the absence is logged via the integration vitest config's
 * `passWithNoTests`).
 *
 * Pre-conditions for running locally:
 *   npm run compose:up
 *   psql $THEOMEM_PG_URI -c "CREATE EXTENSION IF NOT EXISTS vector"
 *   npm run db:push -- --force
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T3.3
 */
import { afterAll, describe, test } from 'vitest';
import pg from 'pg';

import { PgvectorStore } from '@usetheo/memory';
import { runVectorStoreConformance } from '../../packages/core/src/infrastructure/db/vector-store-conformance.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('PgvectorStore (THEOMEM_PG_URI not set — skipping integration suite)', () => {
    test('placeholder', () => {
      // No-op
    });
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  afterAll(async () => {
    await pool.end();
  });

  runVectorStoreConformance('PgvectorStore (real ankane/pgvector:v0.5.1)', () => {
    const store = new PgvectorStore(pool);
    return Promise.resolve({
      store,
      truncate: async () => {
        await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
      },
    });
  });
}
