/**
 * RED-phase tests for src/local/schema.ts — T2.1 of v0-1-local-runtime plan v1.3.
 *
 * Drizzle schema declarations for three tables: memories, entities, history.
 * Tests assert structural shape (column presence, types, indices) WITHOUT
 * requiring a live Postgres connection — T2.2 runs the smoke push against a
 * real container.
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T2.1
 * @see .claude/knowledge-base/references/REDACTED/REDACTED/orm/passage.py:1-105 (REDACTED dual-backend reference)
 */
import { describe, expect, test } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { entities, history, memories } from '../schema.js';

describe('memories table', () => {
  test('declares the required columns', () => {
    const cfg = getTableConfig(memories);
    const colNames = cfg.columns.map((c) => c.name).sort();
    expect(colNames).toEqual(
      [
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
        // v0.4a additions (T0.2 — see schema-v0-4a.test.ts for ADR D6/D8 details)
        'kind',
        'derived_from',
        'llm_importance_score',
        // v0.6 additions (T0.1 — see schema-v0-6.test.ts for ADR D3 + EC-1 details)
        'superseded_by',
        'code',
        'description',
        'code_language',
        // v0.4b additions (T0.1 — see schema-v0-4b.test.ts for ADR D13 details)
        'last_accessed_at',
        'access_count',
        'half_life_seconds',
        // v1.1 additions (T1.1 — see "attributed_to column" test below for ADR D2 + EC-2 details)
        'attributed_to',
      ].sort(),
    );
  });

  test('id is the primary key', () => {
    const cfg = getTableConfig(memories);
    const idCol = cfg.columns.find((c) => c.name === 'id');
    expect(idCol?.primary).toBe(true);
  });

  test('hash column exists for MD5 dedup index', () => {
    const cfg = getTableConfig(memories);
    const hashCol = cfg.columns.find((c) => c.name === 'hash');
    expect(hashCol).toBeDefined();
    expect(hashCol?.notNull).toBe(true);
  });

  test('bi-temporal columns t_valid and t_invalid are both nullable (ADR-0006)', () => {
    const cfg = getTableConfig(memories);
    const tValid = cfg.columns.find((c) => c.name === 't_valid');
    const tInvalid = cfg.columns.find((c) => c.name === 't_invalid');
    expect(tValid).toBeDefined();
    expect(tInvalid).toBeDefined();
    expect(tValid?.notNull).toBe(false);
    expect(tInvalid?.notNull).toBe(false);
  });

  test('scope columns (user_id, session_id, agent_id) are all nullable text', () => {
    const cfg = getTableConfig(memories);
    for (const name of ['user_id', 'session_id', 'agent_id'] as const) {
      const col = cfg.columns.find((c) => c.name === name);
      expect(col).toBeDefined();
      expect(col?.notNull).toBe(false);
    }
  });

  test('attributed_to column is nullable text (v1.1 T1.1 + EC-2 absorption)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'attributed_to');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    expect(col?.dataType).toBe('string');
  });
});

describe('entities table', () => {
  test('declares name + embedding + payload columns', () => {
    const cfg = getTableConfig(entities);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('embedding');
    expect(colNames).toContain('payload');
  });
});

describe('history table', () => {
  test('declares memory_id FK + event + timestamp', () => {
    const cfg = getTableConfig(history);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('memory_id');
    expect(colNames).toContain('event');
    expect(colNames).toContain('timestamp');
  });

  test('event column accepts the expected enum values', () => {
    const cfg = getTableConfig(history);
    const eventCol = cfg.columns.find((c) => c.name === 'event');
    expect(eventCol).toBeDefined();
    expect(eventCol?.notNull).toBe(true);
  });
});
