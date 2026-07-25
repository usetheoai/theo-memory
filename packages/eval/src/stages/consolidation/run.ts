/**
 * Consolidation eval (migrated from tests/eval/distillation/run.ts — ADR D6).
 *
 * The reflect -> distill -> conflict path is ONE ConflictResolutionPolicy code
 * path (ADR D5), scored over the existing 50 hand-authored distillation
 * fixtures. This tier is LLM-FREE: it runs the harness (loader -> policy
 * invocation -> metric computation -> matrix) with synthetic decisions so it is
 * cheap + CI-friendly. It measures HARNESS WIRING, not LLM judgment quality —
 * the real quality signal is the key-gated LLM-measured tier
 * (`the-goal-test-llm-measured.test.ts`). See the F-M5 caveat in the README.
 *
 * Reproduce: `pnpm --filter @usetheo/memory-eval run eval:consolidation`.
 */
import { pathToFileURL } from 'node:url';

import {
  loadGoldSet,
  type GoldSetFixture,
} from '../../../../../tests/fixtures/distillation/loader.js';
import {
  conflictResolutionAccuracy,
  precision,
  recall,
  type ConflictResolutionDecision,
} from '../../metrics/index.js';

export interface PolicyResult {
  readonly policyName: string;
  readonly precision: number;
  readonly recall: number;
  readonly conflictAccuracy: number;
  readonly runtimeMs: number;
}

const POLICIES = ['noop', 'last-write-wins', 'llm-judged-merge'] as const;
export type PolicyName = (typeof POLICIES)[number];

function handAuthoredOnly(fixtures: readonly GoldSetFixture[]): readonly GoldSetFixture[] {
  return fixtures.filter((f) => f.source === 'hand');
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * LLM-free harness runner. For 'noop', consolidation surfaces no facts
 * (extracted = []); for the deterministic policies we pass expected facts
 * through verbatim (would-be-perfect extraction) — harness measurement only.
 */
function runPolicyHarness(
  policyName: PolicyName,
  fixtures: readonly GoldSetFixture[],
): PolicyResult {
  const start = Date.now();
  const perFixture: { extracted: string[]; expected: string[] }[] = [];
  const decisions: ConflictResolutionDecision[] = [];
  const isNoop = policyName === 'noop';
  for (const f of fixtures) {
    const expected = f.expectedFacts.map((x) => x.text);
    perFixture.push({ extracted: isNoop ? [] : expected, expected });
    const pair = f.expectedConflictPair;
    if (pair !== undefined) {
      decisions.push({
        fixtureId: f.id,
        expectedKept: pair.kept,
        expectedRejected: pair.rejected,
        actualKept: isNoop ? '' : pair.kept,
        actualRejected: isNoop ? '' : pair.rejected,
      });
    }
  }
  return {
    policyName,
    precision: mean(perFixture.map((x) => precision(x.extracted, x.expected, 0.5))),
    recall: mean(perFixture.map((x) => recall(x.extracted, x.expected, 0.5))),
    conflictAccuracy: conflictResolutionAccuracy(decisions, 0.5),
    runtimeMs: Date.now() - start,
  };
}

/** Run the LLM-free consolidation harness over the hand-authored gold set. */
export function runConsolidationEval(): Promise<PolicyResult[]> {
  const handSet = handAuthoredOnly(loadGoldSet());
  return Promise.resolve(POLICIES.map((p) => runPolicyHarness(p, handSet)));
}

/** Pure matrix renderer — DB-free, unit-tested. */
export function renderConsolidationMatrix(results: readonly PolicyResult[]): string {
  const header = [
    '# Consolidation Evaluation Matrix (LLM-free harness)',
    '',
    '| Policy | Precision | Recall | Conflict-Resolution Accuracy | Runtime (ms) |',
    '|---|---|---|---|---|',
  ].join('\n');
  const rows = results.map(
    (r) =>
      `| ${r.policyName} | ${r.precision.toFixed(3)} | ${r.recall.toFixed(3)} | ${r.conflictAccuracy.toFixed(3)} | ${String(r.runtimeMs)} |`,
  );
  return [header, ...rows].join('\n');
}

async function main(): Promise<void> {
  const results = await runConsolidationEval();
  for (const r of results) {
    console.log(
      `${r.policyName}: p=${r.precision.toFixed(3)} r=${r.recall.toFixed(3)} acc=${r.conflictAccuracy.toFixed(3)} ${String(r.runtimeMs)}ms`,
    );
  }
  console.log('');
  console.log(renderConsolidationMatrix(results));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
