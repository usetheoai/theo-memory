/**
 * EvictionPolicy DIP — strategy for triadic-scored automated forgetting with
 * long-tail preservation. The 8th DIP per plan v0-4b-forgetting-pipeline ADR D12
 * (v1.2 — count corrected from 7 to 8 after v0.6 introduced a since-removed
 * skill-representation DIP, since deleted as YAGNI per ADR-0017-era cleanup).
 *
 * INDEPENDENT of ADR-0008's locked 5 DIPs — adding a NEW DIP does not change
 * the locked method counts of the original five. Method count of this NEW DIP:
 * 2 required (`score`, `selectVictims`) + 2 optional lifecycle hooks
 * (`onEvictionStart`, `onEvictionEnd`) + 1 `kind` discriminator. Total 4 method
 * entries.
 *
 * v0.4b ships ONE built-in implementation: `TriadicScoringPolicy` at
 * `src/core/eviction/triadic-scoring.ts` (T2.1) combining 3 dimensions
 * (exponential half-life decay per blueprint D7, LRU/LFU access bookkeeping,
 * REUSED `llm_importance_score` from v0.4a) WITH a long-tail protection
 * multiplier per blueprint D9. ADDITIVE base score composition per blueprint D8
 * (explicitly rejects multiplicative shape).
 *
 * Pure types — ZERO runtime impl in `src/core/`. Per `architecture.md § 3`,
 * this file MUST NOT import from `src/local/` or `src/cloud/`.
 *
 */
import type { MemoryItem } from '../memory-item.js';
import type { Scope } from '../scope.js';

/**
 * Per-scope scoring context — carries the deterministic inputs the policy
 * needs that are NOT properties of the individual memory being scored.
 *
 * `meanIsolationDistance` feeds the long-tail multiplier per blueprint D9:
 * `clamp(0.1, 1.0, isolation_distance / mean_isolation_distance)`. Computed
 * once per scoring batch by the consumer (single nearest-neighbor query per
 * blueprint D16 + plan T4.1) and passed in here so individual `score()` calls
 * stay pure.
 *
 * `now` is the reference timestamp for the exponential time-decay component
 * per blueprint D7 (`p = 2^(-Δt/h)` where `Δt = now - memory.lastAccessedAt`).
 * Passed by the consumer so test fixtures can pin a deterministic clock.
 */
export interface ScoreContext {
  readonly meanIsolationDistance: number;
  readonly now: Date;
  /**
   * Optional per-memory isolation-distance cache populated by
   * `selectVictims()` once per pass per blueprint D9 + T4.2 § REFACTOR
   * (cache mean_isolation_distance on ScoreContext). Each entry maps
   * `memoryId -> cosine distance to nearest non-self non-invalidated
   * neighbor in scope`. When present, `score()` reads from this cache
   * to compute the long-tail multiplier without re-querying. When
   * absent (e.g., direct `score()` calls from tests), `score()` falls
   * back to `neighborProvider.distance(...)` or skips the multiplier.
   */
  readonly neighborDistances?: ReadonlyMap<string, number>;
  /**
   * multi-tenant-rbac-and-slice1-completion T3.1 (Slice 1 100%): the workspace
   * the eviction pass is bound to. Threaded into `neighborProvider.distance(...)`
   * so the long-tail isolation metric is computed against same-workspace
   * neighbors only — a ws-B memory never influences which ws-A row is evicted.
   * Undefined for legacy single-tenant passes (distance falls back to the
   * `workspace_id NOT NULL DEFAULT 'default'` column bound).
   */
  readonly workspaceId?: string;
}

/**
 * Result of an eviction batch. Distinguishes the three terminal states per
 * row so consumers can audit + reconcile partial failures without losing
 * row-level granularity.
 *
 * `softDeleted`: rows whose `t_invalid` UPDATE succeeded this batch.
 * `alreadyInvalid`: no-ops because the row already had `t_invalid` (idempotent).
 * `errors`: transient per-row SQL failures (caller decides retry/escalation).
 */
export interface EvictionResult {
  readonly softDeleted: readonly string[];
  readonly alreadyInvalid: readonly string[];
  readonly errors: readonly { readonly memoryId: string; readonly cause: Error }[];
}

/**
 * 8th DIP — strategy for deciding what to evict + when.
 *
 * `kind` discriminator: identifies the policy variant for telemetry +
 * downstream conditional wiring (e.g., the local runtime auto-fire path
 * only invokes `onEvictionStart` for kinds that opt-in).
 *
 * Required methods (2):
 * - `score(memory, context)` — pure scoring function, returns number in [0, 1].
 *   Higher score = MORE VALUABLE (less likely to be evicted). Long-tail
 *   multiplier per blueprint D9 is applied INSIDE score, so the consumer
 *   doesn't need to compose it.
 * - `selectVictims(candidates, fraction, context)` — picks the bottom-fraction
 *   of candidates by score. Throws `InvalidFractionError` (EC-5) for
 *   `fraction < 0`, `fraction > 1`, or `NaN`.
 *
 * Optional lifecycle hooks (2):
 * - `onEvictionStart(scope, fraction)` — called by the runtime BEFORE the
 *   eviction batch begins. Policy may emit telemetry, log warnings, or
 *   refuse via thrown error.
 * - `onEvictionEnd(scope, result)` — called AFTER the batch (success or
 *   failure). Receives the `EvictionResult` on success or `Error` on failure.
 */
export interface EvictionPolicy {
  readonly kind: string;

  score(memory: MemoryItem, context: ScoreContext): Promise<number>;

  selectVictims(
    candidates: readonly MemoryItem[],
    fraction: number,
    context: ScoreContext,
  ): Promise<readonly string[]>;

  onEvictionStart?(scope: Scope, fraction: number): Promise<void>;

  onEvictionEnd?(scope: Scope, result: EvictionResult | Error): Promise<void>;
}

/**
 * EC-5 absorption (plan v1.1 edge-case review): selectVictims rejects
 * fraction outside [0, 1] OR NaN with this typed error class.
 *
 * Follows the `Object.setPrototypeOf` pattern from `src/core/errors.ts`
 * so `instanceof` survives ESM/CJS boundary + dynamic imports.
 */
export class InvalidFractionError extends Error {
  override readonly name = 'InvalidFractionError' as const;

  constructor(fraction: number, options?: ErrorOptions) {
    super(
      `Invalid eviction fraction: ${String(fraction)} (must be in [0, 1])`,
      options,
    );
    Object.setPrototypeOf(this, InvalidFractionError.prototype);
  }
}

/**
 * Runtime fraction-range guard. Throws `InvalidFractionError` for any value
 * outside [0, 1] inclusive OR NaN. Used by every `EvictionPolicy.selectVictims`
 * implementation to enforce the EC-5 contract at the DIP boundary.
 */
export function assertValidFraction(fraction: number): void {
  if (Number.isNaN(fraction) || fraction < 0 || fraction > 1) {
    throw new InvalidFractionError(fraction);
  }
}

/**
 * Side-effect collaborator that persists a computed `half_life_seconds` back
 * to storage during `EvictionPolicy.score()`. Optional — when omitted (e.g.,
 * in pure-math unit tests), `score()` computes on-the-fly without DB I/O.
 * Real-runtime consumers inject a `PgHalfLifePersister` via the policy
 * constructor.
 *
 * EC-1 absorption (plan v1.1): the persister UPDATE is guarded by
 * `WHERE half_life_seconds IS NULL` for idempotency — second scoring of the
 * same row issues no DB mutation. Re-backfill after `llm_importance_score`
 * updates is handled by the DB-layer trigger
 * `memories_reset_half_life_on_importance_update_trg` (migration 0004),
 * NOT by the persister.
 *
 * v0.4b-fixes T5.1: relocated from `src/local/eviction/triadic-scoring-policy.ts`
 * to live next to its DIP siblings per architecture.md § 3 (the concrete
 * `TriadicScoringPolicy` depends on the abstraction; the abstraction must NOT
 * live with the concrete). Closes F-arch-2 MAJOR.
 *
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
 * v0.4b-fixes T5.1: relocated from `src/local/eviction/triadic-scoring-policy.ts`
 * to live next to its DIP siblings per architecture.md § 3 (F-arch-2 closure).
 *
 */
export interface NearestNeighborProvider {
  /**
   * Returns the cosine distance from `memoryId` to its nearest non-self
   * non-invalidated neighbor in the same scope.
   *
   * Widened in v0.4b-fixes T3.1 from `agentId: string` to the full `Scope`
   * union so triggers + multiplier operate on User/Session/Agent/Repo tiers
   * uniformly. Implementations dispatch on `scope.kind` to pick the column
   * predicate (user_id / session_id / agent_id).
   */
  distance(memoryId: string, scope: Scope, workspaceId?: string): Promise<number>;

  /**
   * The nearest non-self non-invalidated neighbour in the same scope, with its cosine distance,
   * or null when the scope holds no other live memory. Optional: when a provider implements it,
   * `TriadicScoringPolicy.selectVictims` never evicts a memory together with its nearest
   * neighbour in one pass, so a repeated fact loses copies instead of every copy (#240). A
   * provider without it keeps the plain bottom-fraction selection.
   */
  nearest?(memoryId: string, scope: Scope, workspaceId?: string): Promise<NearestNeighbor | null>;
}

/** A memory's nearest neighbour in scope, as returned by `NearestNeighborProvider.nearest`. */
export interface NearestNeighbor {
  readonly id: string;
  readonly distance: number;
}
