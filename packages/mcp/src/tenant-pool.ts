/**
 * The database side of the OAuth-protected MCP transport: the same bar the REST server
 * holds (packages/cli/src/run-server.ts), for the same reason.
 *
 * A validated token names a tenant. That is worth nothing unless the database confines each
 * statement to it — so the request pool is `tenantScopedPool` (every connection carries
 * `app.workspace_id` from the request scope, read by the fail-closed policies of migration
 * 0029), and the role behind it must be SUBJECT to those policies. A superuser or a
 * BYPASSRLS role ignores row-level security entirely, and every layer above would keep
 * reporting success while isolating nothing. That is measured here, before the listener
 * binds, and refused.
 *
 * Before this module the MCP transport handed a RAW pool to the stores, which put them in
 * single-tenant mode: every write without a workspace scope landed in `default`.
 */
import { assertRequestPoolIsolated, runMigrations, tenantScopedPool } from '@usetheo/memory';
import { Pool } from 'pg';

export interface TenantScopedPools {
  /** Schema work and liveness only — no tenant, and it must not pretend to have one. */
  readonly rawPool: Pool;
  /** What every store receives: refuses a connection outside a workspace scope. */
  readonly pool: Pool;
  /** The database role the request connection authenticated as. */
  readonly role: string;
  /** Closes the underlying pool. */
  end(): Promise<void>;
}

export interface OpenTenantScopedPoolsOptions {
  /** Request connection — must be the contained application role (`themory_app`). */
  readonly pgUri: string;
  /** Schema owner for migrations; defaults to `pgUri` (only correct when that role owns the schema). */
  readonly migratePgUri?: string;
  readonly skipMigrations: boolean;
  readonly embeddingDim: number;
}

/**
 * Opens the request pool, refuses a role that bypasses row-level security, runs migrations on
 * the owner connection, and returns the tenant-scoped view. Throws with the reason on refusal;
 * the caller must not start the listener.
 */
export async function openTenantScopedPools(opts: OpenTenantScopedPoolsOptions): Promise<TenantScopedPools> {
  // Bounds are declared, never inherited — see run-server.ts for the failover argument.
  const rawPool = new Pool({
    connectionString: opts.pgUri,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    maxLifetimeSeconds: 3_600,
  });

  let role: string;
  try {
    ({ role } = await assertRequestPoolIsolated(rawPool));
  } catch (err) {
    await rawPool.end().catch(() => undefined);
    throw new Error(
      'themory mcp: refusing to serve OAuth-protected requests — the request connection is not ' +
        `contained by row-level security. ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (!opts.skipMigrations) {
    const migrateUri = opts.migratePgUri ?? opts.pgUri;
    const migratePool =
      migrateUri === opts.pgUri
        ? rawPool
        : new Pool({ connectionString: migrateUri, max: 2, connectionTimeoutMillis: 5_000 });
    try {
      await runMigrations(migratePool, { embeddingDim: opts.embeddingDim });
    } catch (err) {
      await rawPool.end().catch(() => undefined);
      throw new Error(
        `themory mcp: migrations failed (${err instanceof Error ? err.message : String(err)}). ` +
          (migrateUri === opts.pgUri
            ? 'They ran on the REQUEST connection; the application role has no DDL by design — ' +
              'point THEOMEM_MIGRATE_PG_URI at the schema owner.'
            : ''),
        { cause: err },
      );
    } finally {
      if (migratePool !== rawPool) await migratePool.end().catch(() => undefined);
    }
  }

  return {
    rawPool,
    pool: tenantScopedPool(rawPool),
    role,
    end: () => rawPool.end(),
  };
}
