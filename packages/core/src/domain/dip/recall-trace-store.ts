/**
 * RecallTraceStore DIP — the write-side contract for "accountable forgetting"
 * (Slice 1 / explainable-recall). Persists, per recall, one row per DROPPED
 * candidate (sub-threshold or MMR) with its component-score breakdown, so the
 * negative-space of recall — WHAT was dropped and WHY — becomes queryable.
 *
 * **2 methods total** (within the ADR-0008 method-count cap):
 *   - `record`         — write the dropped-candidate rows for one recall
 *   - `getByRecallId`  — read a recall's trace back by its `recall_id`
 *
 * No `clearExpired` / retention method is part of S1 — retention/rotation is a
 * follow-up (Unresolved Q1; YAGNI per parsimony-ladder.md).
 *
 * **DIP boundary discipline** (architecture.md § 2):
 *   This module lives in `domain/` — ZERO I/O, ZERO imports from
 *   `infrastructure/`. The default impl ships at
 *   `infrastructure/db/recall-trace/pg-recall-trace-store.ts` (T2.1). The
 *   retrieval pipeline (domain) holds only this interface; the concrete pg
 *   store is wired into it at the factory composition root (T4.1).
 *
 * @see plan explainable-recall § Phase 0 / T0.1 + § ADRs (D1/D2/D3)
 * @see blueprint accountable-forgetting § ADR D2
 * @see ADR-0008 (DIP method-count cap)
 */
import { InvalidRecallTraceConfig } from '../errors.js';

/**
 * Why a candidate was excluded from a recall result. The three threshold
 * reasons are distinct because the pipeline drops at two points:
 *   - `semantic_gate`  — dropped at the semantic pre-gate, BEFORE the composite
 *                        is computed (so the row's `composite` is `null`, EC-6).
 *   - `sub_threshold`  — the composite score fell below the threshold.
 *   - `nan`            — the composite came out NaN (degenerate scoring input).
 *   - `mmr_redundant`  — survived the threshold but MMR-diversify did not select
 *                        it (only when `RecallOptions.diversify` is on).
 *   - `superseded_recency` — survived the threshold but a NEWER near-duplicate
 *                        (cosine ≥ τ, higher `createdAt`) superseded it at recall
 *                        time (only when `RecallOptions.recencyCollapse` is on;
 *                        M22 / #141 most-recent-wins collapse). ADD-only safe:
 *                        the row still persists and is `asOf`-recoverable.
 */
export type DropReason =
  | 'semantic_gate'
  | 'sub_threshold'
  | 'nan'
  | 'mmr_redundant'
  | 'superseded_recency';

/**
 * One persisted trace row — a single dropped candidate of a recall.
 *
 * `composite` is `number | null`: `null` for `semantic_gate` drops, where the
 * candidate is discarded before `combineScores` runs, so no composite exists
 * (honest null, not a fabricated 0 — EC-6).
 *
 * The `entity` component carries real signal as of M15 (#122): it is the boost a candidate
 * received for being linked to entities mentioned in the query, already attenuated by
 * `entityBoost()`. A value of `0` now means what it says — no entity of the query is linked
 * to that memory — instead of "the feature is not wired yet", which is what it meant from
 * v0.1 until M15.
 *
 * Two honest caveats when reading it. Memories written before M13 have no extracted
 * entities at all and therefore always score `0` here; `themory reextract` is the
 * remediation. And when the entity store is unreachable the whole query degrades to a zero
 * boost, which is visible as the `entity_boost_degraded` event rather than in this column.
 */
export interface RecallTraceRow {
  /** Correlation id of the recall this drop belongs to (server-minted UUID). */
  readonly recallId: string;
  /** Tenant boundary — the resolved Principal's workspace. */
  readonly workspaceId: string;
  /** The scope key (user/session/agent tier + id) the recall ran under. */
  readonly scopeKey: string;
  /** The dropped candidate's memory id. */
  readonly memoryId: string;
  /** Semantic (cosine) component of the additive score. */
  readonly semantic: number;
  /** BM25 lexical component. */
  readonly bm25: number;
  /** Entity-boost component (uniformly 0 in v0.1 — see interface note). */
  readonly entity: number;
  /** Additive composite in [0, 1]; `null` for `semantic_gate` drops (EC-6). */
  readonly composite: number | null;
  /** The threshold this recall applied. */
  readonly threshold: number;
  /** Why the candidate was dropped. */
  readonly dropReason: DropReason;
  /** When the trace row was written. */
  readonly createdAt: Date;
}

/**
 * The batch written by one recall. The envelope fields (`recallId`,
 * `workspaceId`, `scopeKey`) live ONCE on the batch — never per row (EC-2: no
 * per-row tenant keys). `rows` therefore Omit those + `createdAt` (stamped by
 * the store).
 */
export interface RecallTraceBatch {
  readonly recallId: string;
  readonly workspaceId: string;
  readonly scopeKey: string;
  readonly rows: readonly Omit<
    RecallTraceRow,
    'recallId' | 'workspaceId' | 'scopeKey' | 'createdAt'
  >[];
}

/**
 * Config consumed by `PgRecallTraceStore` (and any future impl). The validator
 * {@link validateRecallTraceStoreConfig} enforces invariants BEFORE
 * construction (fail-fast per error-handling.md).
 */
export interface RecallTraceStoreConfig {
  /**
   * Max rows persisted per recall. Positive integer ≤ {@link MAX_ROWS_PER_RECALL}.
   * The pipeline truncates the dropped set to this value (threaded via
   * `recallTraceContext.maxRows`) and emits `recall_trace_truncated` when it
   * clips (EC-4). Bounds the batch INSERT under the Postgres 65 535 bind-param
   * limit (EC-1). Default {@link DEFAULT_MAX_ROWS_PER_RECALL}.
   */
  readonly maxRowsPerRecall?: number;
  /**
   * explainable-recall M4 (governance) — per-workspace fail-closed opt-out.
   * A workspace listed here writes ZERO trace rows even when the deployment
   * enabled tracing (the write gate returns no trace context). Bounds growth at
   * the source; checked in-memory at the write gate (NO per-recall DB read).
   */
  readonly disabledWorkspaces?: readonly string[];
}

/**
 * Default rows-per-recall cap when the consumer omits `maxRowsPerRecall`.
 */
export const DEFAULT_MAX_ROWS_PER_RECALL = 200;

/**
 * Hard upper bound on `maxRowsPerRecall`. 5000 rows × ~10 columns = 50 000 bind
 * params, comfortably under the Postgres 65 535 limit; a higher cap would make
 * the batch INSERT throw and — being fail-soft (D3) — silently write nothing
 * (EC-1). The validator rejects any configured value above this.
 */
export const MAX_ROWS_PER_RECALL = 5000;

/**
 * 14th DIP. Contract for the S1 recall-trace write surface.
 *
 * Implementations live OUTSIDE `domain/` per DIP boundary discipline.
 */
export interface RecallTraceStore {
  /**
   * Persists the dropped-candidate rows for one recall, keyed by
   * `batch.recallId`. Called once per recall (batched, not per candidate). An
   * empty `batch.rows` is a no-op (no INSERT). Fail-soft is the CALLER's
   * responsibility (the pipeline wraps this per D3) — an impl MAY throw on a
   * genuine store failure.
   */
  record(batch: RecallTraceBatch): Promise<void>;

  /**
   * Returns every trace row for `recallId`, ordered by `createdAt` ascending;
   * an empty array for an unknown id. PURE READ — no side effects.
   */
  getByRecallId(recallId: string, workspaceId: string): Promise<readonly RecallTraceRow[]>;
}

/**
 * explainable-recall M4 (governance) — bounds the `recall_traces` audit log so it
 * does not grow unbounded when tracing is enabled. A periodic, INTERNAL (never
 * tenant-triggered) age-based sweep. Kept SEPARATE from {@link RecallTraceStore}
 * (SRP + the ADR-0008 2-method cap on the store): housekeeping is a distinct
 * concern from read/write.
 *
 */
export interface RecallTraceRetentionPolicy {
  /**
   * Delete every `recall_traces` row whose `created_at` is older than
   * `olderThanSeconds`; returns the number of rows deleted. Age-based only
   * (uniform housekeeping) — cannot selectively target one workspace, so it
   * carries no cross-tenant deletion risk. MUST be race-safe against concurrent
   * writes (implementers use the SERIALIZABLE-retry helper).
   */
  sweep(olderThanSeconds: number): Promise<number>;
}

/**
 * Config validator. Throws {@link InvalidRecallTraceConfig} at factory time
 * (fail-fast per error-handling.md).
 *
 * EC-1: `maxRowsPerRecall` MUST be a positive integer ≤ {@link MAX_ROWS_PER_RECALL}.
 * A bare `<= 0 || > MAX` comparison would let `NaN`, `Infinity`, and non-integer
 * floats through (IEEE-754: `NaN <= 0` and `NaN > MAX` are BOTH `false`) — the
 * same gap {@link InvalidCacheConfig}'s validator guards with `Number.isInteger`.
 *
 * @throws {InvalidRecallTraceConfig} when `maxRowsPerRecall` is not a positive
 *   integer ≤ {@link MAX_ROWS_PER_RECALL}.
 */
export function validateRecallTraceStoreConfig(config: RecallTraceStoreConfig): void {
  if (config.maxRowsPerRecall !== undefined) {
    if (
      !Number.isInteger(config.maxRowsPerRecall) ||
      config.maxRowsPerRecall <= 0 ||
      config.maxRowsPerRecall > MAX_ROWS_PER_RECALL
    ) {
      throw new InvalidRecallTraceConfig(
        `maxRowsPerRecall must be a positive integer <= ${MAX_ROWS_PER_RECALL}; got ${String(
          config.maxRowsPerRecall,
        )}`,
      );
    }
  }
}
