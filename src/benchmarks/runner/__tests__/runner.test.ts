/**
 * T4.1 tests: BenchmarkRunner + CostTracker + ResultAggregator + PricingTableMiss.
 *
 * @see plan v1.2 § T4.1 + EC-2 + EC-3 + EC-9 + EC-11 + EC-13
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  AddMetrics,
  BenchmarkAdapter,
  BenchmarkCorpus,
  BenchmarkQuery,
  SearchResult,
} from '../../../core/dip/benchmark-adapter.js';
import { LlmJudgePanel } from '../../llm-judge/judge-panel.js';
import { CannedResponseLlm } from '../../llm-judge/__tests__/_test-llm.js';
import type { Tokenizer } from '../../themory/adapter.js';
import { BenchmarkRunner } from '../benchmark-runner.js';
import { CostTracker } from '../cost-tracker.js';
import { PricingTableMiss } from '../pricing-table-miss.js';
import { aggregate, type PerQueryRecord } from '../result-aggregator.js';

const TMP_DIR = join(tmpdir(), `themem-t4-1-${String(Date.now())}`);

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

const tokenizer: Tokenizer = {
  count: (s: string) => Math.ceil(s.length / 4),
};

function makeAdapter(name: string, modelUsed = 'gpt-4o-mini', latencyMs = 5): BenchmarkAdapter {
  return {
    name,
    async add(_corpus: BenchmarkCorpus): Promise<AddMetrics> {
      return Promise.resolve({ itemCount: 0, latencyMs });
    },
    async search(query: BenchmarkQuery): Promise<SearchResult> {
      return Promise.resolve({
        answer: `${query.questionText} answered`,
        retrievedContext: [],
        latencyMs,
        tokensUsed: { prompt: 100, completion: 50 },
        modelUsed,
      });
    },
  };
}

function makeJudgePanelAlwaysCorrect(): LlmJudgePanel {
  return new LlmJudgePanel([
    { name: 'gpt-4o', llm: new CannedResponseLlm('{"label":"CORRECT","reasoning":"r"}') },
  ]);
}

function makeJudgePanelAlwaysNull(): LlmJudgePanel {
  return new LlmJudgePanel([
    { name: 'gpt-4o', llm: new CannedResponseLlm('not parseable') },
  ]);
}

function makeTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return { tracer: provider.getTracer('t4-1-test'), exporter };
}

describe('CostTracker', () => {
  it('computes cost for a known model', () => {
    const tracker = new CostTracker({ tokenizer });
    const cost = tracker.compute({ prompt: 1000, completion: 1000 }, 'gpt-4o-mini');
    // gpt-4o-mini: input 0.000150/1k, output 0.000600/1k
    // 1k prompt * 0.000150 + 1k completion * 0.000600 = 0.00015 + 0.0006 = 0.00075
    expect(cost).toBeCloseTo(0.00075, 6);
  });

  it('returns 0 on zero tokens (EC-11)', () => {
    const tracker = new CostTracker({ tokenizer });
    expect(tracker.compute({ prompt: 0, completion: 0 }, 'gpt-4o-mini')).toBe(0);
  });

  it('throws PricingTableMiss for unknown model (EC-3)', () => {
    const tracker = new CostTracker({ tokenizer });
    expect(() => tracker.compute({ prompt: 100, completion: 50 }, 'unknown-model')).toThrow(
      PricingTableMiss,
    );
  });

  it('exposes fetched_at for sunset auditing (EC-13)', () => {
    const tracker = new CostTracker({ tokenizer });
    expect(tracker.fetchedAt()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ResultAggregator', () => {
  it('computes F1 mean + judge accuracy + P95 latency + total cost (Drift-T1.1-1: no BLEU)', () => {
    const records: PerQueryRecord[] = [
      {
        questionId: 'q1',
        f1: 0.6,
        judgeLabel: 'CORRECT',
        latencyMs: 100,
        costUsd: 0.01,
        pricingTableMiss: false,
      },
      {
        questionId: 'q2',
        f1: 0.8,
        judgeLabel: 'CORRECT',
        latencyMs: 200,
        costUsd: 0.02,
        pricingTableMiss: false,
      },
      {
        questionId: 'q3',
        f1: 0.4,
        judgeLabel: 'WRONG',
        latencyMs: 1000,
        costUsd: 0.05,
        pricingTableMiss: false,
      },
    ];
    const agg = aggregate(records);
    expect(agg.f1Mean).toBeCloseTo(0.6);
    expect(agg.judgeAccuracy).toBeCloseTo(2 / 3);
    expect(agg.p95LatencyMs).toBe(1000);
    expect(agg.totalCostUsd).toBeCloseTo(0.08);
    expect(agg.questionCount).toBe(3);
  });

  it('reports totalCostUsd as null when ALL records are pricing_table_miss (EC-3)', () => {
    const records: PerQueryRecord[] = [
      {
        questionId: 'q1',
        f1: 0,
        judgeLabel: 'CORRECT',
        latencyMs: 100,
        costUsd: Number.NaN,
        pricingTableMiss: true,
      },
    ];
    const agg = aggregate(records);
    expect(agg.totalCostUsd).toBeNull();
    expect(agg.perSessionCostUsd).toBeNull();
  });

  it('counts judge nulls separately from accuracy denominator', () => {
    const records: PerQueryRecord[] = [
      {
        questionId: 'q1',
        f1: 0,
        judgeLabel: null,
        latencyMs: 10,
        costUsd: 0,
        pricingTableMiss: false,
      },
      {
        questionId: 'q2',
        f1: 0,
        judgeLabel: 'CORRECT',
        latencyMs: 10,
        costUsd: 0,
        pricingTableMiss: false,
      },
    ];
    const agg = aggregate(records);
    expect(agg.judgeNullCount).toBe(1);
    expect(agg.judgeAccuracy).toBe(1.0); // 1 valid CORRECT / 1 valid
  });
});

describe('BenchmarkRunner', () => {
  it('emits OTel spans for add + each search (D8)', async () => {
    const { tracer, exporter } = makeTracer();
    const adapter = makeAdapter('themory');
    const judgePanel = makeJudgePanelAlwaysCorrect();
    const costTracker = new CostTracker({ tokenizer });
    const resultsPath = join(TMP_DIR, 'spans-test.json');

    const runner = new BenchmarkRunner({
      adapter,
      judgePanel,
      costTracker,
      tracer,
      resultsPath,
    });

    await runner.run(
      { conversationId: 'c1', items: [] },
      [
        {
          questionId: 'q1',
          questionText: 'q1?',
          conversationId: 'c1',
          goldAnswer: 'q1? answered',
          category: 'misc',
        },
        {
          questionId: 'q2',
          questionText: 'q2?',
          conversationId: 'c1',
          goldAnswer: 'q2? answered',
          category: 'misc',
        },
      ],
    );

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(3); // 1 add + 2 search
    expect(spans.some((s) => s.name === 'benchmark.add')).toBe(true);
    expect(spans.some((s) => s.name === 'benchmark.search')).toBe(true);

    // v0-8-fixes-cycle-1 T2.2 + ADR D5: per-question search spans MUST carry
    // latencyMs + modelUsed as attributes so downstream consumers
    // (Grafana, Honeycomb, etc.) can reconstruct the same P95 from spans.
    const searchSpans = spans.filter((s) => s.name === 'benchmark.search');
    expect(searchSpans.length).toBeGreaterThanOrEqual(2);
    for (const sp of searchSpans) {
      expect(typeof sp.attributes['benchmark.latency_ms']).toBe('number');
      expect(typeof sp.attributes['benchmark.model_used']).toBe('string');
    }
  });

  // v0-8-fixes-cycle-1 T2.2 + EC-8: OTel spec rejects setAttribute(undefined).
  // The runner MUST coalesce undefined SearchResult fields to deterministic
  // sentinels (0 for latencyMs, 'unknown' for modelUsed) before setting span
  // attributes. Today no adapter returns undefined, but the typed contract
  // permits it; this test locks the defensive guard.
  it('coalesces undefined SearchResult fields to span-attribute sentinels (EC-8)', async () => {
    const { tracer, exporter } = makeTracer();
    const adapter = makeAdapter('themory');
    // Force the adapter's search() to return a SearchResult with undefined
    // latencyMs + modelUsed (simulating an adapter that doesn't track them).
    // Cast through unknown to bypass the typed contract (latencyMs +
    // modelUsed are non-optional on SearchResult). The runtime path
    // we exercise IS the EC-8 defensive guard.
    const undefinedFieldsSearch = (q: { questionText: string }): Promise<unknown> =>
      Promise.resolve({
        answer: `echo: ${q.questionText}`,
        retrievedContext: [],
        latencyMs: undefined,
        tokensUsed: { prompt: 1, completion: 1 },
        modelUsed: undefined,
      });
    (adapter as unknown as { search: typeof undefinedFieldsSearch }).search =
      undefinedFieldsSearch;
    const judgePanel = makeJudgePanelAlwaysCorrect();
    const costTracker = new CostTracker({ tokenizer });
    const resultsPath = join(TMP_DIR, 't2-2-ec8-coalesce.json');
    const runner = new BenchmarkRunner({
      adapter,
      judgePanel,
      costTracker,
      tracer,
      resultsPath,
    });
    await runner.run(
      { conversationId: 'c1', items: [] },
      [{ questionId: 'q1', questionText: 'q?', conversationId: 'c1', goldAnswer: 'a', category: 'misc' }],
    );
    const searchSpans = exporter.getFinishedSpans().filter((s) => s.name === 'benchmark.search');
    expect(searchSpans).toHaveLength(1);
    // Sentinels: 0 for latencyMs, 'unknown' for modelUsed
    expect(searchSpans[0]?.attributes['benchmark.latency_ms']).toBe(0);
    expect(searchSpans[0]?.attributes['benchmark.model_used']).toBe('unknown');
  });

  it('persists results incrementally per question (EC-9)', async () => {
    const { tracer } = makeTracer();
    const adapter = makeAdapter('themory');
    const judgePanel = makeJudgePanelAlwaysCorrect();
    const costTracker = new CostTracker({ tokenizer });
    const resultsPath = join(TMP_DIR, 'incremental-test.json');

    const runner = new BenchmarkRunner({
      adapter,
      judgePanel,
      costTracker,
      tracer,
      resultsPath,
    });

    await runner.run(
      { conversationId: 'c1', items: [] },
      [
        {
          questionId: 'q1',
          questionText: 'q1?',
          conversationId: 'c1',
          goldAnswer: 'q1? answered',
          category: 'misc',
        },
      ],
    );

    const raw = readFileSync(resultsPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      perQuery: PerQueryRecord[];
      final: boolean;
      aggregate: { questionCount: number };
    };
    expect(parsed.perQuery).toHaveLength(1);
    expect(parsed.final).toBe(true);
    expect(parsed.aggregate.questionCount).toBe(1);
  });

  it('catches PricingTableMiss and persists pricing_table_miss flag (EC-3)', async () => {
    const { tracer } = makeTracer();
    // After Drift-T5.1-1: cost lookup uses result.modelUsed. We supply
    // an unknown model so cost-tracker throws PricingTableMiss.
    const adapter = makeAdapter('themory', 'unknown-mystery-model');
    const judgePanel = makeJudgePanelAlwaysCorrect();
    const costTracker = new CostTracker({ tokenizer });
    const resultsPath = join(TMP_DIR, 'pricing-miss-test.json');

    const runner = new BenchmarkRunner({
      adapter,
      judgePanel,
      costTracker,
      tracer,
      resultsPath,
    });

    const report = await runner.run(
      { conversationId: 'c1', items: [] },
      [
        {
          questionId: 'q1',
          questionText: 'q1?',
          conversationId: 'c1',
          goldAnswer: 'q1? answered',
          category: 'misc',
        },
      ],
    );

    expect(report.perQuery[0]?.pricingTableMiss).toBe(true);
    expect(Number.isNaN(report.perQuery[0]?.costUsd ?? 0)).toBe(true);
    expect(report.aggregate.totalCostUsd).toBeNull();
  });

  it('aborts after 3 consecutive null judges + 1 retry also null (EC-2)', async () => {
    const { tracer } = makeTracer();
    const adapter = makeAdapter('themory');
    const judgePanel = makeJudgePanelAlwaysNull();
    const costTracker = new CostTracker({ tokenizer });
    const resultsPath = join(TMP_DIR, 'ec2-abort-test.json');

    let sleepCalls = 0;
    const fakeSleep = (_ms: number): Promise<void> => {
      sleepCalls += 1;
      return Promise.resolve();
    };

    const runner = new BenchmarkRunner({
      adapter,
      judgePanel,
      costTracker,
      tracer,
      resultsPath,
      retryPauseMs: 100,
      sleep: fakeSleep,
    });

    const report = await runner.run(
      { conversationId: 'c1', items: [] },
      [
        { questionId: 'q1', questionText: 'q1?', conversationId: 'c1', goldAnswer: 'x', category: 'misc' },
        { questionId: 'q2', questionText: 'q2?', conversationId: 'c1', goldAnswer: 'x', category: 'misc' },
        { questionId: 'q3', questionText: 'q3?', conversationId: 'c1', goldAnswer: 'x', category: 'misc' },
        { questionId: 'q4', questionText: 'q4?', conversationId: 'c1', goldAnswer: 'x', category: 'misc' },
      ],
    );

    expect(report.aborted).toBe(true);
    expect(report.abortReason).toMatch(/all-judges-fail|consecutive/i);
    expect(sleepCalls).toBeGreaterThanOrEqual(1);
    // Q4 was never reached due to abort after retry on Q3
    expect(report.perQuery.length).toBeLessThan(4);
  });

  // v0-8-fixes-cycle-1 T2.1 (closes F-dom-obs-1 MAJOR per ADR D4 + D7):
  // BenchmarkRunner.run() MUST NOT mutate process.exitCode. The aborted
  // signal flows through RunReport.aborted only; CLI entry-points
  // (benchmarks/scripts/run-*.ts) translate report.aborted to
  // process.exit(...) in their top-level .then() callback. Library code
  // that reaches into runtime-global state is the same architectural
  // family as the iter-7 setGlobalTracerProvider regression.
  it('does NOT mutate process.exitCode when run aborts (T2.1 + ADR D4)', async () => {
    // Explicit baseline reset — earlier tests may have left exitCode dirty
    // (especially the pre-T2.1 EC-2 abort test which used to mutate it).
    process.exitCode = 0;
    const { tracer } = makeTracer();
    const adapter = makeAdapter('themory');
    const judgePanel = makeJudgePanelAlwaysNull();
    const costTracker = new CostTracker({ tokenizer });
    const resultsPath = join(TMP_DIR, 't2-1-no-exitcode-mutation.json');

    const runner = new BenchmarkRunner({
      adapter,
      judgePanel,
      costTracker,
      tracer,
      resultsPath,
      retryPauseMs: 100,
      sleep: () => Promise.resolve(),
    });

    const report = await runner.run(
      { conversationId: 'c1', items: [] },
      [
        { questionId: 'q1', questionText: 'q1?', conversationId: 'c1', goldAnswer: 'x', category: 'misc' },
        { questionId: 'q2', questionText: 'q2?', conversationId: 'c1', goldAnswer: 'x', category: 'misc' },
        { questionId: 'q3', questionText: 'q3?', conversationId: 'c1', goldAnswer: 'x', category: 'misc' },
      ],
    );

    expect(report.aborted).toBe(true);
    // The library MUST signal abort via RunReport, not via global mutation.
    expect(process.exitCode).toBe(0);
  });
});
