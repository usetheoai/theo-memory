/**
 * TriadicScoringPolicy — built-in `EvictionPolicy` for the v0.4b forgetting
 * pipeline. Composes 3 dimensions into an additive weighted score in [0, 1]:
 *
 *   `score = w_r · recency + w_f · frequency + w_i · importance`
 *
 * where weights are normalized to sum=1 at construction (per blueprint D8 —
 * ADDITIVE composition, explicitly NOT multiplicative scoring shape; the
 * rejection of the multiplicative form is the load-bearing decision of D8).
 *
 * Per-dimension semantics:
 * - **recency** = `2^(-Δt/h)` where Δt = seconds since `lastAccessedAt` and
 *   h = `halfLifeSeconds` (lazy-backfilled per D14). Recently-accessed → 1;
 *   long-idle → 0. NULL `lastAccessedAt` → 0 (eviction-favorable, D13).
 * - **frequency** = `ln(1 + access_count) / ln(1 + accessCountNorm)` clamped
 *   to [0, 1]. NULL `accessCount` → 0 (EC-7 absorption).
 * - **importance** = `llmImportanceScore` ∈ [0, 1] (v0.4a contract). NULL →
 *   `importanceDefault` (0.5 neutral).
 *
 * The long-tail multiplier (D9) lands in T4.2 — this file ships the BASE
 * additive sum only. When `meanIsolationDistance = 0` (the T2.1 testing
 * configuration), the multiplier short-circuits to 1.0 so the base math is
 * observable in isolation.
 *
 * Plan T2.1 § Deep Dives line 479 has a sign-error typo (`recency = 1 - 2^(-Δ/h)`)
 * that contradicts the adjacent RED test names (`test_recency_approaches_one_for_just_accessed`
 * + `test_recency_approaches_zero_for_long_idle`). Implemented as
 * `recency = 2^(-Δt/h)` which matches the test names + the blueprint D7
 * retention-probability semantics.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T2.1 (ADR D7 + D8 + D14)
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md § D7 + D8 + D9
 */
import {
  assertValidFraction,
  type EvictionPolicy,
  type ScoreContext,
} from '../../core/dip/eviction-policy.js';
import type { MemoryItem } from '../../core/memory-item.js';

export interface TriadicWeights {
  readonly recency: number;
  readonly frequency: number;
  readonly importance: number;
}

export interface TriadicConstants {
  readonly accessCountNorm: number;
  readonly halfLifeBaseSeconds: number;
  readonly importanceDefault: number;
}

export const DEFAULT_TRIADIC_WEIGHTS: TriadicWeights = {
  recency: 0.4,
  frequency: 0.2,
  importance: 0.4,
};

export const DEFAULT_TRIADIC_CONSTANTS: TriadicConstants = {
  accessCountNorm: 100,
  halfLifeBaseSeconds: 30 * 86400,
  importanceDefault: 0.5,
};

/**
 * Side-effect collaborator that persists a computed `half_life_seconds` back
 * to storage during `score()`. Optional — when omitted (e.g., in pure-math
 * unit tests), `score()` computes on-the-fly without DB I/O. Real-runtime
 * consumers inject a `PgHalfLifePersister` via constructor.
 *
 * EC-1 absorption (plan v1.1): the persister UPDATE is guarded by
 * `WHERE half_life_seconds IS NULL` for idempotency — second scoring of the
 * same row issues no DB mutation. Re-backfill after `llm_importance_score`
 * updates is handled by the DB-layer trigger
 * `memories_reset_half_life_on_importance_update_trg` (migration 0004),
 * NOT by the persister.
 */
export interface HalfLifePersister {
  persist(memoryId: string, halfLifeSeconds: number): Promise<void>;
}

/**
 * EC-6 absorption (plan v1.1 edge-case review): TriadicScoringPolicy
 * constructor rejects weights that sum to zero (degenerate; would make
 * the additive score undefined under normalization).
 */
export class InvalidWeightsError extends Error {
  override readonly name = 'InvalidWeightsError' as const;

  constructor(weights: TriadicWeights, options?: ErrorOptions) {
    super(
      `Invalid triadic weights: ${JSON.stringify(weights)} (must sum to a positive non-zero value)`,
      options,
    );
    Object.setPrototypeOf(this, InvalidWeightsError.prototype);
  }
}

/**
 * Exponential half-life retention probability per blueprint D7.
 *
 * Returns a value in [0, 1] where 1 = just accessed and 0 = infinitely idle.
 * NULL `lastAccessedAt` → 0 (per D13 fail-graceful semantics — a row never
 * recalled is the most eviction-favorable).
 */
export function computeRecency(
  lastAccessedAt: Date | null,
  now: Date,
  halfLifeSeconds: number,
): number {
  if (lastAccessedAt === null) {
    return 0;
  }
  const deltaSeconds = (now.getTime() - lastAccessedAt.getTime()) / 1000;
  return Math.pow(2, -deltaSeconds / halfLifeSeconds);
}

/**
 * Log-bounded access-count component clamped to [0, 1].
 *
 * NULL access_count → 0 (EC-7 absorption: defensive against pre-v0.4b
 * malformed rows). `accessCountNorm` controls the saturation point.
 */
export function computeFrequency(accessCount: number | null, accessCountNorm: number): number {
  const safeCount = accessCount ?? 0;
  if (safeCount <= 0) {
    return 0;
  }
  const raw = Math.log(1 + safeCount) / Math.log(1 + accessCountNorm);
  return Math.min(1, raw);
}

/**
 * Direct passthrough of `llmImportanceScore` with NULL fallback to the
 * neutral default (0.5 per blueprint D14).
 */
export function computeImportance(
  llmImportanceScore: number | null,
  importanceDefault: number,
): number {
  return llmImportanceScore ?? importanceDefault;
}

/**
 * Per-row half-life derivation per blueprint D14 lazy backfill formula:
 *
 *   `h = h_base · (0.1 + 2.9 · importance)`
 *
 * Returns integer seconds (truncated). At `importance = 0`, h = 0.1·h_base
 * (eviction-favorable); at `importance = 1`, h = 3·h_base (retention-favorable).
 */
export function computeHalfLifeSeconds(importance: number, halfLifeBaseSeconds: number): number {
  return Math.floor(halfLifeBaseSeconds * (0.1 + 2.9 * importance));
}

function normalizeWeights(raw: TriadicWeights): TriadicWeights {
  const sum = raw.recency + raw.frequency + raw.importance;
  if (sum <= 0 || Number.isNaN(sum)) {
    throw new InvalidWeightsError(raw);
  }
  return {
    recency: raw.recency / sum,
    frequency: raw.frequency / sum,
    importance: raw.importance / sum,
  };
}

export class TriadicScoringPolicy implements EvictionPolicy {
  readonly kind = 'triadic' as const;

  private readonly weights: TriadicWeights;
  private readonly constants: TriadicConstants;
  private readonly halfLifePersister: HalfLifePersister | null;

  constructor(
    weights: TriadicWeights = DEFAULT_TRIADIC_WEIGHTS,
    constants: TriadicConstants = DEFAULT_TRIADIC_CONSTANTS,
    halfLifePersister: HalfLifePersister | null = null,
  ) {
    this.weights = normalizeWeights(weights);
    this.constants = constants;
    this.halfLifePersister = halfLifePersister;
  }

  async score(memory: MemoryItem, context: ScoreContext): Promise<number> {
    const importance = computeImportance(
      memory.llmImportanceScore ?? null,
      this.constants.importanceDefault,
    );
    let halfLife = memory.halfLifeSeconds ?? null;
    if (halfLife === null) {
      halfLife = computeHalfLifeSeconds(importance, this.constants.halfLifeBaseSeconds);
      if (this.halfLifePersister !== null) {
        await this.halfLifePersister.persist(memory.id, halfLife);
      }
    }
    const recency = computeRecency(memory.lastAccessedAt ?? null, context.now, halfLife);
    const frequency = computeFrequency(memory.accessCount ?? 0, this.constants.accessCountNorm);
    return this.weights.recency * recency
      + this.weights.frequency * frequency
      + this.weights.importance * importance;
  }

  async selectVictims(
    candidates: readonly MemoryItem[],
    fraction: number,
    context: ScoreContext,
  ): Promise<readonly string[]> {
    assertValidFraction(fraction);
    const scored = await Promise.all(
      candidates.map(async (memory) => ({ id: memory.id, score: await this.score(memory, context) })),
    );
    scored.sort((a, b) => a.score - b.score);
    const victimCount = Math.floor(candidates.length * fraction);
    return scored.slice(0, victimCount).map((s) => s.id);
  }
}
