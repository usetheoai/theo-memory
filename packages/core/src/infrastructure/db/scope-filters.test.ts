/**
 * M8 (ADR D6) — fast unit contract for `filtersFromScope`, the pure security-critical
 * function that decides whether `user_id` enters the WHERE filter. Runs in the contract
 * suite (no pgvector), closing review finding F-tests-1: the isolation filter shape had
 * only env-gated integration coverage.
 */
import { describe, expect, it } from 'vitest';

import { filtersFromScope } from './scope-filters.js';
import type { Scope } from '../../domain/scope.js';

describe('M8 filtersFromScope — hierarchical (workspace, user[, session|agent]) filter shape', () => {
  // Each row: scope → the EXACT filter object the store composes into its WHERE clause.
  // M8 hierarchical recall (owner decision 2026-07-22): the user tier is GLOBAL-ONLY and the
  // user-bound session tier is SESSION ∪ GLOBAL — expressed via `scopeHierarchy` instead of a
  // plain session_id/agent_id equality.
  const cases: { name: string; scope: Scope; ws?: string; expected: Record<string, unknown> }[] = [
    // GLOBAL: durable user rows only (session_id IS NULL AND agent_id IS NULL) — session/agent excluded.
    { name: 'user scope is global-only', scope: { kind: 'user', userId: 'u' }, ws: 'w', expected: { workspace_id: 'w', user_id: 'u', scopeHierarchy: 'global' } },
    // SESSION ∪ GLOBAL: a user-bound session sees its own rows UNION the user's global rows.
    // session_id STAYS (the WRITE derives the row's column from it); scopeHierarchy drives RECALL.
    { name: 'session scope WITH userId is session union global', scope: { kind: 'session', userId: 'u', sessionId: 's' }, ws: 'w', expected: { workspace_id: 'w', user_id: 'u', session_id: 's', scopeHierarchy: { session: 's' } } },
    // Agent tier is a distinct tier (not part of the global/session hierarchy) — plain equality.
    { name: 'agent scope WITH userId binds composite key', scope: { kind: 'agent', userId: 'u', agentId: 'a' }, ws: 'w', expected: { workspace_id: 'w', user_id: 'u', agent_id: 'a' } },
    // ADR D6 workspace-admin path (Principal.userId null): NO user → NO hierarchy; exact workspace-session.
    { name: 'session scope WITHOUT userId is workspace-scoped (admin path)', scope: { kind: 'session', sessionId: 's' }, ws: 'w', expected: { workspace_id: 'w', session_id: 's' } },
    { name: 'agent scope WITHOUT userId is workspace-scoped (admin path)', scope: { kind: 'agent', agentId: 'a' }, ws: 'w', expected: { workspace_id: 'w', agent_id: 'a' } },
    { name: 'repo scope maps to the agent_id column', scope: { kind: 'repo', repoId: 'r' }, ws: 'w', expected: { workspace_id: 'w', agent_id: 'r' } },
    // Unbound workspace (SDK/unit callers) → store column default applies, workspace_id omitted.
    { name: 'unbound workspace omits workspace_id', scope: { kind: 'session', userId: 'u', sessionId: 's' }, expected: { user_id: 'u', session_id: 's', scopeHierarchy: { session: 's' } } },
  ];

  for (const c of cases) {
    it(`test_${c.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`, () => {
      expect(filtersFromScope(c.scope, c.ws)).toEqual(c.expected);
    });
  }
});
