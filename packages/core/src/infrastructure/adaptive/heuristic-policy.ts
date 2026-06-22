/**
 * HeuristicAdaptiveRetrievalPolicy — the key-free default AdaptiveRetrievalPolicy
 * (Roadmap Item 13, ADR D3). Pure in-memory: NO model, NO API key, NO new
 * dependency. Ships behind the `@usetheo/memory/adaptive-local` subpath (ADR D5,
 * bundle isolation).
 *
 *  - `shouldRetrieve` — conservative: returns `{ retrieve: true }` UNLESS the
 *    query (lower-cased, trimmed) exactly matches one of the configured
 *    no-retrieve markers (e.g. greetings / chitchat the consumer knows never
 *    need memory). Default markers list is empty ⇒ always retrieve (safe default).
 *  - `assess` — grade: when the top result's score is below the corrective
 *    floor, recommends `action: 'relax'` with the configured `relaxedThreshold`
 *    so the pipeline re-filters the already-fetched pool at the lower bar
 *    (bounded in-memory corrective; the pipeline applies the EC-1 clamp). When
 *    the pool is empty, recommends `reject` (the pipeline emits low-confidence).
 *    Per-call `tuning` (from `RecallOptions.adaptive`) overrides the construction
 *    config.
 *
 * @see .claude/knowledge-base/plans/adaptive-retrieval-plan.md § ADR D3 + T4.1
 * @see src/domain/dip/adaptive-retrieval-policy.ts
 */
import type {
  AdaptiveRetrievalPolicy,
  AdaptiveTuning,
  RetrievalAssessment,
  RetrievalDecision,
} from '../../domain/dip/adaptive-retrieval-policy.js';
import type { MemoryItemWithScore } from '../../domain/memory-item.js';
import type { Scope } from '../../domain/scope.js';

export interface HeuristicAdaptiveRetrievalPolicyConfig {
  /**
   * Top-score floor below which `assess` recommends a relax. Default `0.5`.
   * A per-call `RecallOptions.adaptive.correctiveFloor` overrides this.
   */
  readonly correctiveFloor?: number;
  /**
   * Lower threshold the corrective re-filters the pool at. Default `0.05`. The
   * pipeline applies the EC-1 clamp (`0 <= relaxedThreshold < threshold`). A
   * per-call `RecallOptions.adaptive.relaxedThreshold` overrides this.
   */
  readonly relaxedThreshold?: number;
  /**
   * Queries (lower-cased + trimmed) that should SKIP retrieval entirely. Default
   * `[]` ⇒ always retrieve (conservative — the consumer opts into skipping).
   */
  readonly noRetrieveMarkers?: readonly string[];
}

const DEFAULT_CORRECTIVE_FLOOR = 0.5;
const DEFAULT_RELAXED_THRESHOLD = 0.05;

export class HeuristicAdaptiveRetrievalPolicy implements AdaptiveRetrievalPolicy {
  private readonly correctiveFloor: number;
  private readonly relaxedThreshold: number;
  private readonly noRetrieveMarkers: ReadonlySet<string>;

  constructor(config: HeuristicAdaptiveRetrievalPolicyConfig = {}) {
    this.correctiveFloor = config.correctiveFloor ?? DEFAULT_CORRECTIVE_FLOOR;
    this.relaxedThreshold = config.relaxedThreshold ?? DEFAULT_RELAXED_THRESHOLD;
    this.noRetrieveMarkers = new Set(
      (config.noRetrieveMarkers ?? []).map((m) => m.toLowerCase().trim()),
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract is async; logic is sync
  async shouldRetrieve(query: string, _scope: Scope): Promise<RetrievalDecision> {
    const normalized = query.toLowerCase().trim();
    if (this.noRetrieveMarkers.has(normalized)) {
      return { retrieve: false, reason: 'matched no-retrieve marker' };
    }
    return { retrieve: true };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract is async; logic is sync
  async assess(
    _query: string,
    results: readonly MemoryItemWithScore[],
    tuning?: AdaptiveTuning,
  ): Promise<RetrievalAssessment> {
    const floor = tuning?.correctiveFloor ?? this.correctiveFloor;
    const relaxedThreshold = tuning?.relaxedThreshold ?? this.relaxedThreshold;
    const top = results[0];
    if (top === undefined) {
      // Nothing retrieved at all — a relax may surface sub-threshold rows.
      return { sufficient: false, action: 'relax', relaxedThreshold, reason: 'empty result set' };
    }
    if (top.score < floor) {
      return {
        sufficient: false,
        action: 'relax',
        relaxedThreshold,
        reason: `top score ${top.score.toFixed(3)} below floor ${floor.toFixed(3)}`,
      };
    }
    return { sufficient: true, action: 'accept' };
  }
}
