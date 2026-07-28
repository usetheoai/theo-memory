/**
 * T4.1 — eval orchestrator + regression gate (ADR D3).
 *
 * Runs the LLM-free per-stage runners, renders a matrix, and gates the
 * candidate scores against the committed baseline
 * (`src/baselines/llm-free.json`). Fail-closed: a missing/corrupt baseline
 * throws, a regression throws (non-zero exit).
 *
 * CLI (`--predict-only`/`--evaluate-only`):
 *   tsx src/run.ts                     # predict + evaluate (gate) — default
 *   tsx src/run.ts --predict-only      # run stages + print matrix, no gate
 *   tsx src/run.ts --evaluate-only     # gate the current candidate
 *   tsx src/run.ts --update-baseline   # re-seed the committed baseline (no gate)
 *   tsx src/run.ts --stage extraction  # restrict to one stage
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertNoRegression, DEFAULT_TOLERANCE, type Tolerance } from './regression.js';
import { BaselineSchema, type Baseline, type StageScore } from './schema.js';
import { consolidationStageScore } from './stages/consolidation/run.js';
import { runExtractionEval } from './stages/extraction/run.js';

export const DEFAULT_BASELINE_PATH = fileURLToPath(
  new URL('./baselines/llm-free.json', import.meta.url),
);

/** Run every LLM-free stage runner and collect their StageScores. */
export async function collectStageScores(): Promise<StageScore[]> {
  const extraction = runExtractionEval();
  const consolidation = await consolidationStageScore();
  return [extraction, consolidation];
}

/** Load + Zod-validate the committed baseline. Fail-closed on missing/corrupt. */
export function loadBaseline(file: string = DEFAULT_BASELINE_PATH): Baseline {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  return BaselineSchema.parse(raw);
}

/** Assert the candidate does not regress against the baseline (throws if it does). */
export function assertGate(
  candidate: readonly StageScore[],
  baseline: Baseline,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): void {
  assertNoRegression(candidate, baseline, tolerance);
}

export function renderMatrix(scores: readonly StageScore[]): string {
  const header = [
    '# LLM-free eval matrix',
    '',
    '| Stage | Precision | Recall | Accuracy | n | Runtime (ms) |',
    '|---|---|---|---|---|---|',
  ].join('\n');
  const rows = scores.map(
    (s) =>
      `| ${s.stage} | ${s.precision.toFixed(3)} | ${s.recall.toFixed(3)} | ${
        s.accuracy === undefined ? '—' : s.accuracy.toFixed(3)
      } | ${String(s.n)} | ${String(s.runtimeMs)} |`,
  );
  return [header, ...rows].join('\n');
}

function toBaseline(scores: readonly StageScore[]): Baseline {
  return {
    generatedAt: new Date().toISOString(),
    model: 'llm-free',
    stages: [...scores],
  };
}

function filterStage(scores: readonly StageScore[], stage: string | undefined): StageScore[] {
  return stage === undefined ? [...scores] : scores.filter((s) => s.stage === stage);
}

interface CliOptions {
  predictOnly: boolean;
  evaluateOnly: boolean;
  updateBaseline: boolean;
  stage: string | undefined;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const stageIdx = argv.indexOf('--stage');
  return {
    predictOnly: argv.includes('--predict-only'),
    evaluateOnly: argv.includes('--evaluate-only'),
    updateBaseline: argv.includes('--update-baseline'),
    stage: stageIdx >= 0 ? argv[stageIdx + 1] : undefined,
  };
}

/** Returns a process exit code (0 = ok, 1 = regression). */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  const allScores = await collectStageScores();
  const scores = filterStage(allScores, opts.stage);
  // Fail-closed (Princípio 3): a mistyped --stage filters to an empty set, which
  // would otherwise pass the gate vacuously (no regression on nothing). Reject it.
  if (opts.stage !== undefined && scores.length === 0) {
    const known = allScores.map((s) => s.stage).join(', ');
    throw new Error(`unknown --stage '${opts.stage}' (known stages: ${known})`);
  }
  console.log(renderMatrix(scores));

  if (opts.updateBaseline) {
    mkdirSync(dirname(DEFAULT_BASELINE_PATH), { recursive: true });
    writeFileSync(DEFAULT_BASELINE_PATH, `${JSON.stringify(toBaseline(scores), null, 2)}\n`);
    console.log(`\nBaseline updated: ${DEFAULT_BASELINE_PATH}`);
    return 0;
  }
  if (opts.predictOnly) return 0;

  const baseline = loadBaseline();
  const stages = filterStage(baseline.stages, opts.stage);
  try {
    assertGate(scores, { ...baseline, stages });
    console.log('\nGate: PASS (no regression vs baseline).');
    return 0;
  } catch (err) {
    console.error(`\nGate: FAIL\n${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
