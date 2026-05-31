import { describe, expect, it } from 'vitest';
import { getNeighborScopeId } from '../triadic-scoring-policy.js';
import type { Scope } from '../../../core/scope.js';

/**
 * EC-5 absorption (plan v1.1 edge-case review): `getNeighborScopeId` dispatches
 * on `scope.kind` — the function only sees the typed Scope discriminator, never
 * row columns. When a memory row has both `user_id='X' AND session_id='Y'` set
 * (legal — no CHECK constraint forbids it), passing `scope={kind:'session', sessionId:'Y'}`
 * MUST return `'Y'`, not `'X'`. The kind is authoritative; the columns are derived.
 *
 * Plan T3.1 § TDD row #6 declared this as integration ("seed row + assert"); per
 * SEPA iter 4 pre-RED CRITICAL: the function is pure and DB-independent, so the
 * unit shape is more honest. The integration test in
 * `tests/integration/eviction/multi-tier-eviction.test.ts` exercises the end-to-end
 * multi-tier path; this file locks the unit contract.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T3.1 (line 418)
 * @see .claude/knowledge-base/reviews/v0-4b-fixes-cycle-edge-cases-2026-05-30.md § EC-5
 */
describe('getNeighborScopeId — kind-authoritative dispatch', () => {
  it('returns userId for UserScope', () => {
    const scope: Scope = { kind: 'user', userId: 'alice' };
    expect(getNeighborScopeId(scope)).toBe('alice');
  });

  it('returns sessionId for SessionScope', () => {
    const scope: Scope = { kind: 'session', sessionId: 'sess-42' };
    expect(getNeighborScopeId(scope)).toBe('sess-42');
  });

  it('returns sessionId for SessionScope even when userId is pinned (cross-tier filter)', () => {
    // EC-5: `scope.kind` is the authoritative discriminator. SessionScope may
    // optionally carry a `userId` pin (cross-tier filter) — the multiplier
    // scopes NN search by session, never by the pinned user.
    const scope: Scope = { kind: 'session', sessionId: 'sess-mixed', userId: 'pinned-user' };
    expect(getNeighborScopeId(scope)).toBe('sess-mixed');
  });

  it('returns agentId for AgentScope', () => {
    const scope: Scope = { kind: 'agent', agentId: 'agent-xyz' };
    expect(getNeighborScopeId(scope)).toBe('agent-xyz');
  });

  it('returns repoId for RepoScope (v0.6)', () => {
    const scope: Scope = { kind: 'repo', repoId: 'repo-demo' };
    expect(getNeighborScopeId(scope)).toBe('repo-demo');
  });
});
