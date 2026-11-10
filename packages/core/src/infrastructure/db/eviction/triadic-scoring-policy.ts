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
 */
import {
  assertValidFraction,
  type EvictionPolicy,
  type EvictionResult,
  type HalfLifePersister,
  type NearestNeighborProvider,
  type ScoreContext,
} from '../../../domain/dip/eviction-policy.js';
import type { MemoryItem } from '../../../domain/memory-item.js';
import type { Scope } from '../../../domain/scope.js';

import type { Evictor } from './pg-evictor.js';

// Re-export DIP interfaces for backward compatibility — local code that
// previously imported these from this file continues to compile. New code
// should import directly from `src/core/dip/eviction-policy.js`.
//
// v0.4b-fixes T5.1: closes F-arch-2 by physically relocating the interface
// declarations to the DIP file; this barrel re-export preserves the
// pre-existing public surface (`src/local/eviction/index.ts` + the root
// `@usetheo/memory` re-export chain).
export type { HalfLifePersister, NearestNeighborProvider } from '../../../domain/dip/eviction-policy.js';

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

/** Max isolation distance when scope has no other memories (singleton fallback). */
const MAX_ISOLATION_DISTANCE = 1;

/** Long-tail multiplier bounds per blueprint D9 — clamp(0.1, 1.0, ratio). */
const MIN_PROTECTION_MULTIPLIER = 0.1;
const MAX_PROTECTION_MULTIPLIER = 1;

/**
 * Extracts the scope-tier identifier used for nearest-neighbor scoping.
 *
 * Dispatches on `scope.kind` — the discriminator is authoritative. The function
 * never inspects row columns (it only sees the typed `Scope`); EC-5 absorption
 * locks the rule that when a row has both `user_id='X' AND session_id='Y'`
 * populated (legal — no CHECK constraint forbids it), passing
 * `scope={kind:'session', sessionId:'Y'}` returns `'Y'`, not `'X'`.
 *
 * RepoScope maps to its `repoId` field; the local store column-aliases that
 * id to `agent_id` per ADR-0010 / EC-4 absorption from the v0.6 cycle, so the
 * PgNearestNeighborProvider's WHERE clause uses `m.agent_id = $repoId` for
 * `kind='repo'`.
 *
 * Exported for unit-testing in `__tests__/get-neighbor-scope-id.test.ts`.
 *
 */
export function getNeighborScopeId(scope: Scope): string | null {
  switch (scope.kind) {
    case 'user':
      return scope.userId;
    case 'session':
      return scope.sessionId;
    case 'agent':
      return scope.agentId;
    case 'repo':
      return scope.repoId;
  }
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

/**
 * Options bag for the recommended single-argument TriadicScoringPolicy
 * constructor introduced in v0.4b-fixes T1.1 (closes F-arch-1 CRITICAL,
 * per ADR D5). All fields are optional; omitted fields fall back to the
 * v0.4b defaults (DEFAULT_TRIADIC_WEIGHTS, DEFAULT_TRIADIC_CONSTANTS, null
 * collaborators).
 *
 */
export interface TriadicScoringPolicyOptions {
  readonly weights?: TriadicWeights;
  readonly constants?: TriadicConstants;
  readonly halfLifePersister?: HalfLifePersister | null;
  readonly neighborProvider?: NearestNeighborProvider | null;
  readonly evictor?: Evictor | null;
}

/**
 * Discriminates between TriadicWeights (has `recency`) and other object shapes.
 * Returns false for `null` (typeof null === 'object') to avoid the EC-2 trap.
 */
function isWeightsLike(arg: unknown): arg is TriadicWeights {
  return typeof arg === 'object' && arg !== null && 'recency' in arg;
}

/**
 * Discriminates between TriadicScoringPolicyOptions (object without `recency`)
 * and the deprecated positional TriadicWeights. EC-2 absorption: guards
 * explicitly against `undefined` AND `null` BEFORE the `'recency' in arg` check,
 * because `'recency' in undefined` and `'recency' in null` both throw TypeError.
 */
function isOptionsObject(arg: unknown): arg is TriadicScoringPolicyOptions {
  return typeof arg === 'object' && arg !== null && !('recency' in arg);
}

export class TriadicScoringPolicy implements EvictionPolicy {
  readonly kind = 'triadic' as const;

  private readonly weights: TriadicWeights;
  private readonly constants: TriadicConstants;
  private readonly halfLifePersister: HalfLifePersister | null;
  private readonly neighborProvider: NearestNeighborProvider | null;
  private readonly evictor: Evictor | null;

  /**
   * Recommended single-argument options-object constructor (v0.4b-fixes T1.1).
   * Omitted fields fall back to v0.4b defaults.
   */
  constructor(options: TriadicScoringPolicyOptions);

  /**
   * @deprecated Prefer the options-object form
   *   `new TriadicScoringPolicy({ weights, constants, halfLifePersister,
   *   neighborProvider, evictor })`. The 5-positional signature is preserved
   *   for one release to give existing call sites time to migrate; EC-2
   *   absorption: `undefined` and `null` are accepted as the first positional
   *   arg without TypeError.
   */
  constructor(
    weights?: TriadicWeights | null,
    constants?: TriadicConstants | null,
    halfLifePersister?: HalfLifePersister | null,
    neighborProvider?: NearestNeighborProvider | null,
    evictor?: Evictor | null,
  );

  constructor(
    arg?: TriadicWeights | TriadicScoringPolicyOptions | null,
    constants?: TriadicConstants | null,
    halfLifePersister?: HalfLifePersister | null,
    neighborProvider?: NearestNeighborProvider | null,
    evictor?: Evictor | null,
  ) {
    let resolvedWeights: TriadicWeights;
    let resolvedConstants: TriadicConstants;
    let resolvedPersister: HalfLifePersister | null;
    let resolvedProvider: NearestNeighborProvider | null;
    let resolvedEvictor: Evictor | null;

    if (isOptionsObject(arg)) {
      // Options-object path (the recommended T1.1 shape).
      resolvedWeights = arg.weights ?? DEFAULT_TRIADIC_WEIGHTS;
      resolvedConstants = arg.constants ?? DEFAULT_TRIADIC_CONSTANTS;
      resolvedPersister = arg.halfLifePersister ?? null;
      resolvedProvider = arg.neighborProvider ?? null;
      resolvedEvictor = arg.evictor ?? null;
    } else {
      // Positional path (deprecated). arg is undefined | null | TriadicWeights.
      // EC-2: `isWeightsLike` rejects null/undefined safely.
      resolvedWeights = isWeightsLike(arg) ? arg : DEFAULT_TRIADIC_WEIGHTS;
      resolvedConstants = constants ?? DEFAULT_TRIADIC_CONSTANTS;
      resolvedPersister = halfLifePersister ?? null;
      resolvedProvider = neighborProvider ?? null;
      resolvedEvictor = evictor ?? null;
    }

    this.weights = normalizeWeights(resolvedWeights);
    this.constants = resolvedConstants;
    this.halfLifePersister = resolvedPersister;
    this.neighborProvider = resolvedProvider;
    this.evictor = resolvedEvictor;
  }

  /**
   * v0.4b T6.1 (D17): soft-delete eviction via the injected Evictor. Returns
   * an EvictionResult distinguishing softDeleted (newly invalidated) from
   * alreadyInvalid (idempotent — t_invalid was already set). EC-10: empty
   * input array short-circuits without a SQL roundtrip.
   *
   * When no evictor is wired (e.g., pure-math unit tests), returns an
   * empty result — callers that need real persistence MUST inject one.
   */
  async evict(memoryIds: readonly string[]): Promise<EvictionResult> {
    if (this.evictor === null) {
      return { softDeleted: [], alreadyInvalid: [], errors: [] };
    }
    return this.evictor.evict(memoryIds);
  }

  /**
   * v0.4b T4.1 (D9 + D16): nearest-neighbor cosine distance for the long-tail
   * multiplier. Delegates to the injected `NearestNeighborProvider`. When no
   * provider is wired (e.g., pure-math unit tests), returns the max-isolation
   * fallback 1.0 — equivalent to full long-tail protection.
   */
  async nearestNeighborDistance(
    memoryId: string,
    scope: Scope,
    workspaceId?: string,
  ): Promise<number> {
    if (this.neighborProvider === null) {
      return MAX_ISOLATION_DISTANCE;
    }
    return this.neighborProvider.distance(memoryId, scope, workspaceId);
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
      isolation = await this.neighborProvider.distance(memory.id, memory.scope, context.workspaceId);
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
    const { context: enrichedContext, nearestIds } = await this.maybeCacheNeighborDistances(candidates, context);
    const scored = await Promise.all(
      candidates.map(async (memory) => ({
        id: memory.id,
        score: await this.score(memory, enrichedContext),
      })),
    );
    scored.sort((a, b) => a.score - b.score);
    const victimCount = Math.floor(candidates.length * fraction);
    if (nearestIds === null) {
      return scored.slice(0, victimCount).map((s) => s.id);
    }
    // #240: the multiplier gives every paraphrase of a repeated fact the same low score, so the
    // bottom fraction took all of them and the fact was gone. The pass now never evicts a memory
    // together with its nearest neighbour, in either direction: redundancy costs copies. Among
    // equal scores, memories fewer others are nearest to go first, so a group of copies keeps
    // the one they all point at. Capacity stays a hard bound: if the rule cannot fill the quota,
    // the rest is taken in score order.
    const pointedAt = new Map<string, number>();
    for (const neighbour of nearestIds.values()) pointedAt.set(neighbour, (pointedAt.get(neighbour) ?? 0) + 1);
    const order = [...scored].sort((x, y) => x.score - y.score
      || (pointedAt.get(x.id) ?? 0) - (pointedAt.get(y.id) ?? 0)
      || x.id.localeCompare(y.id));
    const victims = new Set<string>();
    const protectedIds = new Set<string>();
    for (const { id } of order) {
      if (victims.size >= victimCount) break;
      const neighbour = nearestIds.get(id);
      if (protectedIds.has(id) || (neighbour !== undefined && victims.has(neighbour))) continue;
      victims.add(id);
      if (neighbour !== undefined) protectedIds.add(neighbour);
    }
    for (const { id } of order) {
      if (victims.size >= victimCount) break;
      victims.add(id);
    }
    return [...victims];
  }

  /**
   * v0.4b T4.2 § REFACTOR: cache mean_isolation_distance + per-memory
   * distances on ScoreContext so score() reads from the cache instead of
   * re-querying. Net: N nearest-neighbor queries per selectVictims pass
   * (not N² and not 2N).
   *
   * Returns the original context unchanged when (a) caller already provided
   * a meanIsolationDistance (> 0), OR (b) no neighborProvider is wired.
   *
   * When the provider implements `nearest`, the same single query per memory also yields the
   * neighbour's id (`nearestIds`, #240); otherwise `nearestIds` is null.
   */
  private async maybeCacheNeighborDistances(
    candidates: readonly MemoryItem[],
    context: ScoreContext,
  ): Promise<{ readonly context: ScoreContext; readonly nearestIds: ReadonlyMap<string, string> | null }> {
    const provider = this.neighborProvider;
    if (context.meanIsolationDistance > 0 || provider === null
        || candidates.length === 0) {
      return { context, nearestIds: null };
    }
    const cache = new Map<string, number>();
    const nearestIds = provider.nearest === undefined ? null : new Map<string, string>();
    for (const memory of candidates) {
      const scopeId = getNeighborScopeId(memory.scope);
      if (scopeId === null) {
        cache.set(memory.id, MAX_ISOLATION_DISTANCE);
      } else if (provider.nearest !== undefined) {
        const neighbour = await provider.nearest(memory.id, memory.scope, context.workspaceId);
        cache.set(memory.id, neighbour?.distance ?? MAX_ISOLATION_DISTANCE);
        if (neighbour !== null) nearestIds?.set(memory.id, neighbour.id);
      } else {
        cache.set(memory.id, await provider.distance(memory.id, memory.scope, context.workspaceId));
      }
    }
    const distances = [...cache.values()];
    const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    return { nearestIds, context: {
      meanIsolationDistance: mean,
      now: context.now,
      neighborDistances: cache,
      // T3.1: preserve the pass-level workspace so score()'s cache-miss
      // fallback distance query stays workspace-scoped.
      ...(context.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
    } };
  }
}
