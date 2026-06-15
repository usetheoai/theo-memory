/**
 * Global setup for integration tests — runs migrations on the shared DB
 * before any test file executes. Uses default 1536-dim (matching StubEmbedder).
 *
 * Tests that need a different dimension (e.g., 384 for LocalTransformerEmbedder)
 * MUST create their own isolated database to avoid conflicts.
 *
 * Implementation: uses dynamic import with tsx loader so vitest can resolve
 * the @usetheo/memory package alias correctly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = join(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '..', '..', 'packages', 'core', 'src', 'infrastructure', 'db', 'migrations',
);

export async function setup(): Promise<void> {
  const uri = process.env['THEOMEM_PG_URI'];
  if (!uri) return; // Tests will skip via describe.skipIf

  const pool = new pg.Pool({ connectionString: uri, max: 2 });
  try {
    // Ensure vector extension exists
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Read and apply migration SQL files in order
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      // Split on statement-breakpoints (Drizzle convention)
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        try {
          await pool.query(stmt);
        } catch (err: unknown) {
          // Ignore "already exists" errors (idempotent migrations)
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes('already exists') ||
            msg.includes('duplicate key') ||
            msg.includes('multiple primary keys')
          ) {
            continue;
          }
          throw err;
        }
      }
    }
  } finally {
    await pool.end();
  }
}
