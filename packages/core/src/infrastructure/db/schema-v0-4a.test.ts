/**
 * T0.2 RED tests for v0.4a schema additions — Drizzle introspection only.
 *
 * Asserts the STRUCTURAL DECLARATION of v0.4a's three new memories columns
 * (kind / derived_from / llm_importance_score) AND the new reflection_counters
 * table, WITHOUT requiring a live Postgres connection. CHECK-constraint
 * enforcement (which requires real Postgres) lives in
 * tests/integration/schema-v0-4a-constraints.test.ts per testing.md § Pyramid.
 *
 * Per plan v0-4a-reflection-pipeline § T0.2 ADRs D4 + D6 + D8.
 *
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

import { memories, reflectionCounters } from './schema.js';

describe('memories v0.4a additions (T0.2)', () => {
  test('adds kind column (VARCHAR with default extracted)', () => {
    const cfg = getTableConfig(memories);
    const kindCol = cfg.columns.find((c) => c.name === 'kind');
    expect(kindCol).toBeDefined();
    expect(kindCol?.notNull).toBe(true);
    expect(kindCol?.default).toBe('extracted');
  });

  test('adds derived_from column (JSONB nullable)', () => {
    const cfg = getTableConfig(memories);
    const derivedCol = cfg.columns.find((c) => c.name === 'derived_from');
    expect(derivedCol).toBeDefined();
    expect(derivedCol?.notNull).toBe(false);
  });

  test('adds llm_importance_score column (REAL nullable)', () => {
    const cfg = getTableConfig(memories);
    const importanceCol = cfg.columns.find((c) => c.name === 'llm_importance_score');
    expect(importanceCol).toBeDefined();
    expect(importanceCol?.notNull).toBe(false);
  });

  test('preserves all v0.1 columns (no breaking change)', () => {
    const cfg = getTableConfig(memories);
    const colNames = cfg.columns.map((c) => c.name);
    const v0_1 = ['id', 'text', 'hash', 'embedding', 'payload', 'user_id', 'session_id', 'agent_id', 't_valid', 't_invalid', 'text_lemmatized', 'created_at', 'updated_at'];
    for (const expected of v0_1) {
      expect(colNames).toContain(expected);
    }
  });
});

describe('reflection_counters table (T0.2 + ADR D4)', () => {
  test('table exists with composite-unique scope', () => {
    const cfg = getTableConfig(reflectionCounters);
    expect(cfg.name).toBe('reflection_counters');
  });

  test('has scope columns (scope_user_id / scope_session_id / scope_agent_id)', () => {
    const cfg = getTableConfig(reflectionCounters);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('scope_user_id');
    expect(colNames).toContain('scope_session_id');
    expect(colNames).toContain('scope_agent_id');
  });

  test('has count BIGINT NOT NULL DEFAULT 0 (EC-2 absorption)', () => {
    const cfg = getTableConfig(reflectionCounters);
    const countCol = cfg.columns.find((c) => c.name === 'count');
    expect(countCol).toBeDefined();
    expect(countCol?.notNull).toBe(true);
    expect(countCol?.default).toBe(0);
  });

  test('scope columns are all nullable (composite-unique handles disjoint scopes)', () => {
    const cfg = getTableConfig(reflectionCounters);
    const scopeUser = cfg.columns.find((c) => c.name === 'scope_user_id');
    const scopeSession = cfg.columns.find((c) => c.name === 'scope_session_id');
    const scopeAgent = cfg.columns.find((c) => c.name === 'scope_agent_id');
    expect(scopeUser?.notNull).toBe(false);
    expect(scopeSession?.notNull).toBe(false);
    expect(scopeAgent?.notNull).toBe(false);
  });
});
