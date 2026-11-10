/**
 * LlmJudgedMergeConflictPolicy — third `ConflictResolutionPolicy` per ADR D2.
 * Single LLM call per cluster; verbatim audit via returned `reason`. EC
 * absorptions: EC-2 (parseConsolidationResponse semantic-validates kept_id
 * ∈ clusterIds + rejected_ids ⊂ clusterIds + kept_id ∉ rejected_ids; null
 * → abstain), EC-4 (counters lazy-resolved via module Map; compresses
 * F-dom-6 / v0.4b T10.1 pattern at pg-evictor.ts:56-75), EC-6 (cluster
 * size > clusterCap default 20 → abstain + cluster_too_large counter; no
 * LLM call). Constructor `{ temperature, seed }` accepted for EC-5 forward
 * compat (T3.3); NOT forwarded today — see ADR-DEFER-LLM-TEMP-SEED.
 *
 * @see src/local/eviction/pg-evictor.ts:56-75 (EC-4 precedent)
 * @see src/llms/openai.ts:89-91 (Cycle 2 EC-10 non_json_response shape)
 */
import { metrics, type Counter } from '@opentelemetry/api';

import type {
  ConflictResolutionPolicy,
  ConflictResolutionResult,
  ConsolidationCandidate,
  ConsolidationContext,
} from '../dip/conflict-resolution-policy.js';
import type { LLM } from '../dip/llm.js';

import { generateConflictMergePrompt } from './prompts.js';

const POLICY_NAME = 'llm-judged-merge' as const;
/**
 * Max candidates the LLM judges in one cluster; above it the policy abstains
 * (no LLM call). Exported so the M24 bounded consolidation loop
 * (`reflect-consolidation.ts`) clusters to the SAME bound — single source of
 * truth, no drift between the abstain threshold and the cluster size.
 */
export const DEFAULT_CLUSTER_CAP = 20;
const CTR = {
  KEPT: 'distillation.consolidation.kept',
  REJECTED: 'distillation.consolidation.rejected',
  ABSTAIN: 'distillation.consolidation.abstain',
  CLUSTER_TOO_LARGE: 'distillation.consolidation.cluster_too_large',
  NEWER_REJECTION_REFUSED: 'distillation.consolidation.newer_rejection_refused',
} as const;

const lazyCounters = new Map<string, Counter>();
function getCounter(name: string): Counter {
  const cached = lazyCounters.get(name);
  if (cached !== undefined) return cached;
  const counter = metrics.getMeter('@usetheo/memory').createCounter(name);
  lazyCounters.set(name, counter);
  return counter;
}

/** @internal Test-only: reset counter cache so the next consolidate() re-resolves metrics.getMeter(). */
export function __resetCounterCacheForTesting(): void {
  lazyCounters.clear();
}

interface ParsedConsolidation {
  readonly kept_id: string;
  readonly rejected_ids: readonly string[];
  readonly reason: string;
}

/** Parses LLM response + EC-2 semantic-validates against cluster ids. Returns null → abstain. */
export function parseConsolidationResponse(
  raw: unknown,
  clusterIds: ReadonlySet<string>,
): ParsedConsolidation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  if ('error' in raw && (raw).error === 'non_json_response') return null;
  const obj = raw as Partial<ParsedConsolidation>;
  if (typeof obj.kept_id !== 'string' || obj.kept_id === '' || !clusterIds.has(obj.kept_id)) return null;
  if (!Array.isArray(obj.rejected_ids) || typeof obj.reason !== 'string') return null;
  for (const id of obj.rejected_ids) {
    if (typeof id !== 'string' || !clusterIds.has(id) || id === obj.kept_id) return null;
  }
  return { kept_id: obj.kept_id, rejected_ids: obj.rejected_ids, reason: obj.reason };
}

/** `temperature` + `seed` accepted for EC-5 forward compat (T3.3); see header ADR-DEFER. */
export interface LlmJudgedMergeConflictPolicyOptions {
  readonly llm: LLM;
  readonly clusterCap?: number;
  readonly temperature?: number;
  readonly seed?: number;
}

export class LlmJudgedMergeConflictPolicy implements ConflictResolutionPolicy {
  readonly kind = POLICY_NAME;
  readonly #llm: LLM;
  readonly #clusterCap: number;

  constructor(options: LlmJudgedMergeConflictPolicyOptions) {
    this.#llm = options.llm;
    this.#clusterCap = options.clusterCap ?? DEFAULT_CLUSTER_CAP;
  }

  async consolidate(
    candidates: readonly ConsolidationCandidate[],
    context: ConsolidationContext,
  ): Promise<readonly ConflictResolutionResult[]> {
    if (candidates.length < 2) return [];
    if (candidates.length > this.#clusterCap) {
      getCounter(CTR.CLUSTER_TOO_LARGE).add(1);
      return [];
    }
    const messages = generateConflictMergePrompt(candidates, context);
    const raw = await this.#llm.generateResponse(messages, { type: 'json' });
    const clusterIds = new Set(candidates.map((c) => c.memoryId));
    const parsed = parseConsolidationResponse(raw, clusterIds);
    if (parsed === null) {
      getCounter(CTR.ABSTAIN).add(1);
      return [];
    }
    // #237: the judge invalidates a memory as an older version of the kept one. A memory that
    // became true after the kept one is not an older version, so its rejection is refused and it
    // stays current, as the write path refuses it (ADR-0029). Each refusal is counted.
    const validFrom = new Map(candidates.map((c) => [c.memoryId, (c.validFrom ?? c.createdAt).getTime()]));
    const keptFrom = validFrom.get(parsed.kept_id)!;
    const rejected = parsed.rejected_ids.filter((id) => validFrom.get(id)! <= keptFrom);
    const refused = parsed.rejected_ids.length - rejected.length;
    if (refused > 0) getCounter(CTR.NEWER_REJECTION_REFUSED).add(refused);
    if (rejected.length === 0) {
      getCounter(CTR.ABSTAIN).add(1);
      return [];
    }
    getCounter(CTR.KEPT).add(1);
    getCounter(CTR.REJECTED).add(rejected.length);
    return [
      {
        keptMemoryId: parsed.kept_id,
        rejectedMemoryIds: rejected,
        reason: parsed.reason,
        policyName: this.kind,
        originalEpisodeIds: candidates.map((c) => c.memoryId),
      },
    ];
  }
}
