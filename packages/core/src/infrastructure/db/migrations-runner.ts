/**
 * runMigrations + applyDimChange — database migration runner.
 *
 * Extracted from index.ts (T1.4 of architecture-review-fixes plan).
 */
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

/**
 * Apply pgvector + Drizzle migrations to a Postgres database.
 *
 * For production use: run once at app boot before constructing `createMemory`.
 * Idempotent across BOTH provisioning paths (F-T7.1-2):
 *   1. fresh DB                              → `CREATE EXTENSION` + run migrations
 *   2. already migrated (journal present)    → `migrate()` is a journal-aware no-op
 *   3. schema pushed via `drizzle-kit push`  → detects orphan schema (tables present
 *      but no `__drizzle_migrations` journal), logs a warning, and skips `migrate()`
 *      to avoid "relation already exists" crashes. The push-flow is dev-only;
 *      mixing it with `runMigrations()` in prod is a config smell the warning surfaces.
 *
 * Resolves the migrations folder shipped inside the npm package (`src/local/migrations/`).
 * Consumers do NOT need to know the path — they just provide the pool.
 *
 * Per F-dom-2 + db-migrations CRITICAL #2: addresses the production gap where
 * createLocalMemory previously assumed the schema already existed. Now consumers
 * can either:
 *   - dev:  `npm run db:push` (introspection-based, runs CREATE EXTENSION first via npm script)
 *   - prod: `await runMigrations(pool)` at app boot, then `createMemory({...})`.
 */
export async function runMigrations(
  pool: Pool,
  options?: { readonly embeddingDim?: number },
): Promise<void> {
  // pgvector extension MUST exist before tables with vector columns can be created.
  // Idempotent; safe to re-run.
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

  // Detect the "drizzle-kit push" footgun: schema present but not journal-tracked.
  // Without this guard, `migrate()` would throw "relation already exists" on re-run.
  const journalCheck = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
     ) AS exists`,
  );
  const journalExists = journalCheck.rows[0]?.exists === true;

  if (!journalExists) {
    const memoriesCheck = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'memories'
       ) AS exists`,
    );
    const memoriesExists = memoriesCheck.rows[0]?.exists === true;
    if (memoriesExists) {
      // Schema present but not journal-tracked → push-flow was used. Skip migrate()
      // gracefully; this is a deployment-config smell, not a runtime error.
      // /review F-M13: warning text must honestly state that we still apply the
      // explicit dim change when caller passed options.embeddingDim — only the
      // migrate() call is skipped, not the entire runMigrations() invocation.
      // eslint-disable-next-line no-console
      console.warn(
        '[themory] schema present but `drizzle.__drizzle_migrations` journal missing. ' +
          'Likely `drizzle-kit push` was used — skipping migrate(); ' +
          'applying explicit dim change only when options.embeddingDim is set. ' +
          'For production reproducibility, prefer `runMigrations()` on a fresh DB (F-T7.1-2).',
      );
      // T4.1 follow-up to T0.3: dim change must STILL apply on push-flow DBs.
      // SEPA pre-RED iter-3 M3 was wrong to say "place AFTER orphan-schema
      // short-circuit" — surfaced empirically by T4.1 live integration test
      // (the demo's existing dev DB was push-flow + dim change silently
      // skipped). When the operator explicitly passes embeddingDim, intent
      // is clear: apply the dim change regardless of journal state.
      // /review F-M4: do NOT short-circuit on `embeddingDim === MAX_EMBEDDING_DIM`.
      // The asymmetric guard blocked the legitimate 384 → 1536 revert (operator
      // switches local-openrouter → openai). The inner atttypmod probe in
      // applyDimChange already handles idempotency cleanly when the schema
      // already matches the requested dim.
      if (options?.embeddingDim !== undefined) {
        await applyDimChange(pool, options.embeddingDim);
      }
      return;
    }
  }

  // Resolve migrations folder shipped inside this package.
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolvePath(here, 'migrations');

  const db = drizzleNodePostgres(pool);
  await migrate(db, { migrationsFolder });

  // T0.3: post-migration parametric dim change for journal-tracked DBs.
  // Idempotency short-circuit in applyDimChange covers re-runs.
  // /review F-M4: same symmetry — always invoke when caller passes embeddingDim;
  // the inner atttypmod probe is the single source of truth for no-op detection.
  if (options?.embeddingDim !== undefined) {
    await applyDimChange(pool, options.embeddingDim);
  }
}

/**
 * adapters-openrouter-local-embedder T0.3: post-migration ALTER COLUMN sequence
 * with EC-3 (atomic transaction) + EC-4 (HNSW DROP+RECREATE) absorption.
 *
 * pgvector REJECTS `ALTER COLUMN TYPE` against a column with any index, so
 * both HNSW indexes (`memories_embedding_hnsw_idx` + `entities_embedding_hnsw_idx`
 * at `src/local/migrations/0000_crazy_mimic.sql:44,51`) must be dropped before
 * the ALTER and recreated after. The full DROP → DELETE → ALTER → CREATE
 * sequence runs inside a single BEGIN/COMMIT acquired from a dedicated
 * `pool.connect()` client (SEPA iter-3 pre-RED CRITICAL #1: NEVER nest inside
 * Drizzle's tx; NEVER reuse `pool.query` which autocommits per statement).
 *
 * **DESTRUCTIVE — full cascade collateral disclosure** (plan v1.2 ADR D3 + EC-B
 * amendment, /review F-C1):
 *
 *   The `DELETE FROM memories; DELETE FROM entities;` statements trigger the
 *   following FK cascades from `0000_crazy_mimic.sql` + later migrations:
 *
 *   1. `history.memory_id ON DELETE CASCADE` → entire history audit trail wiped.
 *   2. `consolidation_history.kept_memory_id ON DELETE SET NULL` → v0.7
 *      distillation provenance pointers nullified (audit rows survive but
 *      lose the FK back to the kept memory).
 *   3. `memories.superseded_by` self-FK ON DELETE SET NULL → v0.6 procedural
 *      skill supersession chains broken.
 *
 *   The original plan v1.0 ADR D3 specified `ALTER ... USING NULL` (only the
 *   embedding column data lost). That recipe was empirically rejected by the
 *   existing `vector(1536) NOT NULL` constraint (PG error 23502: "column ...
 *   contains null values" because USING NULL coerces every row's embedding
 *   to NULL then the NOT NULL check fires). The DELETE-before-ALTER pattern
 *   is the explicit form of the destructive-dim-change contract and avoids
 *   the constraint violation, but it widens the data-loss envelope. README
 *   "Destructive dim change caveat" enumerates the full cascade graph.
 *
 * Idempotency short-circuit: probe `pg_attribute.atttypmod` for memories.embedding;
 * if it already matches the requested dim, skip the entire sequence.
 * pgvector v0.5.1 stores `vector(N)` dimension in `atttypmod` directly (NO +4
 * varlena offset — empirically verified against the ankane/pgvector:v0.5.1
 * container in RED test phase; SEPA's training-data claim of `N + 4` was wrong
 * for this version).
 *
 */
async function applyDimChange(pool: Pool, targetDim: number): Promise<void> {
  // T1.1 — defense-in-depth guard (CWE-89). validateEmbeddingDim() validates
  // upstream, but multiple call layers separate it from the DDL interpolation
  // below. Re-validate at the function boundary per architecture.md § 8.
  if (!Number.isInteger(targetDim) || targetDim <= 0 || targetDim > 2000) {
    throw new Error(`applyDimChange: invalid dimension ${targetDim}`);
  }

  // /review F-Mi8 — defensive extversion probe. The identity decoder
  // (atttypmod stores N directly) was verified empirically against
  // pgvector v0.5.1. If a future pgvector release changes the encoding
  // (e.g., adopts the +4 varlena header SEPA originally claimed), the
  // identity decoder would silently produce a wrong dim → silently
  // mismatched ALTER. Probe the installed pgvector version and warn
  // (not throw — we keep moving so the demo still boots, but the
  // operator sees the canary so they know to re-verify).
  //
  // /review re-run F-dom-db-rerun-residual-M1: `startsWith('0.5.')` is
  // intentional and exhaustive — the trailing dot in the prefix forbids
  // a hypothetical pgvector `0.50.x` from matching (`'0.50.0'.startsWith('0.5.')`
  // is FALSE because the 4th char `'0'` !== `'.'`). So the canary correctly
  // fires on `0.5.x`-NOT-true versions including `0.50.x`, `0.6.x`, `1.x`.
  const ext = await pool.query<{ extversion: string | null }>(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  const installedVersion = ext.rows[0]?.extversion ?? null;
  if (installedVersion !== null && !installedVersion.startsWith('0.5.')) {
    // eslint-disable-next-line no-console
    console.warn(
      `[themory] runMigrations: pgvector extversion=${installedVersion} ` +
        '(adapters-openrouter-local-embedder T0.3 verified the atttypmod identity ' +
        'decoder against v0.5.x). If a future release changes the encoding, ' +
        're-verify dim-change idempotency.',
    );
  }

  // Probe current dim. atttypmod stores N directly for pgvector v0.5.1.
  //
  // /review re-run F-dom-db-rerun-residual-M2: probing ONLY memories.embedding
  // is sufficient because both ALTERs run inside the same BEGIN/COMMIT
  // transaction (see client.query('BEGIN') below). PG guarantees both
  // ALTER COLUMN statements succeed-or-fail atomically — so memories.atttypmod
  // is a faithful proxy for entities.atttypmod. The post-ALTER assertion below
  // verifies both columns explicitly anyway, closing the residual.
  const probe = await pool.query<{ atttypmod: number }>(
    `SELECT a.atttypmod
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'memories'
        AND a.attname = 'embedding'
        AND a.attisdropped = false`,
  );
  const currentDim = probe.rows[0]?.atttypmod ?? -1;
  if (currentDim === targetDim) {
    // Idempotency: schema already at requested dim, skip DROP+ALTER+RECREATE.
    // eslint-disable-next-line no-console
    console.error(
      `[themory] runMigrations: embeddingDim=${String(targetDim)} matches existing schema; no-op.`,
    );
    return;
  }

  // FAIL-CLOSED data-loss guard (/review post-v0.5.0 F-dom-cli-1 / F-dom-mem-2 /
  // F-arch-1 consensus): a dim change physically wipes every memory + entity. On
  // a FRESH database (0 rows) this is the normal first-boot path (the shipped
  // schema is vector(1536); a local-embedder deploy shrinks it to 384), so it is
  // allowed silently. But on a POPULATED database — e.g. an operator flipping
  // THEOMEM_EMBEDDER on an existing deployment — refuse to wipe unless the
  // operator explicitly opts in via THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE=1.
  // Without this, migrate-on-startup turns a routine env edit into silent,
  // irreversible data loss (Inquebrável Rule 8 — fail loud, never silently destroy).
  const rowCountResult = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM memories',
  );
  const rowCount = rowCountResult.rows[0]?.count ?? 0;
  const optedIn = process.env['THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE'] === '1';
  if (rowCount > 0 && !optedIn) {
    throw new Error(
      `[themory] runMigrations: refusing destructive embedding-dim change ` +
        `${String(currentDim)} → ${String(targetDim)} on a populated database ` +
        `(${String(rowCount)} memories). This wipes ALL memories + entities + audit trail. ` +
        `If this is intentional (e.g. switching THEOMEM_EMBEDDER), set ` +
        `THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE=1 to proceed. To keep the data, ` +
        `keep the embedder (and its dimension) unchanged.`,
    );
  }

  // eslint-disable-next-line no-console
  console.error(
    `[themory] runMigrations: dim change ${String(currentDim)} → ${String(targetDim)} — DESTRUCTIVE cascade: ` +
      'DELETE FROM memories (FK→history.memory_id ON DELETE CASCADE wipes audit trail; ' +
      'consolidation_history.kept_memory_id ON DELETE SET NULL nullifies v0.7 distillation provenance; ' +
      'memories.superseded_by ON DELETE SET NULL breaks v0.6 supersession chains) + ' +
      'DELETE FROM entities + DROP/RECREATE HNSW indexes (T0.3 / EC-3 + EC-4; plan v1.2 ADR D3; /review F-C1). ' +
      '/review F-M3: src/local/schema.ts still declares vector(1536) literally — ' +
      `DO NOT run \`drizzle-kit push\` against this DB while embeddingDim=${String(targetDim)} ` +
      'is active (push would silently revert the ALTER and drop all rows).',
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP INDEX IF EXISTS memories_embedding_hnsw_idx');
    await client.query('DROP INDEX IF EXISTS entities_embedding_hnsw_idx');
    // semantic-recall-cache-v1-5 T5.1 — cascade dim change to recall_cache so
    // an embedder swap that flows via runMigrations({ embeddingDim }) keeps
    // the cache table aligned with the embedder. EC-2 mismatch detection
    // (probeCacheTableDim) is the LOAD-bearing guard for the orthogonal case
    // (table dim ≠ embedder dim WITHOUT runMigrations). The cache table is
    // optional — `IF EXISTS` guards rule out failure on pre-v1.5 databases.
    await client.query('DROP INDEX IF EXISTS recall_cache_scope_hnsw_idx');
    // T4.1 follow-up to T0.3: `ALTER COLUMN TYPE vector(N) USING NULL`
    // collides with the existing `NOT NULL` constraint (PG error 23502:
    // "column ... contains null values" because every row's existing
    // embedding gets coerced to NULL during the ALTER and then violates
    // the constraint). The destructive-dim-change contract documents
    // that existing embedding data is lost on dim switch — DELETEing
    // the rows first is the explicit form of that contract and avoids
    // the constraint violation. DELETE preserves entity FK rows; the
    // empty `embedding` columns are then ALTERable cleanly.
    await client.query('DELETE FROM memories');
    await client.query('DELETE FROM entities');
    // Cache rows are stale once the embedder dim shifts (cosine across
    // dimensions has no meaning). Safe to DELETE — cache is read-side
    // memoization, not authoritative state.
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'recall_cache') THEN
        DELETE FROM recall_cache;
      END IF;
    END $$`);
    // Message embeddings (migration 0038) follow the same dimension. The column is nullable, so
    // the vectors are cleared and the messages themselves are kept: they stay searchable by
    // their words until something embeds them again.
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'memory_messages' AND column_name = 'embedding') THEN
        UPDATE memory_messages SET embedding = NULL WHERE embedding IS NOT NULL;
        EXECUTE 'ALTER TABLE "memory_messages" ALTER COLUMN "embedding" TYPE vector(${String(targetDim)})';
      END IF;
    END $$`);
    await client.query(`ALTER TABLE "memories" ALTER COLUMN "embedding" TYPE vector(${String(targetDim)})`);
    await client.query(`ALTER TABLE "entities" ALTER COLUMN "embedding" TYPE vector(${String(targetDim)})`);
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'recall_cache') THEN
        EXECUTE 'ALTER TABLE "recall_cache" ALTER COLUMN "query_embedding" TYPE vector(${String(targetDim)})';
      END IF;
    END $$`);
    // /review F-Mi9: match the migration's quoted-identifier style at
    // src/local/migrations/0000_crazy_mimic.sql:44,51 so a future PG
    // case-sensitivity change does not cause a runtime/migration drift.
    await client.query('CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops)');
    await client.query('CREATE INDEX "entities_embedding_hnsw_idx" ON "entities" USING hnsw ("embedding" vector_cosine_ops)');
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'recall_cache') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS "recall_cache_scope_hnsw_idx" ON "recall_cache" USING hnsw ("query_embedding" vector_cosine_ops)';
      END IF;
    END $$`);

    // /review re-run F-dom-pgvector-rerun-2: belt-and-suspenders value-based
    // canary INSIDE the transaction (so an unexpected outcome rolls back
    // cleanly rather than leaking a broken schema). Re-probes atttypmod
    // for memories, entities, AND recall_cache post-ALTER and asserts the
    // actual dim matches targetDim. Protects against:
    //  - hypothetical future pgvector release that changes atttypmod encoding
    //    (F-Mi8 extversion canary warns; this assertion fail-closes)
    //  - PG side-effects we did not anticipate (e.g., DEFAULT clause that
    //    overrides the ALTER, trigger that rewrites the type)
    //  - the entities ALTER silently no-op'ing while memories ALTER succeeds
    //
    // fixes-cycle-1 T1.1 / F-merge-10 absorption: extended to probe
    // `recall_cache.query_embedding` as well (v1.5.0 T5.1 cascade ALTERed
    // that column inside the same BEGIN/COMMIT but the canary only checked
    // memories + entities). The `recall_cache` row is absent on pre-v1.5
    // databases — the `WHERE` clause uses LEFT JOIN-style absence-tolerance:
    // the query simply returns 0-2 rows depending on which tables exist,
    // and the loop verifies each present row. Symmetric with the `DO $$ IF EXISTS`
    // guards on the recall_cache cascade ALTER block above.
    //
    // MUST run on `client` (the BEGIN/COMMIT connection), NOT `pool.query`:
    // the ALTERs above are uncommitted at this point, so a query on any other
    // pooled connection reads the pre-ALTER catalog (READ COMMITTED isolation)
    // and the canary false-fails with `atttypmod=<old dim>`. The canary is
    // explicitly an IN-TRANSACTION verification — it only means anything when
    // it observes the same uncommitted state the COMMIT below is about to seal.
    const verify = await client.query<{ rel: string; col: string; dim: number }>(
      `SELECT c.relname AS rel, a.attname AS col, a.atttypmod AS dim
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
        WHERE (
                (c.relname IN ('memories', 'entities', 'memory_messages') AND a.attname = 'embedding')
             OR (c.relname = 'recall_cache' AND a.attname = 'query_embedding')
              )
          AND a.attisdropped = false
        ORDER BY c.relname`,
    );
    for (const row of verify.rows) {
      if (row.dim !== targetDim) {
        throw new Error(
          `[themory] dim-change post-ALTER canary FAILED: ${row.rel}.${row.col} atttypmod=${String(row.dim)} ≠ targetDim=${String(targetDim)}`,
        );
      }
    }
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.error(
      `[themory] runMigrations: dim change complete; column types vector(${String(targetDim)}); HNSW indexes recreated.`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error(
      `[themory] runMigrations: dim change rolled back; schema preserved at vector(${String(currentDim)})`,
    );
    throw err;
  } finally {
    client.release();
  }
}
