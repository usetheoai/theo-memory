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
 * Side-effect collaborator that returns the cosine distance from a memory to
 * its nearest non-self non-invalidated neighbor in the same scope per
 * blueprint D16. Optional — when omitted (e.g., pure-math unit tests), the
 * long-tail multiplier short-circuits to 1.0 (no isolation-based protection
 * adjustment).
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T4.1
 */
export interface NearestNeighborProvider {
  distance(memoryId: string, agentId: string): Promise<number>;
}

/** Max isolation distance when scope has no other memories (singleton fallback). */
const MAX_ISOLATION_DISTANCE = 1;

/** Long-tail multiplier bounds per blueprint D9 — clamp(0.1, 1.0, ratio). */
const MIN_PROTECTION_MULTIPLIER = 0.1;
const MAX_PROTECTION_MULTIPLIER = 1;

/**
 * Extracts the scope identifier used for nearest-neighbor scoping. RepoScope
 * maps to `agent_id` per ADR-0010 / EC-4 absorption from the v0.6 cycle.
 */
function getNeighborScopeId(scope: MemoryItem['scope']): string | null {
  if (scope.kind === 'agent') {
    return scope.agentId;
  }
  if (scope.kind === 'repo') {
    return scope.repoId;
  }
  return null;
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
  private readonly neighborProvider: NearestNeighborProvider | null;

  constructor(
    weights: TriadicWeights = DEFAULT_TRIADIC_WEIGHTS,
    constants: TriadicConstants = DEFAULT_TRIADIC_CONSTANTS,
    halfLifePersister: HalfLifePersister | null = null,
    neighborProvider: NearestNeighborProvider | null = null,
  ) {
    this.weights = normalizeWeights(weights);
    this.constants = constants;
    this.halfLifePersister = halfLifePersister;
    this.neighborProvider = neighborProvider;
  }

  /**
   * v0.4b T4.1 (D9 + D16): nearest-neighbor cosine distance for the long-tail
   * multiplier. Delegates to the injected `NearestNeighborProvider`. When no
   * provider is wired (e.g., pure-math unit tests), returns the max-isolation
   * fallback 1.0 — equivalent to full long-tail protection.
   */
  async nearestNeighborDistance(memoryId: string, agentId: string): Promise<number> {
    if (this.neighborProvider === null) {
      return MAX_ISOLATION_DISTANCE;
    }
    return this.neighborProvider.distance(memoryId, agentId);
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
    const baseScore = this.weights.recency * recency
      + this.weights.frequency * frequency
      + this.weights.importance * importance;
    const multiplier = await this.computeProtectionMultiplier(memory, context);
    return baseScore * multiplier;
  }

  /**
   * v0.4b T4.2 (D9): long-tail protection multiplier
   *   `clamp(0.1, 1.0, isolation_distance / mean_isolation_distance)`
   * applied multiplicatively on top of the additive triadic base score.
   *
   * Plan-prose framing inversion absorbed: T4.2 § Deep Dives line 712 reads
   * "LOWER multiplier = STRONGER protection (lower eviction-score = stays
   * longer)" which assumes an eviction-score convention (LOW = stays). T2.1
   * ships a value-score convention (HIGH = stays). The formula produces
   * correct long-tail protection in EITHER convention — clustered memories
   * get penalized into the victim band; isolated memories survive.
   *
   * Short-circuits to 1.0 (no penalty) when (a) no provider wired AND no
   * cache present, OR (b) mean_isolation_distance <= 0 (no pass-level mean
   * available). selectVictims pre-populates the cache + mean per pass.
   */
  private async computeProtectionMultiplier(
    memory: MemoryItem,
    context: ScoreContext,
  ): Promise<number> {
    if (context.meanIsolationDistance <= 0) {
      return MAX_PROTECTION_MULTIPLIER;
    }
    const cached = context.neighborDistances?.get(memory.id);
    let isolation: number | null = cached ?? null;
    if (isolation === null && this.neighborProvider !== null) {
      const scopeId = getNeighborScopeId(memory.scope);
      if (scopeId === null) {
        return MAX_PROTECTION_MULTIPLIER;
      }
      isolation = await this.neighborProvider.distance(memory.id, scopeId);
    }
    if (isolation === null) {
      return MAX_PROTECTION_MULTIPLIER;
    }
    const ratio = isolation / context.meanIsolationDistance;
    return Math.max(MIN_PROTECTION_MULTIPLIER, Math.min(MAX_PROTECTION_MULTIPLIER, ratio));
  }

  async selectVictims(
    candidates: readonly MemoryItem[],
    fraction: number,
    context: ScoreContext,
  ): Promise<readonly string[]> {
    assertValidFraction(fraction);
    const enrichedContext = await this.maybeCacheNeighborDistances(candidates, context);
    const scored = await Promise.all(
      candidates.map(async (memory) => ({
        id: memory.id,
        score: await this.score(memory, enrichedContext),
      })),
    );
    scored.sort((a, b) => a.score - b.score);
    const victimCount = Math.floor(candidates.length * fraction);
    return scored.slice(0, victimCount).map((s) => s.id);
  }

  /**
   * v0.4b T4.2 § REFACTOR: cache mean_isolation_distance + per-memory
   * distances on ScoreContext so score() reads from the cache instead of
   * re-querying. Net: N nearest-neighbor queries per selectVictims pass
   * (not N² and not 2N).
   *
   * Returns the original context unchanged when (a) caller already provided
   * a meanIsolationDistance (> 0), OR (b) no neighborProvider is wired.
   */
  private async maybeCacheNeighborDistances(
    candidates: readonly MemoryItem[],
    context: ScoreContext,
  ): Promise<ScoreContext> {
    if (context.meanIsolationDistance > 0 || this.neighborProvider === null
        || candidates.length === 0) {
      return context;
    }
    const cache = new Map<string, number>();
    for (const memory of candidates) {
      const scopeId = getNeighborScopeId(memory.scope);
      const isolation = scopeId !== null
        ? await this.neighborProvider.distance(memory.id, scopeId)
        : MAX_ISOLATION_DISTANCE;
      cache.set(memory.id, isolation);
    }
    const distances = [...cache.values()];
    const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    return {
      meanIsolationDistance: mean,
      now: context.now,
      neighborDistances: cache,
    };
  }
}
