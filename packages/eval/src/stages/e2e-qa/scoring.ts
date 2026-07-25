/**
 * #148 — deterministic scoring guard against a lenient LLM judge.
 *
 * The M24 bench exposed the judge (temp=0 gpt-4o-mini) marking an ABSTENTION
 * ("I don't have that information.") as CORRECT on a NON-abstention question —
 * a false-positive that inflates accuracy and makes the bench unable to validate
 * a knowledge-update fix (the metric goes green even when the fresh value is
 * never surfaced). This pure guard short-circuits BEFORE the LLM judge: abstaining
 * on a question that has a gold answer is a miss by definition.
 */

/**
 * `true` when the model abstained on a question that DEMANDS a concrete answer
 * (`isAbstentionQuestion === false`). Such a response can never be correct — it
 * did not produce the gold value — so it must score NO without consulting the
 * (demonstrably lenient) LLM judge.
 */
export function abstentionIsMiss(
  isAbstentionQuestion: boolean,
  modelAnswer: string,
  abstainAnswer: string,
): boolean {
  return !isAbstentionQuestion && modelAnswer === abstainAnswer;
}
