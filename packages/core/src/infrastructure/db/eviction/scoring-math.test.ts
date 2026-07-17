/**
 * T2.1 RED tests for v0.4b `TriadicScoringPolicy` core scoring math.
 *
 * Pure-math unit tests against the additive triadic scoring formula:
 *   `score = w_r·recency + w_f·frequency + w_i·importance`
 * with weights normalized to sum=1 per blueprint D8 (ADDITIVE, NOT multiplicative)
 * + per-row exponential half-life decay for recency per blueprint D7
 * (`recency = 2^(-Δt/h)`; high score = recently accessed) + log-bounded frequency.
 *
 * THE LONG-TAIL MULTIPLIER (D9) lands in T4.2 — these tests target the BASE
 * additive sum only. Calling `score()` with `meanIsolationDistance = 0` causes
 * the multiplier to short-circuit to 1.0 so the base math is observable.
 *
 * Plan T2.1 § Deep Dives line 479 has a sign-error typo (`recency = 1 - 2^(-Δ/h)`)
 * that contradicts the adjacent RED test names `test_recency_approaches_one_for_just_accessed`
 * + `test_recency_approaches_zero_for_long_idle`. Implemented as `recency = 2^(-Δt/h)`
 * which matches the test names + blueprint D7 retention-probability semantics.
 * Documented in commit body.
 *
 */
import { describe, expect, test } from 'vitest';

import type { ScoreContext } from '../../../domain/dip/eviction-policy.js';
import type { MemoryItem } from '../../../domain/memory-item.js';

import {
  TriadicScoringPolicy,
  computeRecency,
  computeFrequency,
  computeImportance,
  computeHalfLifeSeconds,
  DEFAULT_TRIADIC_WEIGHTS,
  DEFAULT_TRIADIC_CONSTANTS,
  InvalidWeightsError,
} from './triadic-scoring-policy.js';

const NOW = new Date('2026-05-30T12:00:00Z');
const NEUTRAL_CTX: ScoreContext = { meanIsolationDistance: 0, now: NOW };

function buildMemory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem-1',
    text: 'test fact',
    hash: 'h-1',
    scope: { kind: 'user', userId: 'alice' },
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    metadata: {},
    tValid: new Date('2026-05-01T00:00:00Z'),
    tInvalid: null,
    ...overrides,
  };
}

describe('computeRecency (T2.1 / D7)', () => {
  test('recency is zero when last_accessed is null (D13 fail-graceful)', () => {
    const recency = computeRecency(null, NOW, DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds);
    expect(recency).toBe(0);
  });

  test('recency approaches one for just-accessed (Δt ≈ 0)', () => {
    const justAccessed = new Date(NOW.getTime() - 1000);
    const recency = computeRecency(justAccessed, NOW, DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds);
    expect(recency).toBeGreaterThan(0.999);
    expect(recency).toBeLessThanOrEqual(1);
  });

  test('recency approaches zero for long-idle (Δt ≫ h)', () => {
    const longIdle = new Date(NOW.getTime() - 365 * 86400 * 1000);
    const recency = computeRecency(longIdle, NOW, DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds);
    expect(recency).toBeLessThan(0.001);
    expect(recency).toBeGreaterThanOrEqual(0);
  });
});

describe('computeFrequency (T2.1 / D8)', () => {
  test('frequency is zero at access_count = 0', () => {
    const freq = computeFrequency(0, DEFAULT_TRIADIC_CONSTANTS.accessCountNorm);
    expect(freq).toBe(0);
  });

  test('frequency clamps at one when access_count > norm', () => {
    const freq = computeFrequency(10_000, DEFAULT_TRIADIC_CONSTANTS.accessCountNorm);
    expect(freq).toBe(1);
  });

  test('frequency handles null access_count as zero (EC-7)', () => {
    const freq = computeFrequency(null, DEFAULT_TRIADIC_CONSTANTS.accessCountNorm);
    expect(freq).toBe(0);
  });
});

describe('computeImportance (T2.1)', () => {
  test('importance uses default 0.5 when llm_importance_score is null', () => {
    const imp = computeImportance(null, DEFAULT_TRIADIC_CONSTANTS.importanceDefault);
    expect(imp).toBe(0.5);
  });

  test('importance passes through when llm_importance_score is in range', () => {
    const imp = computeImportance(0.8, DEFAULT_TRIADIC_CONSTANTS.importanceDefault);
    expect(imp).toBe(0.8);
  });
});

describe('computeHalfLifeSeconds (T2.1 / D14)', () => {
  test('computeHalfLifeSeconds is monotonic in importance', () => {
    const base = DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds;
    const low = computeHalfLifeSeconds(0.1, base);
    const mid = computeHalfLifeSeconds(0.5, base);
    const high = computeHalfLifeSeconds(0.9, base);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  test('computeHalfLifeSeconds yields integer seconds', () => {
    const h = computeHalfLifeSeconds(0.8, DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThan(0);
  });
});

describe('TriadicScoringPolicy.score (T2.1 / D8 additive composition)', () => {
  test('score is weighted sum of three components', async () => {
    const policy = new TriadicScoringPolicy({ recency: 1, frequency: 1, importance: 1 });
    const memory = buildMemory({
      lastAccessedAt: new Date(NOW.getTime() - 1000),
      accessCount: 100,
      llmImportanceScore: 0.8,
      halfLifeSeconds: DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds,
    });
    const score = await policy.score(memory, NEUTRAL_CTX);
    // recency ≈ 1, frequency = ln(101)/ln(101) = 1, importance = 0.8
    // normalized weights: [1/3, 1/3, 1/3]; expected ≈ (1 + 1 + 0.8) / 3 = 0.933
    expect(score).toBeGreaterThan(0.93);
    expect(score).toBeLessThan(0.94);
  });

  test('weight normalization enforced when constructor weights do not sum to 1', async () => {
    const policy = new TriadicScoringPolicy({ recency: 2, frequency: 2, importance: 2 });
    const memory = buildMemory({
      lastAccessedAt: new Date(NOW.getTime() - 1000),
      accessCount: 100,
      llmImportanceScore: 0.8,
      halfLifeSeconds: DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds,
    });
    const score = await policy.score(memory, NEUTRAL_CTX);
    // After normalization same as the equal-weights case.
    expect(score).toBeGreaterThan(0.93);
    expect(score).toBeLessThan(0.94);
  });

  test('score throws InvalidWeightsError when all weights are zero (EC-6)', () => {
    expect(() => new TriadicScoringPolicy({ recency: 0, frequency: 0, importance: 0 })).toThrow(
      InvalidWeightsError,
    );
  });
});

describe('DEFAULT_TRIADIC_WEIGHTS / DEFAULT_TRIADIC_CONSTANTS contract', () => {
  test('default weights sum to 1', () => {
    const sum = DEFAULT_TRIADIC_WEIGHTS.recency
      + DEFAULT_TRIADIC_WEIGHTS.frequency
      + DEFAULT_TRIADIC_WEIGHTS.importance;
    expect(sum).toBeCloseTo(1, 10);
  });

  test('default constants are positive non-zero', () => {
    expect(DEFAULT_TRIADIC_CONSTANTS.accessCountNorm).toBeGreaterThan(0);
    expect(DEFAULT_TRIADIC_CONSTANTS.halfLifeBaseSeconds).toBeGreaterThan(0);
    expect(DEFAULT_TRIADIC_CONSTANTS.importanceDefault).toBeGreaterThan(0);
    expect(DEFAULT_TRIADIC_CONSTANTS.importanceDefault).toBeLessThan(1);
  });
});
