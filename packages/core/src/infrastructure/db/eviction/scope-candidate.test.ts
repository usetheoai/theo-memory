import { describe, expect, it } from 'vitest';

import { rowToMemoryItem, type ScopeCandidateRow } from './scope-candidate.js';

/**
 * Unit tests for the shared scope-candidate helper extracted at T6.1
 * (F-arch-3 DRY rule-of-three). Integration tests live under
 * `tests/integration/eviction/` and `tests/integration/forgetting/`
 * (capacity-trigger.test.ts + time-trigger.test.ts + multi-tier-eviction.test.ts)
 * — they exercise `loadCandidates` end-to-end against real pgvector. This
 * file locks the column-precedence rule that `rowToMemoryItem` reconstructs
 * the scope from.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T6.1
 */
describe('rowToMemoryItem — column precedence reproduces write-side scope', () => {
  const baseRow: ScopeCandidateRow = {
    id: 'mem-1',
    text: 'sample',
    hash: 'hash-1',
    user_id: null,
    session_id: null,
    agent_id: null,
    payload: {},
    t_valid: null,
    t_invalid: null,
    created_at: new Date('2026-05-31T00:00:00Z'),
    updated_at: new Date('2026-05-31T00:00:00Z'),
    last_accessed_at: null,
    access_count: 0,
    half_life_seconds: null,
    llm_importance_score: null,
  };

  it('returns AgentScope when only agent_id is set', () => {
    const item = rowToMemoryItem({ ...baseRow, agent_id: 'agent-X' });
    expect(item.scope).toEqual({ kind: 'agent', agentId: 'agent-X' });
  });

  it('returns SessionScope when only session_id is set', () => {
    const item = rowToMemoryItem({ ...baseRow, session_id: 'session-Y' });
    expect(item.scope).toEqual({ kind: 'session', sessionId: 'session-Y' });
  });

  it('returns UserScope when only user_id is set', () => {
    const item = rowToMemoryItem({ ...baseRow, user_id: 'user-Z' });
    expect(item.scope).toEqual({ kind: 'user', userId: 'user-Z' });
  });

  it('prefers agent_id over session_id over user_id at read time', () => {
    const item = rowToMemoryItem({
      ...baseRow,
      user_id: 'u',
      session_id: 's',
      agent_id: 'a',
    });
    expect(item.scope).toEqual({ kind: 'agent', agentId: 'a' });
  });

  it('forwards v0.4b eviction columns (last_accessed_at, access_count, half_life_seconds, llm_importance_score)', () => {
    const accessedAt = new Date('2026-05-30T12:00:00Z');
    const item = rowToMemoryItem({
      ...baseRow,
      agent_id: 'agent-X',
      last_accessed_at: accessedAt,
      access_count: 7,
      half_life_seconds: 86_400,
      llm_importance_score: 0.8,
    });
    expect(item.lastAccessedAt).toEqual(accessedAt);
    expect(item.accessCount).toBe(7);
    expect(item.halfLifeSeconds).toBe(86_400);
    expect(item.llmImportanceScore).toBe(0.8);
  });
});
