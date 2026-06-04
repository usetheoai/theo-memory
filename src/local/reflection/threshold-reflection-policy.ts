/**
 * ThresholdReflectionPolicy — fires reflection every N memories per scope.
 *
 * Per plan v0-4a-reflection-pipeline § T2.1 + ADR D4 (counter table) + ADR D5
 * (per-recall override) + blueprint D8 (the upstream sleeptime_multi_agent_v4.py
 * counter-modular pattern at line 138-146).
 *
 * Behavior:
 *  - shouldReflect bumps the DB counter atomically + returns (count % threshold === 0).
 *  - Counter is per-scope; multi-scope isolation guaranteed by composite-unique index.
 *  - Bumping is fire-and-forget from the policy's perspective: if the orchestrator's
 *    reflect() call fails, the counter has already been incremented — the next
 *    write will bump it past the threshold window (EC-12 absorption).
 *  - Empty scope (no non-empty userId / sessionId / agentId) → EmptyScopeError
 *    BEFORE the SQL round-trip (EC-3 absorption).
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T2.1
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md § D8
 */

import type {
  ReflectionPolicy,
  ReflectionTrigger,
} from '../../core/dip/reflection-policy.js';
import { EmptyScopeError } from '../../core/errors.js';
import type { Scope } from '../../core/scope.js';
import type { PgvectorStore } from '../pgvector-store.js';

export interface ThresholdReflectionPolicyConfig {
  /** Number of memories per scope to cross before shouldReflect returns true. */
  readonly threshold: number;
  /** DB-backed counter store (must implement bumpReflectionCounter). */
  readonly store: Pick<PgvectorStore, 'bumpReflectionCounter'>;
}

/**
 * Project Scope discriminated union onto the three counter columns.
 * Each Scope variant always has its primary ID set; optional userId cross-tier
 * filter on SessionScope/AgentScope is preserved for counter isolation.
 */
function scopeToCounterTuple(scope: Scope): {
  userId: string | null;
  sessionId: string | null;
  agentId: string | null;
} {
  switch (scope.kind) {
    case 'user':
      return { userId: scope.userId, sessionId: null, agentId: null };
    case 'session':
      return {
        userId: scope.userId ?? null,
        sessionId: scope.sessionId,
        agentId: null,
      };
    case 'agent':
      return {
        userId: scope.userId ?? null,
        sessionId: null,
        agentId: scope.agentId,
      };
    case 'repo':
      // v0.6 (EC-4): RepoScope persists `repoId` in the `agent_id` column at the
      // store layer; reflection counter rows mirror that mapping for consistency.
      return {
        userId: null,
        sessionId: null,
        agentId: scope.repoId,
      };
  }
}

function isEmptyTuple(t: {
  userId: string | null;
  sessionId: string | null;
  agentId: string | null;
}): boolean {
  const u = t.userId?.trim() ?? '';
  const s = t.sessionId?.trim() ?? '';
  const a = t.agentId?.trim() ?? '';
  return u === '' && s === '' && a === '';
}

export class ThresholdReflectionPolicy implements ReflectionPolicy {
  readonly kind = 'threshold' as const;

  private readonly threshold: number;
  private readonly store: Pick<PgvectorStore, 'bumpReflectionCounter'>;

  constructor(config: ThresholdReflectionPolicyConfig) {
    if (config.threshold <= 0 || !Number.isInteger(config.threshold)) {
      throw new Error(`ThresholdReflectionPolicy: threshold must be a positive integer; got ${String(config.threshold)}`);
    }
    this.threshold = config.threshold;
    this.store = config.store;
  }

  async shouldReflect(scope: Scope, trigger: ReflectionTrigger): Promise<boolean> {
    void trigger;
    const tuple = scopeToCounterTuple(scope);
    if (isEmptyTuple(tuple)) {
      throw new EmptyScopeError();
    }
    const count = await this.store.bumpReflectionCounter(tuple);
    return count % this.threshold === 0;
  }
}
