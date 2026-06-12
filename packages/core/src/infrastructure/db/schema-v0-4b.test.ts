/**
 * T0.1 RED tests for v0.4b schema additions — Drizzle introspection only.
 *
 * Asserts the STRUCTURAL DECLARATION of v0.4b's three new memories columns
 * (last_accessed_at / access_count / half_life_seconds) plus the partial
 * index `idx_memories_eviction_score` keyed on `(agent_id, last_accessed_at)`
 * WHERE `t_invalid IS NULL`, WITHOUT requiring a live Postgres connection.
 *
 * Real-Postgres assertions (migration applies cleanly via drizzle-kit push,
 * partial-index filter actually filters at query time) live in
 * tests/integration/schema-v0-4b-eviction-columns.test.ts per testing.md § Pyramid.
 *
 * File-naming reconciliation: plan v1.2 T0.1 § Files to edit declares the test
 * file as `src/local/__tests__/schema.test.ts`. Established convention in the
 * repository (`schema-v0-4a.test.ts`, `schema-v0-6.test.ts`) places per-version
 * additions in their own file to avoid cross-version test churn. Following the
 * convention; documented in the T0.1 commit body. Plan intent (test the 3 columns
 * + 1 index) honored byte-for-byte.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T0.1
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § ADR D13
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

import { memories } from './schema.js';

describe('memories v0.4b additions (T0.1 / D13)', () => {
  test('adds last_accessed_at column (TIMESTAMPTZ nullable)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'last_accessed_at');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  test('adds access_count column with default zero (INTEGER NOT NULL DEFAULT 0)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'access_count');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.default).toBe(0);
  });

  test('adds half_life_seconds column (INTEGER nullable)', () => {
    const cfg = getTableConfig(memories);
    const col = cfg.columns.find((c) => c.name === 'half_life_seconds');
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  test('preserves all v0.6-post columns (no breaking change)', () => {
    const cfg = getTableConfig(memories);
    const colNames = cfg.columns.map((c) => c.name);
    const required = [
      // v0.1 baseline
      'id', 'text', 'hash', 'embedding', 'payload',
      'user_id', 'session_id', 'agent_id',
      't_valid', 't_invalid',
      'text_lemmatized', 'created_at', 'updated_at',
      // v0.4a additions
      'kind', 'derived_from', 'llm_importance_score',
      // v0.6 additions
      'superseded_by', 'code', 'description', 'code_language',
    ];
    for (const expected of required) {
      expect(colNames).toContain(expected);
    }
  });
});

describe('memories v0.4b index (T0.1 / D13)', () => {
  test('declares idx_memories_eviction_score partial index on (agent_id, last_accessed_at) WHERE t_invalid IS NULL', () => {
    const cfg = getTableConfig(memories);
    const idx = cfg.indexes.find((i) => i.config.name === 'idx_memories_eviction_score');
    expect(idx).toBeDefined();
    // Partial filter present (Drizzle stores .where expression on the index config)
    expect(idx?.config.where).toBeDefined();
  });
});
