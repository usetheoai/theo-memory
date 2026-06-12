/**
 * T1.2 RED tests for `LastWriteWinsConflictPolicy` — deterministic
 * resolution by `createdAt` DESC with EC-1 lex tie-break on `memoryId`
 * DESC when timestamps equal.
 *
 * EC-1 scenario absorbed from edge-case review: in batch-persist pipelines
 * that capture the request-start timestamp ONCE and commit N rows in a
 * single transaction, candidates in one cluster CAN share the timestamp.
 * Without a deterministic tie-break, `Math.max` + unstable sort callbacks
 * return non-reproducible winners and THE GOAL TEST (T3.3) goes flaky.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T1.2 + ADR D2 + EC-1
 * @see .claude/knowledge-base/reviews/v0-7-distillation-pipeline-edge-cases-2026-06-01.md § EC-1
 */
import { describe, expect, test } from 'vitest';

import type { ConsolidationCandidate, ConsolidationContext } from '../dip/conflict-resolution-policy.js';

import { LastWriteWinsConflictPolicy } from './last-write-wins.js';

const ctx: ConsolidationContext = {
  scope: { kind: 'user', userId: 'alice' },
  observationDate: new Date('2026-06-01T16:00:00Z'),
};

describe('LastWriteWinsConflictPolicy (T1.2 / ADR D2 / EC-1)', () => {
  test('exposes kind = "last-write-wins"', () => {
    const policy = new LastWriteWinsConflictPolicy();
    expect(policy.kind).toBe('last-write-wins');
  });

  test('picks the candidate with the most recent createdAt as kept', async () => {
    const policy = new LastWriteWinsConflictPolicy();
    const fixture: ConsolidationCandidate[] = [
      { memoryId: 'mem-a', text: 'older', createdAt: new Date('2026-06-01T10:00:00Z') },
      { memoryId: 'mem-b', text: 'newer', createdAt: new Date('2026-06-01T11:00:00Z') },
    ];
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toHaveLength(1);
    expect(results[0]?.keptMemoryId).toBe('mem-b');
    expect(results[0]?.rejectedMemoryIds).toEqual(['mem-a']);
    expect(results[0]?.reason).toBe('last-write-wins');
    expect(results[0]?.policyName).toBe('last-write-wins');
    expect(results[0]?.originalEpisodeIds).toEqual(['mem-a', 'mem-b']);
  });

  test('returns empty array when candidates is empty (no consolidation)', async () => {
    const policy = new LastWriteWinsConflictPolicy();
    const results = await policy.consolidate([], ctx);
    expect(results).toEqual([]);
  });

  test('returns empty array for a singleton cluster (nothing to resolve)', async () => {
    const policy = new LastWriteWinsConflictPolicy();
    const fixture: ConsolidationCandidate[] = [
      { memoryId: 'mem-a', text: 'lone', createdAt: new Date('2026-06-01T10:00:00Z') },
    ];
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  // /review v0-7 F-C1 mass-tombstone guard
  test('F-C1 — default maxRejectionRatio=0.95: cluster of 20 consolidates (ratio 0.95)', async () => {
    const policy = new LastWriteWinsConflictPolicy();
    const base = new Date('2026-06-01T10:00:00Z').getTime();
    const fixture: ConsolidationCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      memoryId: `mem-${String(i).padStart(2, '0')}`,
      text: `text ${String(i)}`,
      createdAt: new Date(base + i * 1000),
    }));
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toHaveLength(1);
    expect(results[0]?.rejectedMemoryIds).toHaveLength(19);
  });

  test('F-C1 — default maxRejectionRatio=0.95: cluster of 21 ABSTAINS (ratio ~0.952 > 0.95)', async () => {
    const policy = new LastWriteWinsConflictPolicy();
    const base = new Date('2026-06-01T10:00:00Z').getTime();
    const fixture: ConsolidationCandidate[] = Array.from({ length: 21 }, (_, i) => ({
      memoryId: `mem-${String(i).padStart(2, '0')}`,
      text: `text ${String(i)}`,
      createdAt: new Date(base + i * 1000),
    }));
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  test('F-C1 — maxRejectionRatio=1.0 opt-out: cluster of 50 still consolidates', async () => {
    const policy = new LastWriteWinsConflictPolicy({ maxRejectionRatio: 1.0 });
    const base = new Date('2026-06-01T10:00:00Z').getTime();
    const fixture: ConsolidationCandidate[] = Array.from({ length: 50 }, (_, i) => ({
      memoryId: `mem-${String(i).padStart(2, '0')}`,
      text: `text ${String(i)}`,
      createdAt: new Date(base + i * 1000),
    }));
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toHaveLength(1);
    expect(results[0]?.rejectedMemoryIds).toHaveLength(49);
  });

  test('F-C1 — maxRejectionRatio=0 means never reject anything (effectively Noop)', async () => {
    const policy = new LastWriteWinsConflictPolicy({ maxRejectionRatio: 0 });
    const fixture: ConsolidationCandidate[] = [
      { memoryId: 'mem-a', text: 'older', createdAt: new Date('2026-06-01T10:00:00Z') },
      { memoryId: 'mem-b', text: 'newer', createdAt: new Date('2026-06-01T11:00:00Z') },
    ];
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  test('F-C1 — out-of-range maxRejectionRatio is clamped to [0, 1]', async () => {
    const tooHigh = new LastWriteWinsConflictPolicy({ maxRejectionRatio: 2.5 });
    const tooLow = new LastWriteWinsConflictPolicy({ maxRejectionRatio: -0.5 });
    const fixture: ConsolidationCandidate[] = Array.from({ length: 50 }, (_, i) => ({
      memoryId: `mem-${String(i).padStart(2, '0')}`,
      text: `text ${String(i)}`,
      createdAt: new Date(2026, 5, 1, 10, 0, 0, i),
    }));
    const tooHighResults = await tooHigh.consolidate(fixture, ctx);
    expect(tooHighResults).toHaveLength(1);
    const tooLowResults = await tooLow.consolidate(fixture, ctx);
    expect(tooLowResults).toEqual([]);
  });

  test('EC-1 — tie-break by memoryId lex DESC when createdAt equal (deterministic across 10 runs)', async () => {
    const policy = new LastWriteWinsConflictPolicy();
    const sharedTimestamp = new Date('2026-06-01T12:00:00Z');
    // EC-1 batch-persist scenario: 3 candidates with IDENTICAL timestamp.
    // Provided in NON-sorted order so the test catches both unstable sort
    // bugs AND any naive `Math.max` shortcut.
    const fixture: ConsolidationCandidate[] = [
      { memoryId: 'aaa', text: 'a', createdAt: sharedTimestamp },
      { memoryId: 'ccc', text: 'c', createdAt: sharedTimestamp },
      { memoryId: 'bbb', text: 'b', createdAt: sharedTimestamp },
    ];
    const winners = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const [result] = await policy.consolidate(fixture, ctx);
      expect(result?.keptMemoryId).toBe('ccc'); // lex DESC max
      expect(result?.rejectedMemoryIds).toEqual(['bbb', 'aaa']); // remaining lex DESC
      winners.add(result?.keptMemoryId ?? '');
    }
    expect(winners.size).toBe(1); // deterministic across all 10 runs
    expect(winners.has('ccc')).toBe(true);
  });
});
