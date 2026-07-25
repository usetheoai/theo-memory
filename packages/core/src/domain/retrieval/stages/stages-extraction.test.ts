/**
 * M19 (#124) — the recall pipeline stages were extracted from pipeline.ts into cohesive modules.
 * These are shape tests: each stage module must exist and export the function it owns, so a
 * rename/deletion fails loudly. The BEHAVIOR of each stage is frozen by the full contract +
 * integration suite (unchanged) and the M18 benchmark (identical three numbers), not re-asserted
 * here — a refactor that needed to change a behavior assertion would not be behavior-preserving.
 */
import { describe, expect, test } from 'vitest';

import { assembleCandidates } from './candidate-assembly.js';
import { applyAdaptiveAssessStage } from './adaptive-relax.js';
import { applyGraphExpansionStage } from './graph-expansion.js';
import { writeRecallTrace } from './recall-trace.js';
import { applyRerankStage } from './rerank.js';
import { makeRowToItem, scopeFromFilters } from './row-mapping.js';
import { filterAtThreshold } from './threshold-filter.js';

describe('recall pipeline stage extraction (M19 / #124)', () => {
  test('every extracted stage module exports its function', () => {
    expect(typeof filterAtThreshold).toBe('function');
    expect(typeof applyRerankStage).toBe('function');
    expect(typeof writeRecallTrace).toBe('function');
    expect(typeof applyAdaptiveAssessStage).toBe('function');
    expect(typeof applyGraphExpansionStage).toBe('function');
    expect(typeof scopeFromFilters).toBe('function');
    expect(typeof makeRowToItem).toBe('function');
    expect(typeof assembleCandidates).toBe('function');
  });

  test('filterAtThreshold applies the semantic gate + combine + drop (pure, no I/O)', () => {
    // A minimal exercise proving the extracted gate is the real one: semantic below threshold is
    // dropped; above-threshold with a passing composite survives. maxScore=1.0 (semantic-only).
    const candidates = new Map([
      ['keep', { semantic: 0.9, bm25: 0, entity: 0, payload: {} }],
      ['drop', { semantic: 0.1, bm25: 0, entity: 0, payload: {} }],
    ]);
    const out = filterAtThreshold(candidates, 1.0, 0.5);
    const ids = out.map((r) => r.id);
    expect(ids).toContain('keep');
    expect(ids).not.toContain('drop');
  });

  test('scopeFromFilters + makeRowToItem preserve scope and now (closure params)', () => {
    const scope = scopeFromFilters({ user_id: 'u1' });
    expect(scope).toEqual({ kind: 'user', userId: 'u1' });
    const now = new Date('2026-01-01T00:00:00Z');
    const rowToItem = makeRowToItem(scope, now);
    const item = rowToItem({ id: 'm1', payload: { text: 'hi' }, score: 0.7 });
    expect(item.scope).toEqual(scope);
    expect(item.tValid).toBe(now);
    expect(item.score).toBe(0.7);
  });
});
