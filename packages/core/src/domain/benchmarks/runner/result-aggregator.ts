/**
 * Result aggregator for v0.8 benchmark runner.
 *
 * Reads per-question records and emits the run-level summary fields:
 * F1-mean / judge-accuracy / P95-latency-ms / total-cost-usd per the
 * v0.8 published matrix sub-metrics. BLEU is DEFERRED via Drift-T1.1-1
 * (ADR D1 of v0-8-fixes-cycle-1) — natural@8.x removed BLEU; F1 +
 * Exact Match cover the lexical metric niche; LLM-judge covers semantic.
 *
 * NaN-skipping discipline (EC-3): cost values flagged as
 * `pricing_table_miss` carry NaN; aggregator skips NaN entries when
 * computing means. If ALL records are NaN, `total_cost_usd` is reported
 * as null (matrix renderer surfaces as "cost N/A").
 *
 * P95 latency is computed from per-query `latencyMs` reported by the
 * adapter via `SearchResult.latencyMs` (ADR D5 of v0-8-fixes-cycle-1).
 * Per-question OTel spans ALSO carry `latencyMs` + `modelUsed` as
 * attributes so downstream consumers (Grafana, Honeycomb, etc.) can
 * reconstruct the same P95 from spans if they prefer.
 *
 * @see plan v0-8-fixes-cycle-1 § T0.1 (BLEU deferral) + § T2.2 (P95 honesty + span attrs)
 */

import type { JudgeLabel } from '../llm-judge/judge-panel.js';

export interface PerQueryRecord {
  readonly questionId: string;
  // Drift-T1.1-1: bleu field removed (natural@8.x dropped BLEU; see metrics/bleu.ts).
  readonly f1: number;
  readonly judgeLabel: JudgeLabel | null;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly pricingTableMiss: boolean;
}

export interface RunAggregate {
  // Drift-T1.1-1: bleuMean field removed.
  readonly f1Mean: number;
  readonly judgeAccuracy: number;
  readonly p95LatencyMs: number;
  readonly totalCostUsd: number | null;
  readonly perSessionCostUsd: number | null;
  readonly questionCount: number;
  readonly judgeNullCount: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const idx = Math.max(0, Math.min(rank, sorted.length - 1));
  return sorted[idx] ?? 0;
}

export function aggregate(records: readonly PerQueryRecord[]): RunAggregate {
  // Drift-T1.1-1: BLEU mean removed.
  const f1Mean = mean(records.map((r) => r.f1));
  const judgeNullCount = records.filter((r) => r.judgeLabel === null).length;
  const validJudge = records.filter((r) => r.judgeLabel !== null);
  const correctCount = validJudge.filter((r) => r.judgeLabel === 'CORRECT').length;
  const judgeAccuracy = validJudge.length === 0 ? 0 : correctCount / validJudge.length;
  const sortedLatency = [...records.map((r) => r.latencyMs)].sort((a, b) => a - b);
  const p95LatencyMs = percentile(sortedLatency, 95);
  const validCosts = records.filter((r) => !r.pricingTableMiss).map((r) => r.costUsd);
  const totalCostUsd = validCosts.length === 0 ? null : validCosts.reduce((a, b) => a + b, 0);
  const perSessionCostUsd =
    validCosts.length === 0 ? null : (totalCostUsd ?? 0) / validCosts.length;
  return {
    f1Mean,
    judgeAccuracy,
    p95LatencyMs,
    totalCostUsd,
    perSessionCostUsd,
    questionCount: records.length,
    judgeNullCount,
  };
}
