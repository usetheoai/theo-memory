/**
 * RED-phase tests for src/local/schema.ts — T2.1 of v0-1-local-runtime plan v1.3.
 *
 * Drizzle schema declarations for three tables: memories, entities, history.
 * Tests assert structural shape (column presence, types, indices) WITHOUT
 * requiring a live Postgres connection — T2.2 runs the smoke push against a
 * real container.
 *
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

import { entities, entityEdges, history, memories, memoryEntities } from './schema.js';

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
        // principles-alignment-hardening T0.1 (ADR D1 — Princípio 1 confirmação factor)
        'confirmation_count',
        'expires_at',
        'distinct_source_count',
        // themory-category-filter-server-side T2.1 (ADR D2 + ADR D6 — operator category filter)
        'category',
        // multi-tenant-workspace-isolation T0.2 (ADR D1 — OUTER tenant anchor)
        'workspace_id',
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

  test('T2.1: adds normalized_key + type + nullable scope columns', () => {
    const cfg = getTableConfig(entities);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('normalized_key');
    expect(colNames).toContain('type');
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('session_id');
    expect(colNames).toContain('agent_id');
  });

  test('T2.1/EC-1: a UNIQUE index named entities_scope_type_key_uq exists', () => {
    const cfg = getTableConfig(entities);
    const uq = cfg.indexes.find((i) => i.config.name === 'entities_scope_type_key_uq');
    expect(uq).toBeDefined();
    expect(uq?.config.unique).toBe(true);
  });

  test('EC-5 (F-H1): entities.embedding dimension equals memories.embedding (no 384-vs-1536 drift)', () => {
    const entityEmbed = getTableConfig(entities).columns.find((c) => c.name === 'embedding');
    const memoryEmbed = getTableConfig(memories).columns.find((c) => c.name === 'embedding');
    expect(entityEmbed).toBeDefined();
    expect(memoryEmbed).toBeDefined();
    // getSQLType() renders e.g. "vector(1536)" — a mismatch would surface here
    // before it ever reaches a failing INSERT cast.
    expect(entityEmbed?.getSQLType()).toBe(memoryEmbed?.getSQLType());
  });
});

describe('entity_edges table (slice2 T1.1)', () => {
  test('entity_edges_table_has_expected_columns', () => {
    const cfg = getTableConfig(entityEdges);
    const cols = cfg.columns.map((c) => c.name);
    expect(cols).toContain('source_entity_id');
    expect(cols).toContain('target_entity_id');
    expect(cols).toContain('relation');
    expect(cols).toContain('normalized_relation');
    expect(cols).toContain('source_memory_id');
    expect(cols).toContain('workspace_id');
  });

  test('entity_edges_unique_arbiter_present (EC-1: source_memory_id IN the key)', () => {
    const cfg = getTableConfig(entityEdges);
    const uq = cfg.indexes.find((i) => i.config.name === 'entity_edges_scope_triple_uq');
    const hasUnique = uq !== undefined && uq.config.unique === true;
    expect(hasUnique).toBe(true);
  });

  test('EC-5 parity: entity_edges has no embedding (edges are not embedded; only nodes are)', () => {
    const cfg = getTableConfig(entityEdges);
    const cols = cfg.columns.map((c) => c.name);
    expect(cols).not.toContain('embedding');
  });
});

describe('memory_entities join table (T2.1)', () => {
  test('declares memory_id + entity_id columns', () => {
    const cfg = getTableConfig(memoryEntities);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('memory_id');
    expect(colNames).toContain('entity_id');
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
