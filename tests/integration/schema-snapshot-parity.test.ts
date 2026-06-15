/**
 * /review v0-7-distillation-pipeline F-C3 sentinel: schema.ts ↔ migrations/meta
 * parity. Closes the failure mode where a table is added to a Drizzle SQL
 * migration + snapshot but never declared as a `pgTable` export in
 * `packages/core/src/infrastructure/db/schema.ts`. `drizzle-kit push` (the documented `npm run db:push`
 * dev workflow) would otherwise compute a destructive DROP TABLE diff against
 * a v0.7-migrated DB and silently delete all audit rows.
 *
 * This test runs WITHOUT a pgvector container — it's pure file inspection +
 * parsing. Lives at tests/integration/ instead of tests/unit/ because it
 * touches the migrations + schema source-of-truth which is integration-tier
 * concern (production deployment correctness).
 *
 * @see .claude/knowledge-base/reviews/v0-7-distillation-pipeline-review-2026-06-02.md § F-C3
 * @see .claude/rules/architecture.md § 10.2 (drizzle-kit push vs runMigrations)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as schema from '@usetheo/memory';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const META_DIR = join(REPO_ROOT, 'packages', 'core', 'src', 'infrastructure', 'db', 'migrations', 'meta');

/**
 * Enumerate every table named in any meta/*_snapshot.json. Drizzle stores
 * tables under top-level `tables` object keyed `public.{tablename}`.
 */
function collectSnapshotTables(): Set<string> {
  const tables = new Set<string>();
  const files = readdirSync(META_DIR).filter((f) => f.endsWith('_snapshot.json'));
  for (const file of files) {
    const raw = readFileSync(join(META_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as { tables?: Record<string, unknown> };
    if (parsed.tables === undefined) continue;
    for (const key of Object.keys(parsed.tables)) {
      // Keys look like "public.memories", "public.consolidation_history" — strip schema.
      const dot = key.indexOf('.');
      const name = dot >= 0 ? key.slice(dot + 1) : key;
      tables.add(name);
    }
  }
  return tables;
}

/**
 * Enumerate every `pgTable('name', ...)` declaration exported by schema.ts
 * via Drizzle's `Symbol.for('drizzle:Name')` runtime tag.
 */
function collectSchemaTables(): Set<string> {
  const tables = new Set<string>();
  for (const exportName of Object.keys(schema)) {
    const value = (schema as Record<string, unknown>)[exportName];
    if (value === null || typeof value !== 'object') continue;
    const name = (value as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    if (typeof name === 'string') {
      tables.add(name);
    }
  }
  return tables;
}

describe('schema.ts ↔ migrations/meta snapshot parity (F-C3 sentinel)', () => {
  it('every table in any *_snapshot.json is declared in packages/core/src/infrastructure/db/schema.ts', () => {
    const snapshotTables = collectSnapshotTables();
    const schemaTables = collectSchemaTables();
    const missing = [...snapshotTables].filter((t) => !schemaTables.has(t));
    expect(missing, `Tables in migrations/meta/*_snapshot.json missing from packages/core/src/infrastructure/db/schema.ts: ${missing.join(', ')}. drizzle-kit push would compute a destructive DROP TABLE diff for each.`).toEqual([]);
  });

  it('every pgTable in packages/core/src/infrastructure/db/schema.ts appears in at least one snapshot', () => {
    const snapshotTables = collectSnapshotTables();
    const schemaTables = collectSchemaTables();
    const unmigrated = [...schemaTables].filter((t) => !snapshotTables.has(t));
    expect(unmigrated, `Tables declared in packages/core/src/infrastructure/db/schema.ts without a corresponding migration snapshot: ${unmigrated.join(', ')}. Run \`npm run db:generate\` to materialize the migration.`).toEqual([]);
  });
});
