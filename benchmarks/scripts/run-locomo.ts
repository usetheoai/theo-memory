/**
 * v0.8 LoCoMo runner — SECONDARY benchmark per ADR D2.
 *
 * Per ADR D4: LoCoMo is CC-BY-NC-SA 4.0; full fixtures download at
 * install time via benchmarks/scripts/download-fixtures.mjs.
 *
 * Drift-T7.1-1: smoke fixture is hand-authored (NOT a subset of LoCoMo
 * data) to avoid NC license question for committed files.
 *
 * v0-8-fixes-cycle-1 T3.2: shared scaffold extracted to
 * `_runner-scaffold.ts` (F-arch-2 absorption); this file collapses to
 * benchmark-specific config + main() wrapping the scaffold.
 *
 * @see plan v1.2 § T7.1 + ADRs D2 / D4
 * @see plan v0-8-fixes-cycle-1 § T3.2 + ADR D2
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadLoCoMoFixture,
  type LoCoMoConversation,
} from '../../src/benchmarks/fixtures/index.js';
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
  convs: readonly LoCoMoConversation[],
  limit?: number,
): { readonly corpus: BenchmarkCorpus; readonly queries: readonly BenchmarkQuery[] } {
  const bounded = limit !== undefined ? convs.slice(0, limit) : convs;
  const items = bounded.flatMap((c, i) =>
    c.qa.map((q, j) => ({
      id: `loco-${String(i)}-${String(j)}`,
      text: `${q.questionText} ${q.answer}`,
      timestamp: new Date(),
      speaker: c.speakerA,
      metadata: { category: q.category },
    })),
  );
  const corpus: BenchmarkCorpus = {
    conversationId: 'locomo',
    items,
  };
  const queries: readonly BenchmarkQuery[] = bounded.flatMap((c) =>
    c.qa.map((q) => ({
      questionId: q.questionId,
      questionText: q.questionText,
      conversationId: 'locomo',
      goldAnswer: q.answer,
      category: q.category,
      expectedSpeakers: [c.speakerA, c.speakerB],
    })),
  );
  return { corpus, queries };
}

export async function main(opts: RunOpts): Promise<RunReport> {
  const convs = await loadLoCoMoFixture(opts.fixturePath);
  const { corpus, queries } = buildCorpusAndQueries(convs, opts.limit);
  mkdirSync(dirname(opts.resultsPath), { recursive: true });
  return runBenchmark({
    tracerScope: 'v0-8-locomo',
    corpus,
    queries,
    resultsPath: opts.resultsPath,
    ...(opts.modelId !== undefined && { modelId: opts.modelId }),
  });
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const fixturePath =
    process.env['LOCOMO_FIXTURE_PATH'] ?? join(REPO_ROOT, 'benchmarks', 'data', 'locomo', 'locomo10.json');
  const resultsPath =
    process.env['LOCOMO_RESULTS_PATH'] ??
    join(REPO_ROOT, 'benchmarks', 'results', 'locomo', 'themory.json');
  main({ fixturePath, resultsPath })
    .then((report) => {
      console.log(`[run-locomo] aborted: ${String(report.aborted)}`);
      console.log(`[run-locomo] questionCount: ${String(report.aggregate.questionCount)}`);
      // v0-8-fixes-cycle-1 T2.1 + ADR D7
      process.exit(report.aborted ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error('[run-locomo] FATAL:', err);
      process.exit(1);
    });
}
