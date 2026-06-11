/**
 * Judge prompt template + renderer.
 *
 * Calibrated-judgement bias: instructs the judge to score partially-correct
 * or evasive answers WRONG (vs the over-lenient "be generous" pattern
 * common in upstream prior art). Plan v1.2 ADR D3 documents the choice;
 * over-lenient judging inflates accuracy by 5-15pp in our empirical
 * experience (see blueprint Q2 — methodology doc retains the upstream
 * citation lineage in a knowledge-base context, not in src/ code).
 *
 * @see plan v1.2 § T1.2 + ADR D3
 */
import type { Message } from '../../dip/llm.js';

export const ACCURACY_PROMPT = `Evaluate the generated answer against the gold answer for the given question.

Return a JSON object with two fields:
- "label": "CORRECT" if the generated answer conveys the same information as the gold answer (allowing reasonable paraphrase + format variation); "WRONG" otherwise.
- "reasoning": one-sentence justification for the label.

Be calibrated, not lenient. If the generated answer is partially correct or evasive, return WRONG.`;

export interface JudgePromptInputs {
  readonly questionText: string;
  readonly goldAnswer: string;
  readonly generated: string;
}

export function renderJudgePrompt(
  template: string,
  inputs: JudgePromptInputs,
): readonly Message[] {
  const userContent = `Question: ${inputs.questionText}\nGold answer: ${inputs.goldAnswer}\nGenerated answer: ${inputs.generated}`;
  return [
    { role: 'system', content: template },
    { role: 'user', content: userContent },
  ];
}
