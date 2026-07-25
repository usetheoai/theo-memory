/**
 * T1.3 RED tests for the conflict-merge prompt builder
 * (`generateConflictMergePrompt`) + system prompt (`CONFLICT_MERGE_PROMPT`).
 *
 * Asserts the prompt is structurally correct (system + user messages,
 * candidate ids embedded verbatim) so the LLM judge has the information
 * it needs to return a valid {kept_id, rejected_ids, reason} JSON.
 *
 */
import { describe, expect, test } from 'vitest';

import type { ConsolidationCandidate, ConsolidationContext } from '../dip/conflict-resolution-policy.js';

import {
  CONFLICT_MERGE_PROMPT,
  generateConflictMergePrompt,
} from './prompts.js';

const ctx: ConsolidationContext = {
  scope: { kind: 'user', userId: 'alice' },
  observationDate: new Date('2026-06-01T16:00:00Z'),
};

const fixture: ConsolidationCandidate[] = [
  { memoryId: 'mem-a', text: 'Paulo prefers oat milk', createdAt: new Date('2026-06-01T10:00:00Z') },
  { memoryId: 'mem-b', text: 'Paulo likes milk', createdAt: new Date('2026-06-01T11:00:00Z') },
];

describe('CONFLICT_MERGE_PROMPT + generateConflictMergePrompt (T1.3 / ADR D2)', () => {
  test('CONFLICT_MERGE_PROMPT is a non-empty string mentioning the expected JSON schema', () => {
    expect(typeof CONFLICT_MERGE_PROMPT).toBe('string');
    expect(CONFLICT_MERGE_PROMPT.length).toBeGreaterThan(50);
    expect(CONFLICT_MERGE_PROMPT).toMatch(/kept_id/);
    expect(CONFLICT_MERGE_PROMPT).toMatch(/rejected_ids/);
    expect(CONFLICT_MERGE_PROMPT).toMatch(/reason/);
  });

  test('generateConflictMergePrompt builds [system, user] messages with candidate ids embedded verbatim', () => {
    const messages = generateConflictMergePrompt(fixture, ctx);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe(CONFLICT_MERGE_PROMPT);
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('mem-a');
    expect(messages[1]?.content).toContain('mem-b');
    expect(messages[1]?.content).toContain('Paulo prefers oat milk');
    expect(messages[1]?.content).toContain('Paulo likes milk');
  });

  test('#149: prompt instructs to KEEP distinct facts — only genuine stale duplicates go in rejected_ids', () => {
    // Regression guard. The old prompt said "Pick ONE fact to keep ... and reject the rest",
    // so a clusterByProximity group of DISTINCT facts had its answer-bearing rows superseded
    // (t_invalid) → recall lost them → the harness abstained on every substantive question (#149).
    // The prompt MUST tell the judge that clusters mix distinct facts and to reject ONLY stale
    // duplicates of the same fact/attribute; distinct facts are kept.
    const p = CONFLICT_MERGE_PROMPT.toLowerCase();
    expect(p).toMatch(/distinct/);
    expect(p).toMatch(/stale duplicate|superseded|older|same (attribute|fact|subject)/);
    expect(p).not.toMatch(/reject the rest/);
  });

  test('generateConflictMergePrompt handles empty cluster (returns system+user with no candidates section)', () => {
    const messages = generateConflictMergePrompt([], ctx);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });
});
