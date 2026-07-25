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
 */
import type { ConsolidationCandidate, ConsolidationContext } from '../dip/conflict-resolution-policy.js';
import type { Message } from '../dip/llm.js';

export const CONFLICT_MERGE_PROMPT = `You are a careful memory-conflict judge.

You receive a cluster of facts grouped only by rough similarity — they are NOT
guaranteed to be about the same thing. Most clusters MIX DISTINCT facts. Your
ONLY job is to find genuine STALE DUPLICATES: a fact that is an older or
superseded version of ANOTHER fact in the cluster stating the SAME attribute of
the SAME subject (an updated value for the same measurement, a corrected form of
the same name, a contradicted claim about the same thing).

Choose kept_id = the freshest, most-correct fact that has at least one stale
duplicate in the cluster; put in rejected_ids ONLY those stale duplicates of
kept_id.

NEVER put a fact in rejected_ids because it is merely similar. NEVER reject a
fact that adds DISTINCT information — a different attribute, a different subject,
or an additional detail. Distinct facts are KEPT (left out of rejected_ids).
Discarding a distinct fact is a serious error: it erases real memory.

Output STRICT JSON with this exact shape (no prose, no markdown):
{
  "kept_id": "<the memoryId of the fact to keep>",
  "rejected_ids": ["<memoryId of a stale duplicate of kept_id>", "..."],
  "reason": "<one sentence — which fact each rejected id is a stale version of>"
}

Constraints:
- kept_id MUST be present in the input cluster.
- Every rejected_id MUST be present in the input cluster AND distinct from kept_id
  AND be a stale/superseded version of kept_id (same attribute + same subject).
- If NO fact in the cluster is a genuine stale duplicate of another (the common
  case for a mixed cluster), output kept_id="" and rejected_ids=[] so the host
  keeps every fact (ADD-only safe default).` as const;

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
