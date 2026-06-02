/**
 * BenchmarkRunner — orchestrates a single benchmark cell (one adapter ×
 * one corpus × N queries) for v0.8.
 *
 * Per ADR D1 owns the orchestration: instantiates adapter.add() then
 * iterates adapter.search() + judgePanel.judge() per query, captures
 * OTel spans, computes cost via CostTracker, persists per-question
 * records incrementally, and emits a RunReport at the end.
 *
 * EC-2 absorbed (all-judges-fail policy): the runner tracks consecutive
 * null aggregate-labels from the judge panel; on 3 in a row, it pauses
 * 60 seconds then retries the FAILING query once. If the retry also
 * returns null, the run aborts: partial results (Q0..Q_failing_index)
 * stay persisted and `RunReport.aborted = true` with `abortReason` set.
 * Per v0-8-fixes-cycle-1 T2.1 + ADR D4, the runner does NOT mutate
 * `process.exitCode` — CLI entry-points in `benchmarks/scripts/run-*.ts`
 * translate `report.aborted` to `process.exit()` in their `.then()`
 * callback (per ADR D7). The runner does NOT throw on abort — the
 * caller reads the report + partial file.
 *
 * EC-3 absorbed (PricingTableMiss): cost-tracker throws when adapter
 * model is absent from pricing-table.json; runner catches and persists
 * the per-question record with `pricing_table_miss: true, cost: NaN`.
 * Run continues.
 *
 * EC-9 absorbed (incremental persistence): after each per-question
 * record, the runner overwrites the full results JSON file via
 * `fs.writeFileSync` (atomic-ish, sub-second for ≤500 questions). If the
 * process is killed at Q_K, the file holds Q0..Q_K-1 — never garbage.
 *
 * ADR-DEFER-WIRING-A: first production caller is T5.1 run-longmemeval.ts
 * (currently not shipped; T4.1 integration test stands in for the
 * caller surface).
 *
 * @see plan v1.2 § T4.1 + ADRs D1 + D7 + D8 + EC-2 + EC-3 + EC-9
 */

import { writeFileSync } from 'node:fs';

import type { Tracer } from '@opentelemetry/api';

import type {
  BenchmarkAdapter,
  BenchmarkCorpus,
  BenchmarkQuery,
} from '../../core/dip/benchmark-adapter.js';
import type { LlmJudgePanel } from '../llm-judge/judge-panel.js';
// Drift-T1.1-1: BLEU import removed — natural@8.x dropped BLEU; F1 + judge cover the metric niche.
import { calculateF1Score } from '../metrics/f1.js';

import type { CostTracker } from './cost-tracker.js';
import { withSpan } from './otel-instrumented.js';
import { PricingTableMiss } from './pricing-table-miss.js';
import { aggregate, type PerQueryRecord, type RunAggregate } from './result-aggregator.js';

export interface BenchmarkRunnerConfig {
  readonly adapter: BenchmarkAdapter;
  readonly judgePanel: LlmJudgePanel;
  readonly costTracker: CostTracker;
  readonly tracer: Tracer;
  readonly resultsPath: string;
  readonly retryPauseMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RunReport {
  readonly adapter: string;
  readonly perQuery: readonly PerQueryRecord[];
  readonly aggregate: RunAggregate;
  readonly aborted: boolean;
  readonly abortReason?: string;
}

const DEFAULT_RETRY_PAUSE_MS = 60_000;
const CONSECUTIVE_NULL_LIMIT = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BenchmarkRunner {
  private readonly config: BenchmarkRunnerConfig;
  private readonly retryPauseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: BenchmarkRunnerConfig) {
    this.config = config;
    this.retryPauseMs = config.retryPauseMs ?? DEFAULT_RETRY_PAUSE_MS;
    this.sleep = config.sleep ?? defaultSleep;
  }

  async run(
    corpus: BenchmarkCorpus,
    queries: readonly BenchmarkQuery[],
  ): Promise<RunReport> {
    const adapter = this.config.adapter;
    await withSpan(
      this.config.tracer,
      { adapter: adapter.name, method: 'add' },
      () => adapter.add(corpus),
    );

    const perQuery: PerQueryRecord[] = [];
    let consecutiveNullCount = 0;
    let aborted = false;
    let abortReason: string | undefined;

    for (const query of queries) {
      if (query === undefined) continue;

      const record = await this.runOneQuery(query, adapter);
      perQuery.push(record);
      this.persist(perQuery, false);

      if (record.judgeLabel === null) {
        consecutiveNullCount += 1;
        if (consecutiveNullCount >= CONSECUTIVE_NULL_LIMIT) {
          await this.sleep(this.retryPauseMs);
          const retryRecord = await this.runOneQuery(query, adapter);
          if (retryRecord.judgeLabel === null) {
            aborted = true;
            abortReason = `all-judges-fail policy: ${String(consecutiveNullCount)} consecutive nulls + retry also null at Q${query.questionId}`;
            // v0-8-fixes-cycle-1 T2.1 + ADR D4: library does NOT mutate
            // process.exitCode. The aborted signal flows through RunReport;
            // CLI entry-points in benchmarks/scripts/run-*.ts translate
            // report.aborted to process.exit() in their .then() callback.
            break;
          }
          // retry succeeded — replace the last record with the retry outcome
          perQuery[perQuery.length - 1] = retryRecord;
          this.persist(perQuery, false);
          consecutiveNullCount = 0;
        }
      } else {
        consecutiveNullCount = 0;
      }
    }

    const aggregateResult = aggregate(perQuery);
    const report: RunReport = {
      adapter: adapter.name,
      perQuery,
      aggregate: aggregateResult,
      aborted,
      ...(abortReason !== undefined && { abortReason }),
    };
    this.persistFinal(report);
    return report;
  }

  private async runOneQuery(
    query: BenchmarkQuery,
    adapter: BenchmarkAdapter,
  ): Promise<PerQueryRecord> {
    const searchResult = await withSpan(
      this.config.tracer,
      { adapter: adapter.name, method: 'search', questionId: query.questionId },
      () => adapter.search(query),
      // v0-8-fixes-cycle-1 T2.2 + ADR D5 + EC-8: surface latencyMs +
      // modelUsed as span attributes; coalesce undefined to sentinels
      // (OTel spec rejects undefined attribute values).
      (result) => ({
        'benchmark.latency_ms': result.latencyMs ?? 0,
        'benchmark.model_used': result.modelUsed ?? 'unknown',
      }),
    );

    const panelResult = await this.config.judgePanel.judge({
      questionText: query.questionText,
      goldAnswer: query.goldAnswer,
      generated: searchResult.answer,
    });

    // Drift-T1.1-1: BLEU computation removed; F1 + judge remain.
    const f1 = calculateF1Score(searchResult.answer, query.goldAnswer);

    let cost: number;
    let pricingTableMiss = false;
    try {
      // Drift-T5.1-1: lookup by result.modelUsed (the actual LLM that
      // synthesized the answer), NOT adapter.name. The latter silently
      // fabricated $0 for TheMemory.
      cost = this.config.costTracker.compute(searchResult.tokensUsed, searchResult.modelUsed);
    } catch (err) {
      if (err instanceof PricingTableMiss) {
        cost = Number.NaN;
        pricingTableMiss = true;
      } else {
        throw err;
      }
    }

    return {
      questionId: query.questionId,
      // Drift-T1.1-1: bleu field removed from PerQueryRecord.
      f1,
      judgeLabel: panelResult.aggregateLabel,
      latencyMs: searchResult.latencyMs,
      costUsd: cost,
      pricingTableMiss,
    };
  }

  private persist(records: readonly PerQueryRecord[], final: boolean): void {
    const payload = {
      adapter: this.config.adapter.name,
      perQuery: records,
      final,
      writtenAt: new Date().toISOString(),
    };
    writeFileSync(this.config.resultsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private persistFinal(report: RunReport): void {
    writeFileSync(
      this.config.resultsPath,
      JSON.stringify(
        {
          adapter: report.adapter,
          perQuery: report.perQuery,
          aggregate: report.aggregate,
          aborted: report.aborted,
          abortReason: report.abortReason,
          final: true,
          writtenAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }
}

// Re-export for caller convenience
export { CostTracker } from './cost-tracker.js';
export { PricingTableMiss } from './pricing-table-miss.js';
export { aggregate } from './result-aggregator.js';
export type { PerQueryRecord, RunAggregate } from './result-aggregator.js';
