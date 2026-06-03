/**
 * Verbatim prompts for `LlmJudgedMergeConflictPolicy` (T1.3 / ADR D2).
 *
 * Separated from the policy class so consumers + reviewers can grep the
 * exact prompt text + version-control it independently of the impl logic.
 *
 * The system prompt instructs the LLM to act as a judge over a cluster of
 * cosine-similar memories and to emit a strict JSON response. The user
 * prompt assembles the cluster contents (id + text) for the judge to read.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T1.3 + ADR D2
 */
import type { ConsolidationCandidate, ConsolidationContext } from '../dip/conflict-resolution-policy.js';
import type { Message } from '../dip/llm.js';

export const CONFLICT_MERGE_PROMPT = `You are a careful memory-conflict judge.

You receive a cluster of facts about the same subject that may overlap,
contradict, or restate each other. Pick ONE fact to keep (the most
specific, most recent, most internally consistent) and reject the rest.

Output STRICT JSON with this exact shape (no prose, no markdown):
{
  "kept_id": "<the memoryId of the fact to keep>",
  "rejected_ids": ["<memoryId>", "..."],
  "reason": "<one sentence — why this fact was chosen as the keeper>"
}

Constraints:
- kept_id MUST be present in the input cluster.
- Every rejected_id MUST be present in the input cluster AND distinct from kept_id.
- If you cannot reach a confident decision, output kept_id="" so the host
  abstains; the policy will preserve all facts (ADD-only safe default).` as const;

/**
 * Builds the [system, user] message pair the LLM judge receives.
 * The user message embeds each candidate's memoryId + text verbatim;
 * scope + observationDate are included for context-aware reasoning.
 */
export function generateConflictMergePrompt(
  candidates: readonly ConsolidationCandidate[],
  context: ConsolidationContext,
): readonly Message[] {
  const lines: string[] = [];
  lines.push(`Scope kind: ${context.scope.kind}`);
  lines.push(`Observation date: ${context.observationDate.toISOString()}`);
  lines.push('');
  lines.push(`Cluster of ${String(candidates.length)} candidate fact(s):`);
  for (const c of candidates) {
    lines.push(`  - memoryId=${c.memoryId} createdAt=${c.createdAt.toISOString()}`);
    lines.push(`    text: ${c.text}`);
  }
  lines.push('');
  lines.push(
    'Return STRICT JSON {"kept_id":"...", "rejected_ids":[...], "reason":"..."}.',
  );
  return [
    { role: 'system', content: CONFLICT_MERGE_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}
