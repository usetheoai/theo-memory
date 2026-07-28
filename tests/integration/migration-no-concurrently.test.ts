/**
 * Guard (migration-concurrently-index-runbook M4) — no journal-applied migration
 * `.sql` may contain `CREATE INDEX CONCURRENTLY`.
 *
 * WHY: drizzle-orm 0.45.2 `PgDialect.migrate()` runs ALL pending migrations inside
 * ONE `session.transaction(...)` (verified in `drizzle-orm/pg-core/dialect.cjs`).
 * Postgres FORBIDS `CREATE INDEX CONCURRENTLY` inside a transaction block — a
 * migration file carrying it would crash `runMigrations()` at deploy with
 * SQLSTATE 25001. Large-table index builds must therefore run CONCURRENTLY
 *
 * This is a pure file-inspection sentinel (no pgvector container), mirroring
 * `schema-snapshot-parity.test.ts` + `config-parity.test.ts`.
 *
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
// EC-3: scan the SRC migrations (the source of truth + what `db:generate` writes),
// NOT the dist/ build copy.
const MIGRATIONS_DIR = join(
  REPO_ROOT,
  'packages',
  'core',
  'src',
  'infrastructure',
  'db',
  'migrations',
);

/**
 * True when the SQL text contains a `CREATE INDEX CONCURRENTLY` STATEMENT.
 * EC-2: strips `--...EOL` line comments first, then matches over the joined
 * text so `\s+` spans newlines (a `CREATE INDEX\nCONCURRENTLY` formatter wrap is
 * still caught) and a `-- ... CONCURRENTLY ...` comment does NOT false-positive.
 */
function hasConcurrentIndex(sql: string): boolean {
  const withoutLineComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
  // `(?:UNIQUE\s+)?` — `CREATE UNIQUE INDEX CONCURRENTLY` is valid Postgres and
  // crashes the single-tx migrate() identically (SQLSTATE 25001), so it must be
  // caught too (review F-T1).
  return /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(withoutLineComments);
}

describe('migration guard — no CREATE INDEX CONCURRENTLY in journal-applied migrations (M4)', () => {
  it('detector flags CONCURRENTLY even across a line wrap, and ignores it inside a -- comment', () => {
    // EC-2: line-split statement is still a real statement → must be flagged.
    expect(hasConcurrentIndex('CREATE INDEX\n  CONCURRENTLY x ON memories(id);')).toBe(true);
    expect(hasConcurrentIndex('CREATE INDEX CONCURRENTLY "i" ON memories(agent_id);')).toBe(true);
    // F-T1: CREATE UNIQUE INDEX CONCURRENTLY is valid Postgres + crashes single-tx migrate too.
    expect(hasConcurrentIndex('CREATE UNIQUE INDEX CONCURRENTLY "u" ON memories(hash);')).toBe(true);
    // F-T2: a real statement with a TRAILING -- comment is still flagged (the stripper keeps the statement prefix).
    expect(hasConcurrentIndex('CREATE INDEX CONCURRENTLY "i" ON memories(id); -- huge table')).toBe(true);
    // A mention inside a SQL comment is NOT a statement → must NOT be flagged.
    expect(hasConcurrentIndex('-- use CREATE INDEX CONCURRENTLY out-of-band (see § 10.4)')).toBe(false);
    // A plain (in-tx-safe) CREATE INDEX is allowed.
    expect(hasConcurrentIndex('CREATE INDEX IF NOT EXISTS "i" ON memories(agent_id);')).toBe(false);
    expect(hasConcurrentIndex('CREATE UNIQUE INDEX IF NOT EXISTS "u" ON memories(hash);')).toBe(false);
  });

  it('no migration .sql uses CREATE INDEX CONCURRENTLY (would crash drizzle single-tx migrate)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

    // EC-1 (non-vacuity sentinel): if the migrations path drifts (the monorepo
    // path already drifted once), a 0-file glob would make the assertion below
    // pass VACUOUSLY. Fail loudly instead.
    expect(
      files.length,
      `Expected to scan migration .sql files under ${MIGRATIONS_DIR}; found 0 — the path likely drifted (the guard would be vacuous).`,
    ).toBeGreaterThan(0);

    const offenders = files.filter((f) =>
      hasConcurrentIndex(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')),
    );

    expect(
      offenders,
      `These migration .sql files use CREATE INDEX CONCURRENTLY, which crashes drizzle's single-transaction migrate() (SQLSTATE 25001) at deploy. Run the CONCURRENTLY build OUT-OF-BAND instead. Offenders: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
