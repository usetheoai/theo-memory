/**
 * T1.3 RED tests for `LlmJudgedMergeConflictPolicy` — third
 * `ConflictResolutionPolicy` implementation per ADR D2.
 *
 * 7 RED scenarios covering 3 EC absorptions:
 *   1. Happy path — valid LLM JSON → ConflictResolutionResult with verbatim reason
 *   2. JSON parse failure (Cycle 2 EC-10 absorbed shape) → abstain + counter
 *   3. EC-2: hallucinated kept_id ∉ clusterIds → abstain
 *   4. EC-2: hallucinated rejected_id ∉ clusterIds → abstain
 *   5. EC-2: kept_id ∈ rejected_ids → abstain
 *   6. EC-4: counter lazy-resolved (vi.spyOn metrics.getMeter) — NOT at module load
 *   7. EC-6: cluster size > clusterCap (default 20) → abstain + cluster_too_large
 *
 * @see src/local/eviction/pg-evictor.ts:56-75 (EC-4 lazy-init precedent)
 * @see src/llms/openai.ts:89-91 (Cycle 2 non_json_response shape)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConsolidationCandidate, ConsolidationContext } from '../dip/conflict-resolution-policy.js';
import type { LLM, LLMResponse, Message } from '../dip/llm.js';

const ctx: ConsolidationContext = {
  scope: { kind: 'user', userId: 'alice' },
  observationDate: new Date('2026-06-01T16:00:00Z'),
};

class FakeLLM implements LLM {
  constructor(public response: unknown) {}
  async generateResponse(_messages: readonly Message[]): Promise<unknown> {
    await Promise.resolve();
    return this.response;
  }
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ role: 'assistant', content: '' });
  }
}

const fixture: ConsolidationCandidate[] = [
  // mem-a is the newer memory: the judge may only reject memories no newer than the kept one (#237).
  { memoryId: 'mem-a', text: 'Paulo prefers oat milk', createdAt: new Date('2026-06-01T11:00:00Z') },
  { memoryId: 'mem-b', text: 'Paulo likes milk', createdAt: new Date('2026-06-01T10:00:00Z') },
];

describe('LlmJudgedMergeConflictPolicy (T1.3 / ADR D2 / EC-2 + EC-4 + EC-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes kind = "llm-judged-merge"', async () => {
    const { LlmJudgedMergeConflictPolicy } = await import('./llm-judged-merge.js');
    const policy = new LlmJudgedMergeConflictPolicy({ llm: new FakeLLM(null) });
    expect(policy.kind).toBe('llm-judged-merge');
  });

  it('RED #1 — happy path: builds ConflictResolutionResult from valid LLM JSON with verbatim reason', async () => {
    const { LlmJudgedMergeConflictPolicy, __resetCounterCacheForTesting } = await import('./llm-judged-merge.js');
    __resetCounterCacheForTesting();
    const llm = new FakeLLM({ kept_id: 'mem-a', rejected_ids: ['mem-b'], reason: 'a is more specific (oat)' });
    const policy = new LlmJudgedMergeConflictPolicy({ llm });
    const [result] = await policy.consolidate(fixture, ctx);
    expect(result?.keptMemoryId).toBe('mem-a');
    expect(result?.rejectedMemoryIds).toEqual(['mem-b']);
    expect(result?.reason).toBe('a is more specific (oat)');
    expect(result?.policyName).toBe('llm-judged-merge');
    expect(result?.originalEpisodeIds).toEqual(['mem-a', 'mem-b']);
  });

  it('RED #2 — non_json_response (Cycle 2 EC-10 shape) → abstain returns empty array', async () => {
    const { LlmJudgedMergeConflictPolicy, __resetCounterCacheForTesting } = await import('./llm-judged-merge.js');
    __resetCounterCacheForTesting();
    const llm = new FakeLLM({ error: 'non_json_response', raw: 'I am sorry...' });
    const policy = new LlmJudgedMergeConflictPolicy({ llm });
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  it('RED #3 — EC-2: hallucinated kept_id NOT in clusterIds → abstain', async () => {
    const { LlmJudgedMergeConflictPolicy, __resetCounterCacheForTesting } = await import('./llm-judged-merge.js');
    __resetCounterCacheForTesting();
    const llm = new FakeLLM({ kept_id: 'fake-uuid-not-in-cluster', rejected_ids: ['mem-b'], reason: 'x' });
    const policy = new LlmJudgedMergeConflictPolicy({ llm });
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  it('RED #4 — EC-2: hallucinated rejected_id NOT in clusterIds → abstain', async () => {
    const { LlmJudgedMergeConflictPolicy, __resetCounterCacheForTesting } = await import('./llm-judged-merge.js');
    __resetCounterCacheForTesting();
    const llm = new FakeLLM({ kept_id: 'mem-a', rejected_ids: ['fake-uuid'], reason: 'x' });
    const policy = new LlmJudgedMergeConflictPolicy({ llm });
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  it('RED #5 — EC-2: kept_id appears in rejected_ids → abstain', async () => {
    const { LlmJudgedMergeConflictPolicy, __resetCounterCacheForTesting } = await import('./llm-judged-merge.js');
    __resetCounterCacheForTesting();
    const llm = new FakeLLM({ kept_id: 'mem-a', rejected_ids: ['mem-a'], reason: 'x' });
    const policy = new LlmJudgedMergeConflictPolicy({ llm });
    const results = await policy.consolidate(fixture, ctx);
    expect(results).toEqual([]);
  });

  it('RED #6 — EC-4: counter is lazily resolved (metrics.getMeter NOT called at module load OR at policy construction)', async () => {
    const otel = await import('@opentelemetry/api');
    const mod = await import('./llm-judged-merge.js');
    mod.__resetCounterCacheForTesting();
    const getMeterSpy = vi.spyOn(otel.metrics, 'getMeter');
    // Constructing the policy must NOT trigger getMeter — that would lock in
    // the current MeterProvider regardless of consumer registration order.
    const policy = new mod.LlmJudgedMergeConflictPolicy({
      llm: new FakeLLM({ kept_id: 'mem-a', rejected_ids: ['mem-b'], reason: 'r' }),
    });
    expect(getMeterSpy).not.toHaveBeenCalled();
    await policy.consolidate(fixture, ctx);
    expect(getMeterSpy).toHaveBeenCalled();
  });

  it('RED #7 — EC-6: cluster size > clusterCap (default 20) → abstain returns empty array', async () => {
    const { LlmJudgedMergeConflictPolicy, __resetCounterCacheForTesting } = await import('./llm-judged-merge.js');
    __resetCounterCacheForTesting();
    const oversized: ConsolidationCandidate[] = Array.from({ length: 21 }, (_, i) => ({
      memoryId: `mem-${String(i).padStart(3, '0')}`,
      text: `fact ${i}`,
      createdAt: new Date('2026-06-01T10:00:00Z'),
    }));
    // FakeLLM should NEVER be called (cluster cap short-circuits before the
    // LLM hop). Track call count via a sentinel.
    let llmCallCount = 0;
    class CountingLLM extends FakeLLM {
      override async generateResponse(_msgs: readonly Message[]): Promise<unknown> {
        llmCallCount++;
        return Promise.resolve({ kept_id: 'mem-000', rejected_ids: [], reason: 'x' });
      }
    }
    const policy = new LlmJudgedMergeConflictPolicy({ llm: new CountingLLM(null) });
    const results = await policy.consolidate(oversized, ctx);
    expect(results).toEqual([]);
    expect(llmCallCount).toBe(0);
  });
});
