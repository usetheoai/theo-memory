/**
 * T0.1 RED tests for v0.6 schema additions — Drizzle introspection only.
 *
 * Asserts the STRUCTURAL DECLARATION of v0.6's four new memories columns
 * (superseded_by / code / description / code_language) AND the relaxed
 * `memories_kind_derived_from_check` CHECK constraint that now accepts
 * `kind = 'skill'`. CHECK-constraint enforcement against a real database
 * (which requires Postgres) is exercised by the integration tier in
 * `tests/integration/skills/` per testing.md § Pyramid.
 *
 * EC-1 absorption (plan v1.1): the constraint name MUST stay
 * `memories_kind_derived_from_check` verbatim — the migration's DROP+ADD
 * pair cites this name explicitly so Drizzle auto-naming cannot drift.
 *
 * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T0.1
 * @see .claude/knowledge-base/discoveries/blueprints/voyager-skill-library-blueprint.md § ADR D3
 */
import { describe, expect, test } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { memories } from '../schema.js';

describe('memories v0.6 additions (T0.1)', () => {
  test('adds superseded_by column (UUID nullable, self-FK)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'superseded_by');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    // UUID dataType maps to 'string' at the JS layer in Drizzle pg-core
    expect(col?.dataType).toBe('string');
  });

  test('adds code column (TEXT nullable — code-as-skill payload)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'code');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  test('adds description column (TEXT nullable — embedding target for kind=skill)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'description');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  test('adds code_language column (VARCHAR(20) nullable)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'code_language');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  test('preserves all v0.1 + v0.4a columns (no breaking change)', () => {
    const cfg = getTableConfig(memories);
    const colNames = cfg.columns.map((c) => c.name);
    const preExisting = [
      // v0.1
      'id',
      'text',
      'hash',
      'embedding',
      'payload',
      'user_id',
      'session_id',
      'agent_id',
      't_valid',
      't_invalid',
      'text_lemmatized',
      'created_at',
      'updated_at',
      // v0.4a
      'kind',
      'derived_from',
      'llm_importance_score',
    ];
    for (const expected of preExisting) {
      expect(colNames).toContain(expected);
    }
  });
});

/**
 * Concatenate a Drizzle SQL template's string chunks for substring assertions.
 * Drizzle's SQL.queryChunks mixes raw strings, StringChunk wrappers, and Param
 * placeholders — only the string-shaped chunks carry the literal SQL fragments
 * we want to assert against. Avoids JSON.stringify (circular references).
 */
function flattenSqlChunks(value: unknown): string {
  const v = value as { queryChunks?: unknown[] } | null | undefined;
  if (!v?.queryChunks) return '';
  return v.queryChunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk;
      const obj = chunk as { value?: unknown };
      if (obj && typeof obj.value === 'string') return obj.value;
      if (obj && Array.isArray(obj.value)) return obj.value.join('');
      return '';
    })
    .join(' ');
}

describe('memories_kind_derived_from_check CHECK constraint (T0.1 + EC-1)', () => {
  test('retains its verbatim constraint name (EC-1 absorption)', () => {
    const cfg = getTableConfig(memories);
    const check = cfg.checks.find((c) => c.name === 'memories_kind_derived_from_check');
    expect(check).toBeDefined();
  });

  test('relaxed CHECK SQL mentions skill discriminant (kind = \'skill\')', () => {
    const cfg = getTableConfig(memories);
    const check = cfg.checks.find((c) => c.name === 'memories_kind_derived_from_check');
    expect(check).toBeDefined();
    expect(flattenSqlChunks(check?.value)).toMatch(/'skill'/);
  });

  test('relaxed CHECK SQL still covers extracted and derived arms', () => {
    const cfg = getTableConfig(memories);
    const check = cfg.checks.find((c) => c.name === 'memories_kind_derived_from_check');
    const sql = flattenSqlChunks(check?.value);
    expect(sql).toMatch(/'extracted'/);
    expect(sql).toMatch(/'derived'/);
  });
});
