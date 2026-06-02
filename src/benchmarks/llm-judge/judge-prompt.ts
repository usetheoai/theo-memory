/**
 * Judge prompt template + renderer.
 *
 * Anti-Mem0 instructional bias: Mem0's `metrics/llm_judge.py:22-23`
 * tells the judge to "be generous" with grading. Plan v1.2 ADR D3
 * inverts that to "be calibrated" so partially-correct or evasive
 * answers are scored WRONG. The shift matters because over-lenient
 * judging inflates accuracy by 5-15pp in our empirical experience
 * (see blueprint Q2).
 *
 * @see plan v1.2 § T1.2 + ADR D3
 */
import type { Message } from '../../core/dip/llm.js';

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
