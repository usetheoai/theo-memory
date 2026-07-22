/**
 * M10 T2.1 — `scopeAwareReweight`: the deterministic, bounded, PURE scope-aware reweight.
 * A SESSION-origin row (session_id set) is boosted by recency (newer created_at → higher);
 * a GLOBAL-origin row (session_id NULL) by stability (higher confirmation_count → higher).
 * Order-correctness pattern from mem0's tests/utils/test_scoring.py.
 */
import { describe, expect, it } from 'vitest';

import type { MemoryItemWithScore } from '../memory-item.js';

import { scopeAwareReweight } from './scope-reweight.js';

const NOW = new Date('2026-07-22T00:00:00Z');
const WEIGHTS = { sessionRecencyWeight: 0.3, globalStabilityWeight: 0.3 };

function item(
  id: string,
  score: number,
  opts: { sessionId?: string; createdAt?: Date; confirmationCount?: number },
): MemoryItemWithScore {
  const metadata: Record<string, string | number | boolean | null> = {};
  if (opts.sessionId !== undefined) metadata['session_id'] = opts.sessionId;
  return {
    id,
    text: `t-${id}`,
    hash: `h-${id}`,
    scope: { kind: 'session', sessionId: 's', userId: 'u' },
    createdAt: opts.createdAt ?? NOW,
    updatedAt: opts.createdAt ?? NOW,
    metadata,
    tValid: NOW,
    tInvalid: null,
    score,
    ...(opts.confirmationCount !== undefined ? { confirmationCount: opts.confirmationCount } : {}),
  };
}

const days = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('scopeAwareReweight — session recency-boost + global stability-boost', () => {
  it('test_session_recency_boost_reorders_newer_above_older', () => {
    // Two session rows, equal base score; the newer must rank first after reweight.
    const older = item('old', 0.5, { sessionId: 's', createdAt: days(30) });
    const newer = item('new', 0.5, { sessionId: 's', createdAt: days(0) });
    const out = scopeAwareReweight([older, newer], WEIGHTS, NOW);
    expect(out.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('test_global_stability_boost_reorders_higher_confirmation_above_lower', () => {
    // Two global rows (no session_id), equal base score; higher confirmation_count ranks first.
    const oneOff = item('one', 0.5, { confirmationCount: 1 });
    const durable = item('dur', 0.5, { confirmationCount: 20 });
    const out = scopeAwareReweight([oneOff, durable], WEIGHTS, NOW);
    expect(out.map((i) => i.id)).toEqual(['dur', 'one']);
  });

  it('test_bounded_does_not_invert_a_large_base_score_gap', () => {
    // A far-higher base score is NOT overturned by a recency/stability boost (bounded multiplier).
    const strongOld = item('strong', 0.95, { sessionId: 's', createdAt: days(365) });
    const weakNew = item('weak', 0.30, { sessionId: 's', createdAt: days(0) });
    const out = scopeAwareReweight([weakNew, strongOld], WEIGHTS, NOW);
    expect(out[0]!.id).toBe('strong'); // base-score dominance preserved
  });

  it('test_deterministic_same_inputs_same_output', () => {
    const items = [item('a', 0.5, { sessionId: 's', createdAt: days(1) }), item('b', 0.6, { confirmationCount: 3 })];
    const a = scopeAwareReweight(items, WEIGHTS, NOW).map((i) => `${i.id}:${i.score}`);
    const b = scopeAwareReweight(items, WEIGHTS, NOW).map((i) => `${i.id}:${i.score}`);
    expect(a).toEqual(b);
  });

  it('test_zero_weights_preserve_base_order', () => {
    const items = [item('a', 0.4, { sessionId: 's', createdAt: days(0) }), item('b', 0.6, { confirmationCount: 9 })];
    const out = scopeAwareReweight(items, { sessionRecencyWeight: 0, globalStabilityWeight: 0 }, NOW);
    expect(out.map((i) => i.id)).toEqual(['b', 'a']); // pure base-score order
  });
});
