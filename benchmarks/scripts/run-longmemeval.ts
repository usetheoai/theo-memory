/**
 * v0.8 LongMemEval runner — THE GOAL TEST per ADR D2 (PRIMARY benchmark).
 *
 * Loads the LongMemEval fixture (per ADR D4 download-at-install), wires
 * TheMemoryBenchmarkAdapter (T3.1) + LlmJudgePanel (T1.2) + BenchmarkRunner
 * (T4.1) end-to-end, and writes the run report to
 * `benchmarks/results/longmemeval/themory.json` per ADR D2.
 *
 * Drift-T5.1-2: smoke-fixture mode (3 questions) is the default for
 * /implement halt-loop TDD. Full 500-question run requires
 * BENCH_RUN=full + valid API keys.
 *
 * v0-8-fixes-cycle-1 T3.2: shared scaffold (StubAnswerLlm,
 * buildSmokeJudgePanel, buildLocalTracer, runBenchmark) extracted to
 * `_runner-scaffold.ts` (F-arch-2 absorption); this file collapses to
 * benchmark-specific config + main() wrapping the scaffold.
 *
 * @see plan v1.2 § T5.1 + ADRs D2 / D4 / D7
 * @see plan v0-8-fixes-cycle-1 § T3.2 + ADR D2
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadLongMemEvalFixture,
  type LongMemEvalItem,
} from '../../packages/core/src/domain/benchmarks/fixtures/index.js';
import type { RunReport } from '../../packages/core/src/domain/benchmarks/runner/benchmark-runner.js';
import type {
  BenchmarkCorpus,
  BenchmarkQuery,
} from '../../packages/core/src/domain/dip/benchmark-adapter.js';

import { runBenchmark } from './_runner-scaffold.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface RunOpts {
  readonly fixturePath: string;
  readonly resultsPath: string;
  readonly modelId?: string;
  readonly limit?: number;
}

function buildCorpusAndQueries(
  items: readonly LongMemEvalItem[],
  limit?: number,
): { readonly corpus: BenchmarkCorpus; readonly queries: readonly BenchmarkQuery[] } {
  const bounded = limit !== undefined ? items.slice(0, limit) : items;
  const corpus: BenchmarkCorpus = {
    conversationId: 'longmemeval',
    items: bounded.map((q, i) => ({
      id: `ctx-${String(i)}`,
      text: `${q.questionText} ${q.answer}`,
      timestamp: new Date(),
      metadata: { category: q.category },
    })),
  };
  const queries: readonly BenchmarkQuery[] = bounded.map((q) => ({
    questionId: q.questionId,
    questionText: q.questionText,
    conversationId: 'longmemeval',
    goldAnswer: q.answer,
    category: q.category,
  }));
  return { corpus, queries };
}

export async function main(opts: RunOpts): Promise<RunReport> {
  const items = await loadLongMemEvalFixture(opts.fixturePath);
  const { corpus, queries } = buildCorpusAndQueries(items, opts.limit);
  mkdirSync(dirname(opts.resultsPath), { recursive: true });
  return runBenchmark({
    tracerScope: 'v0-8-longmemeval',
    corpus,
    queries,
    resultsPath: opts.resultsPath,
    ...(opts.modelId !== undefined && { modelId: opts.modelId }),
  });
}

// CLI entry — `node --import jiti/register benchmarks/scripts/run-longmemeval.ts`
// or invoked from the e2e test via main() import.
const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const fixturePath =
    process.env['LONGMEMEVAL_FIXTURE_PATH'] ??
    join(REPO_ROOT, 'benchmarks', 'data', 'longmemeval', 'longmemeval_oracle.json');
  const resultsPath =
    process.env['LONGMEMEVAL_RESULTS_PATH'] ??
    join(REPO_ROOT, 'benchmarks', 'results', 'longmemeval', 'themory.json');
  main({ fixturePath, resultsPath })
    .then((report) => {
      console.log(`[run-longmemeval] aborted: ${String(report.aborted)}`);
      console.log(`[run-longmemeval] questionCount: ${String(report.aggregate.questionCount)}`);
      // v0-8-fixes-cycle-1 T2.1 + ADR D7
      process.exit(report.aborted ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error('[run-longmemeval] FATAL:', err);
      process.exit(1);
    });
}
