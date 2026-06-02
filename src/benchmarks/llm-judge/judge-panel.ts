/**
 * LlmJudgePanel — orchestrates N SingleJudge calls in parallel,
 * aggregates labels by majority vote, and computes inter-judge
 * agreement.
 *
 * Anti-REDACTED design (plan ADR D3):
 * - Configurable model / prompt per judge
 * - All judges accessed via OpenAI-compatible APIs (NO @anthropic-ai/sdk)
 * - Raw judge responses persisted alongside binary labels (audit trail)
 * - Inter-judge agreement reported (anti single-judge bias)
 *
 * ADR-DEFER-WIRING-A: first production caller is T4.1 runner.
 * ADR-DEFER-WIRING-B: integration arrives at T4.1 + T5.1.
 *
 * @see plan v1.2 § T1.2 + ADR D3
 */
import { computeAgreement, type InterJudgeAgreement } from './inter-judge-agreement.js';
import type { JudgeLabel } from './json-extractor.js';
import { SingleJudge, type JudgeConfig, type JudgeOutcome, type JudgeQuery } from './single-judge.js';

export interface PanelResult {
  readonly outcomes: readonly (JudgeOutcome | null)[];
  readonly aggregateLabel: JudgeLabel | null;
  readonly agreement: InterJudgeAgreement;
}

function aggregateMajority(labels: readonly (JudgeLabel | null)[]): JudgeLabel | null {
  const valid = labels.filter((l): l is JudgeLabel => l !== null);
  if (valid.length === 0) return null;
  const correctCount = valid.filter((l) => l === 'CORRECT').length;
  return correctCount >= valid.length / 2 ? 'CORRECT' : 'WRONG';
}

export class LlmJudgePanel {
  private readonly judges: readonly SingleJudge[];

  constructor(private readonly configs: readonly JudgeConfig[]) {
    this.judges = configs.map((c) => new SingleJudge(c));
  }

  async judge(query: JudgeQuery): Promise<PanelResult> {
    const outcomes = await Promise.all(this.judges.map((j) => j.judge(query)));
    const labels = outcomes.map((o) => o?.label ?? null);
    const aggregateLabel = aggregateMajority(labels);
    const agreement = computeAgreement(labels);
    return { outcomes, aggregateLabel, agreement };
  }
}

export type { InterJudgeAgreement } from './inter-judge-agreement.js';
export type { JudgeLabel } from './json-extractor.js';
export type { JudgeConfig, JudgeOutcome, JudgeQuery } from './single-judge.js';
