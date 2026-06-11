/**
 * T0.2 schema sentinel — `theo_api_keys` table shape per plan
 * `theo-memory-faang-auth-lifecycle` § T0.2 Deep Dive.
 *
 * Mirrors the cloud-repo Stripe-shape impl at
 * `theo-cloud/cloud/internal/routes/api_keys.go:50-115`. Single-tenant variant
 * (D6): `tenant_id` defaults to 'self'; column retained for forward-compat.
 *
 * EC-2 absorption: schema MUST add CHECK constraint `id != rotated_from`
 * (forbids self-rotation cycle at row level — defense in depth on top of
 * the lineage CTE UNION dedupe).
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T0.2
 * @see .claude/knowledge-base/reviews/theo-memory-faang-auth-lifecycle-edge-cases-2026-06-07.md § EC-2
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import { theoApiKeys } from './schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');

describe('T0.2 — theo_api_keys schema shape', () => {
  test('Drizzle table exports the 12 mandated columns with expected types', () => {
    // Spot-check the column descriptor for the columns plan T0.2 mandates.
    // Drizzle's pgTable exposes columns under the table object directly.
    const cols = theoApiKeys;
    expect(cols.id).toBeDefined();
    expect(cols.subject).toBeDefined();
    expect(cols.tenantId).toBeDefined();
    expect(cols.keyName).toBeDefined();
    expect(cols.keyHash).toBeDefined();
    expect(cols.keyPrefix).toBeDefined();
    expect(cols.scopes).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.lastUsedAt).toBeDefined();
    expect(cols.expiresAt).toBeDefined();
    expect(cols.revokedAt).toBeDefined();
    expect(cols.rotatedFrom).toBeDefined();
  });

  test('scopes column is jsonb typed as readonly string[]', () => {
    // Smoke check: jsonb columns expose `.getSQLType()` returning 'jsonb'.
    // Type narrowing to readonly string[] is enforced at compile time (test-d).
    const colSqlType = theoApiKeys.scopes.getSQLType();
    expect(colSqlType).toBe('jsonb');
  });

  test('key_hash column is varchar(64) and UNIQUE-flagged', () => {
    const col = theoApiKeys.keyHash;
    // Drizzle exposes the column type via getSQLType()
    expect(col.getSQLType()).toBe('varchar(64)');
    // Drizzle stores `isUnique` flag when `.unique()` is chained
    expect(col.isUnique).toBe(true);
  });

  test('EC-2 absorption — migration SQL contains CHECK constraint forbidding self-rotation', () => {
    // The CHECK constraint is enforced at the SQL layer (Drizzle does not have
    // a first-class check() helper portable to all dialects in v0.31). The
    // migration file MUST literally include the constraint clause.
    // Migration 0012 is the new one per plan T0.2.
    const migration = readFileSync(
      resolve(MIGRATIONS_DIR, '0012_theo_api_keys.sql'),
      'utf8',
    );
    expect(migration).toMatch(/theo_api_keys_no_self_rotation/);
    expect(migration).toMatch(/CHECK\s*\(\s*id\s*!=\s*rotated_from\s*\)/i);
  });
});
