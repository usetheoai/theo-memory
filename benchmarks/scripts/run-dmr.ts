/**
 * v0.8 DMR runner — TERTIARY benchmark per ADR D2.
 *
 * Drift-T7.2-1: smoke fixture is hand-authored; real DMR derivation
 * from MSC is in benchmarks/scripts/derive-dmr-subset.ts (placeholder
 * shipping at T7.2; full derivation deferred to follow-up cycle that
 * fetches MSC dataset).
 *
 * v0-8-fixes-cycle-1 T3.2: shared scaffold extracted to
 * `_runner-scaffold.ts` (F-arch-2 absorption); this file collapses to
 * benchmark-specific config + main() wrapping the scaffold.
 *
 * @see plan v1.2 § T7.2 + ADR D2
 * @see plan v0-8-fixes-cycle-1 § T3.2 + ADR D2
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDmrFixture, type DmrItem } from '../../src/benchmarks/fixtures/index.js';
import type { RunReport } from '../../src/benchmarks/runner/benchmark-runner.js';
import type { BenchmarkCorpus, BenchmarkQuery } from '../../src/core/dip/benchmark-adapter.js';

import { runBenchmark } from './_runner-scaffold.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface RunOpts {
  readonly fixturePath: string;
  readonly resultsPath: string;
  readonly modelId?: string;
  readonly limit?: number;
}

function buildCorpusAndQueries(
  items: readonly DmrItem[],
  limit?: number,
): { readonly corpus: BenchmarkCorpus; readonly queries: readonly BenchmarkQuery[] } {
  const bounded = limit !== undefined ? items.slice(0, limit) : items;
  const corpus: BenchmarkCorpus = {
    conversationId: 'dmr',
    items: bounded.map((q, i) => ({
      id: `dmr-ctx-${String(i)}`,
      text: `${q.questionText} ${q.answer}`,
      timestamp: new Date(),
      metadata: {},
    })),
  };
  const queries: readonly BenchmarkQuery[] = bounded.map((q, i) => ({
    questionId: `${q.conversationId}-q${String(i)}`,
    questionText: q.questionText,
    conversationId: 'dmr',
    goldAnswer: q.answer,
    category: 'misc',
  }));
  return { corpus, queries };
}

export async function main(opts: RunOpts): Promise<RunReport> {
  const items = await loadDmrFixture(opts.fixturePath);
  const { corpus, queries } = buildCorpusAndQueries(items, opts.limit);
  mkdirSync(dirname(opts.resultsPath), { recursive: true });
  return runBenchmark({
    tracerScope: 'v0-8-dmr',
    corpus,
    queries,
    resultsPath: opts.resultsPath,
    ...(opts.modelId !== undefined && { modelId: opts.modelId }),
  });
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const fixturePath =
    process.env['DMR_FIXTURE_PATH'] ?? join(REPO_ROOT, 'benchmarks', 'data', 'dmr', 'dmr500.json');
  const resultsPath =
    process.env['DMR_RESULTS_PATH'] ?? join(REPO_ROOT, 'benchmarks', 'results', 'dmr', 'themory.json');
  main({ fixturePath, resultsPath })
    .then((report) => {
      console.log(`[run-dmr] aborted: ${String(report.aborted)}`);
      console.log(`[run-dmr] questionCount: ${String(report.aggregate.questionCount)}`);
      // v0-8-fixes-cycle-1 T2.1 + ADR D7
      process.exit(report.aborted ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error('[run-dmr] FATAL:', err);
      process.exit(1);
    });
}
