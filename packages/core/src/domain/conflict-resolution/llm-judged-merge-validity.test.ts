/**
 * The judge may only invalidate a memory as an older version of the kept one (#237): a rejected
 * memory valid after the kept memory stays current, as the write path refuses it (ADR-0029).
 */
import { describe, expect, it } from 'vitest';

import type { ConsolidationCandidate, ConsolidationContext } from '../dip/conflict-resolution-policy.js';
import type { LLM, LLMResponse, Message } from '../dip/llm.js';

import { LlmJudgedMergeConflictPolicy } from './llm-judged-merge.js';

const ctx: ConsolidationContext = { scope: { kind: 'user', userId: 'alice' }, observationDate: new Date('2026-06-01T16:00:00Z') };
const judge = (response: unknown): LLM => ({
  generateResponse: (_m: readonly Message[]) => Promise.resolve(response),
  generateChat: (): Promise<LLMResponse> => Promise.resolve({ role: 'assistant', content: '' }),
});
const imported = new Date('2026-06-01T12:00:00Z');
const january: ConsolidationCandidate = { memoryId: 'jan', text: 'team has 5 women', createdAt: imported, validFrom: new Date('2023-01-18T00:00:00Z') };
const july: ConsolidationCandidate = { memoryId: 'jul', text: 'team has 6 women', createdAt: imported, validFrom: new Date('2023-07-20T00:00:00Z') };
const march: ConsolidationCandidate = { memoryId: 'mar', text: 'team has 4 women', createdAt: imported, validFrom: new Date('2023-03-01T00:00:00Z') };

describe('LlmJudgedMergeConflictPolicy valid-time guard', () => {
  it('drops a rejection of a memory valid after the kept one', async () => {
    const policy = new LlmJudgedMergeConflictPolicy({ llm: judge({ kept_id: 'jan', rejected_ids: ['jul'], reason: 'jul is an older version' }) });
    expect(await policy.consolidate([january, july], ctx)).toEqual([]);
  });

  it('keeps the rejections of older memories and drops only the newer one', async () => {
    const policy = new LlmJudgedMergeConflictPolicy({ llm: judge({ kept_id: 'mar', rejected_ids: ['jan', 'jul'], reason: 'stale' }) });
    const [result] = await policy.consolidate([january, march, july], ctx);
    expect(result?.keptMemoryId).toBe('mar');
    expect(result?.rejectedMemoryIds).toEqual(['jan']);
  });

  it('accepts the rejection of an older memory', async () => {
    const policy = new LlmJudgedMergeConflictPolicy({ llm: judge({ kept_id: 'jul', rejected_ids: ['jan'], reason: 'jan is stale' }) });
    const [result] = await policy.consolidate([january, july], ctx);
    expect(result?.rejectedMemoryIds).toEqual(['jan']);
  });

  it('falls back to createdAt when a candidate has no validFrom', async () => {
    const older: ConsolidationCandidate = { memoryId: 'a', text: 'x', createdAt: new Date('2026-01-01T00:00:00Z') };
    const newer: ConsolidationCandidate = { memoryId: 'b', text: 'y', createdAt: new Date('2026-02-01T00:00:00Z') };
    const policy = new LlmJudgedMergeConflictPolicy({ llm: judge({ kept_id: 'a', rejected_ids: ['b'], reason: 'b is stale' }) });
    expect(await policy.consolidate([older, newer], ctx)).toEqual([]);
  });
});
