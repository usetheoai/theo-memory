/**
 * M24 T3.1 — `consolidateInBoundedClusters` calls the conflict policy once per
 * bounded cluster instead of once with the whole scope.
 *
 * The M23 wall: with > clusterCap candidates the policy abstains (no LLM call),
 * so the contradiction pair never reaches the judge. Bounded clustering must
 * split the candidates so each `consolidate` call is <= cap and never a single
 * 25-candidate call (which would abstain). M9 promotion is exempt from proximity
 * clustering, but source authors remain isolated.
 */
import { describe, expect, test } from 'vitest';

import type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
} from '../../domain/dip/conflict-resolution-policy.js';
import type { Scope } from '../../domain/scope.js';

import { consolidateInBoundedClusters } from './reflect-consolidation.js';

interface BoundedCandidate extends ConsolidationCandidate {
  readonly embedding?: readonly number[];
}

const SCOPE: Scope = { kind: 'user', userId: 'u1' };

/** 25 candidates in two embedding groups (dim 0 vs dim 1). */
function build25(): BoundedCandidate[] {
  const DIM = 8;
  const out: BoundedCandidate[] = [];
  for (let i = 0; i < 25; i += 1) {
    const v = new Array<number>(DIM).fill(0);
    v[i < 13 ? 0 : 1] = 1;
    out.push({
      memoryId: `m${String(i).padStart(2, '0')}`,
      text: `fact ${String(i)}`,
      createdAt: new Date(),
      embedding: v,
    });
  }
  return out;
}

/** Records the size of every cluster the policy is asked to consolidate. */
function countingPolicy(kind = 'llm-judged-merge'): {
  policy: ConflictResolutionPolicy;
  callSizes: number[];
} {
  const callSizes: number[] = [];
  const policy: ConflictResolutionPolicy = {
    kind,
    consolidate(candidates): Promise<readonly ConflictResolutionResult[]> {
      callSizes.push(candidates.length);
      return Promise.resolve([]);
    },
  };
  return { policy, callSizes };
}

/** Run with a counting policy; return the recorded per-call cluster sizes. */
async function callSizesFor(
  candidates: BoundedCandidate[],
  opts: { scope: Scope; isM9Promotion: boolean; kind?: string },
): Promise<number[]> {
  const { policy, callSizes } = countingPolicy(opts.kind);
  await consolidateInBoundedClusters({
    candidates,
    conflictPolicy: policy,
    scope: opts.scope,
    cap: 20,
    isM9Promotion: opts.isM9Promotion,
  });
  return callSizes;
}

describe('consolidateInBoundedClusters (M24 T3.1)', () => {
  test('splits > cap candidates into bounded clusters — consolidate called per cluster, never once with 25', async () => {
    const callSizes = await callSizesFor(build25(), { scope: SCOPE, isM9Promotion: false });

    expect(callSizes.length).toBeGreaterThanOrEqual(2); // multiple bounded clusters
    expect(callSizes.every((n) => n <= 20)).toBe(true); // never abstains at scale
    expect(callSizes).not.toContain(25); // NOT the whole-scope single call
    expect(callSizes.reduce((a, b) => a + b, 0)).toBe(25); // disjoint, every candidate once
  });

  test('aggregates results across clusters', async () => {
    let calls = 0;
    const policy: ConflictResolutionPolicy = {
      kind: 'llm-judged-merge',
      consolidate(candidates): Promise<readonly ConflictResolutionResult[]> {
        const first = candidates[0];
        if (first === undefined) return Promise.resolve([]);
        calls += 1;
        return Promise.resolve([
          {
            keptMemoryId: first.memoryId,
            rejectedMemoryIds: [],
            reason: 'stub',
            policyName: 'llm-judged-merge',
            originalEpisodeIds: candidates.map((c) => c.memoryId),
          },
        ]);
      },
    };
    const agg = await consolidateInBoundedClusters({
      candidates: build25(),
      conflictPolicy: policy,
      scope: SCOPE,
      cap: 20,
      isM9Promotion: false,
    });
    expect(agg.length).toBe(calls);
    expect(agg.length).toBeGreaterThanOrEqual(2);
  });

  test('M9 promotion is exempt — each speaker whole-scope set is one cluster', async () => {
    const callSizes = await callSizesFor(build25(), {
      scope: { kind: 'session', sessionId: 's1' },
      isM9Promotion: true,
      kind: 'session-to-global',
    });
    expect(callSizes).toEqual([25]); // one whole-scope call — M9 reads the full set
  });

  test('never judges or supersedes candidates across speaker attribution', async () => {
    const seen: (string | undefined)[][] = [];
    const policy: ConflictResolutionPolicy = {
      kind: 'llm-judged-merge',
      consolidate(candidates): Promise<readonly ConflictResolutionResult[]> {
        seen.push(candidates.map((candidate) => candidate.attributedTo));
        return Promise.resolve([]);
      },
    };
    const vector = [1, 0, 0];
    await consolidateInBoundedClusters({
      candidates: [
        { memoryId: 'u1', text: 'user says record 27:12', createdAt: new Date(1), attributedTo: 'user', embedding: vector },
        { memoryId: 'u2', text: 'user repeats record 27:12', createdAt: new Date(2), attributedTo: 'user', embedding: vector },
        { memoryId: 'a1', text: 'assistant claims target 25:50', createdAt: new Date(2), attributedTo: 'assistant', embedding: vector },
        { memoryId: 'a2', text: 'assistant repeats target 25:50', createdAt: new Date(3), attributedTo: 'assistant', embedding: vector },
        { memoryId: 'unknown1', text: 'unattributed claim', createdAt: new Date(3), embedding: vector },
        { memoryId: 'unknown2', text: 'unattributed duplicate', createdAt: new Date(4), embedding: vector },
      ],
      conflictPolicy: policy,
      scope: SCOPE,
      cap: 20,
      isM9Promotion: false,
    });

    expect(seen).toEqual([['user', 'user'], ['assistant', 'assistant'], [undefined, undefined]]);
  });

  test('candidates without embedding degrade to a single whole-scope cluster', async () => {
    const noEmb = build25().map(({ embedding: _e, ...rest }) => rest);
    const callSizes = await callSizesFor(noEmb, { scope: SCOPE, isM9Promotion: false });
    expect(callSizes).toEqual([25]);
  });
});
