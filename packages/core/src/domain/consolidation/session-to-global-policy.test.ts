/**
 * M9 T1.1 — SessionToGlobalConsolidationPolicy: the promotion DECISION.
 *
 * A cosine-similar cluster of session memories is promoted to global when its
 * representative is durable (distinct_source_count ≥ threshold, Princípio 1). The policy
 * is PURE (no I/O) — persistence (session_id→NULL + soft-delete + audit) is T2.1.
 * Reuses the shipped ConflictResolutionPolicy DIP (ADR D1) so the audit/soft-delete
 * path is already built.
 */
import { describe, expect, it } from 'vitest';

import type {
  ConsolidationCandidate,
  ConsolidationContext,
} from '../dip/conflict-resolution-policy.js';

import { SessionToGlobalConsolidationPolicy } from './session-to-global-policy.js';

const CTX: ConsolidationContext = {
  scope: { kind: 'session', sessionId: 's1', userId: 'alice' },
  observationDate: new Date('2026-07-22T00:00:00Z'),
};

function candidate(id: string, distinctSourceCount: number): ConsolidationCandidate {
  return { memoryId: id, text: `fact ${id}`, createdAt: new Date('2026-07-22T00:00:00Z'), distinctSourceCount };
}

describe('SessionToGlobalConsolidationPolicy — session→global promotion decision', () => {
  it('test_promotes_only_the_durable_memory_leaving_distinct_facts_untouched', async () => {
    const policy = new SessionToGlobalConsolidationPolicy(3);
    // The scope holds a durable fact (count 3) + two UNRELATED one-off facts (count 1).
    // Only the durable one is promoted; the one-offs are NOT rejected (they decay).
    const scope = [candidate('m1', 3), candidate('m2', 1), candidate('m3', 1)];
    const results = await policy.consolidate(scope, CTX);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.keptMemoryId).toBe('m1'); // the durable fact
    expect(r.rejectedMemoryIds).toEqual([]); // distinct facts are NEVER rejected as duplicates
    expect(r.originalEpisodeIds).toEqual(['m1']);
    expect(r.policyName).toBe('session-to-global');
  });

  it('test_promotes_every_durable_memory_independently', async () => {
    const policy = new SessionToGlobalConsolidationPolicy(3);
    const scope = [candidate('m1', 3), candidate('m2', 4), candidate('m3', 1)];
    const results = await policy.consolidate(scope, CTX);
    expect(results.map((r) => r.keptMemoryId).sort()).toEqual(['m1', 'm2']); // both durable ones
    expect(results.every((r) => r.rejectedMemoryIds.length === 0)).toBe(true);
  });

  it('test_does_not_promote_a_one_off_below_threshold', async () => {
    const policy = new SessionToGlobalConsolidationPolicy(3);
    const results = await policy.consolidate([candidate('m1', 1)], CTX);
    expect(results).toEqual([]); // one-off → not promoted; it will decay via eviction
  });

  it('test_reason_records_the_distinct_source_trigger', async () => {
    const policy = new SessionToGlobalConsolidationPolicy(3);
    const results = await policy.consolidate([candidate('m1', 5)], CTX);
    expect(results).toHaveLength(1);
    expect(results[0]!.reason).toContain('distinct_source_count');
    expect(results[0]!.reason).toContain('5');
  });

  it('test_single_deduped_row_at_threshold_promotes_with_no_rejects', async () => {
    // Three identified original sources support one deduplicated memory.
    const policy = new SessionToGlobalConsolidationPolicy(3);
    const results = await policy.consolidate([candidate('m1', 3)], CTX);
    expect(results).toHaveLength(1);
    expect(results[0]!.keptMemoryId).toBe('m1');
    expect(results[0]!.rejectedMemoryIds).toEqual([]);
    expect(results[0]!.originalEpisodeIds).toEqual(['m1']);
  });

  it('test_unknown_distinct_source_count_is_not_promoted', async () => {
    // A candidate with no distinctSourceCount (optional field absent) is treated as 0 — a
    // stale-impl candidate must NEVER be silently promoted (negative case, testing.md §4.1).
    const policy = new SessionToGlobalConsolidationPolicy(3);
    const noCount: ConsolidationCandidate = { memoryId: 'm1', text: 'x', createdAt: new Date('2026-07-22T00:00:00Z') };
    expect(await policy.consolidate([noCount], CTX)).toEqual([]);
  });

  it('test_count_one_below_threshold_is_not_promoted', async () => {
    // The first invalid value below the boundary (threshold 3 → count 2) must NOT promote.
    const policy = new SessionToGlobalConsolidationPolicy(3);
    expect(await policy.consolidate([candidate('m1', 2)], CTX)).toEqual([]);
  });

  it('test_empty_cluster_abstains', async () => {
    const policy = new SessionToGlobalConsolidationPolicy(3);
    expect(await policy.consolidate([], CTX)).toEqual([]);
  });

  it('test_kind_discriminator', () => {
    expect(new SessionToGlobalConsolidationPolicy(3).kind).toBe('session-to-global');
  });
});

 it('does not confuse repeated assertions with distinct origins', async () => {
   const policy = new SessionToGlobalConsolidationPolicy();
   expect(await policy.consolidate([{ ...candidate('repeated', 1), confirmationCount: 100 }], CTX)).toEqual([]);
   expect(await policy.consolidate([{ ...candidate('unknown', 0), distinctSourceCount: null, confirmationCount: 100 }], CTX)).toEqual([]);
   expect(await policy.consolidate([{ ...candidate('expired', 2), expiresAt: new Date('2026-07-01') }], CTX)).toEqual([]);
 });
