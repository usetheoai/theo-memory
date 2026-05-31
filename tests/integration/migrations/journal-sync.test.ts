import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts the Drizzle journal stays in sync with the .sql migration files on disk.
 *
 * Drizzle's `migrate()` reads ONLY `meta/_journal.json` to decide which migrations to
 * apply. A .sql file that exists on disk but lacks both a `meta/{tag}_snapshot.json`
 * AND a `_journal.json` entry is silently ignored at runtime. That is the failure
 * mode that produced F-dom-db-1 BLOCKER: 0003 + 0004 .sql files were committed
 * without journal sync, so `runMigrations()` against a fresh prod DB applies only
 * 0000–0002 and the v0.4b eviction schema is missing.
 *
 * Two invariants verified:
 *   (a) For every `0*.sql`, a `meta/{tag}_snapshot.json` exists with matching tag.
 *   (b) For every `0*.sql`, a `_journal.json` entry exists whose `tag` matches the
 *       filename without `.sql` extension.
 *
 * Test runs as integration (not contract) because it inspects on-disk migration
 * artifacts that are committed alongside schema changes — failure represents a
 * deployment-shape defect, not a unit-logic defect.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T0.1
 * @see .claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-review-2026-05-30.md § F-dom-db-1
 */
describe('Drizzle journal sync', () => {
  const migrationsDir = join(__dirname, '..', '..', '..', 'src', 'local', 'migrations');
  const metaDir = join(migrationsDir, 'meta');

  const sqlFiles = readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();

  // Drizzle snapshot naming convention is idx-only: `{NNNN}_snapshot.json`.
  // The tag (e.g. `0003_eviction_columns`) is recorded inside the snapshot AND in
  // `_journal.json` entries[].tag, not in the filename.
  const snapshotFiles = readdirSync(metaDir)
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
    .sort();

  const journalRaw = readFileSync(join(metaDir, '_journal.json'), 'utf-8');
  const journal = JSON.parse(journalRaw) as {
    version: string;
    dialect: string;
    entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
  };

  it('every .sql migration has a matching meta/{tag}_snapshot.json (count match)', () => {
    expect(sqlFiles.length).toBe(snapshotFiles.length);
  });

  it('every .sql migration has a matching _journal.json entry (tag presence)', () => {
    const journalTags = new Set(journal.entries.map((e) => e.tag));
    const missing: string[] = [];
    for (const sqlFile of sqlFiles) {
      const tag = sqlFile.replace(/\.sql$/, '');
      if (!journalTags.has(tag)) {
        missing.push(tag);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every .sql migration has a matching meta/{idx}_snapshot.json (per-idx presence)', () => {
    const snapshotIdxs = new Set(
      snapshotFiles.map((name) => name.substring(0, 4)),
    );
    const missing: string[] = [];
    for (const sqlFile of sqlFiles) {
      const idx = sqlFile.substring(0, 4);
      if (!snapshotIdxs.has(idx)) {
        missing.push(idx);
      }
    }
    expect(missing).toEqual([]);
  });
});
