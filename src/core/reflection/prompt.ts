/**
 * Reflection prompt builder per plan v0-4a-reflection-pipeline § T4.1 + ADR D11.
 *
 * Prompt structure (per blueprint Q5 + D11 — Letta v4 system-reminder pattern):
 *   System: "You are a reflection helper..." + scope-specific framing.
 *   User: source memories enumerated with IDs (UUID-as-int per Mem0 anti-hallucination).
 *
 * Format constraint: every derived insight MUST cite at least one source ID
 * from the enumerated set. The model MUST NOT invent IDs (per plan D7 fail-fast
 * via T4.2 provenance validator).
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § ADR D11
 */
import type { MemoryItem } from '../memory-item.js';
import type { Scope } from '../scope.js';

function scopeIdentifier(scope: Scope): string {
  switch (scope.kind) {
    case 'user':
      return `user "${scope.userId}"`;
    case 'session':
      return `session "${scope.sessionId}"${scope.userId !== undefined ? ` (user "${scope.userId}")` : ''}`;
    case 'agent':
      return `agent "${scope.agentId}"${scope.userId !== undefined ? ` (user "${scope.userId}")` : ''}`;
  }
}

/**
 * Build the reflection prompt — returns a single string ready to be wrapped
 * in a System/User message pair by the caller (executeReflection).
 *
 * @returns prompt text ending with a JSON-array-expected directive.
 */
export function buildReflectionPrompt(
  scope: Scope,
  sourceMemories: readonly MemoryItem[],
): string {
  const subject = scopeIdentifier(scope);
  const lines: string[] = [];
  lines.push('You are a reflection helper for a personal memory system.');
  lines.push(
    `You are reviewing the recent memories of ${subject}. Your job is to consolidate ` +
      'overlapping or related observations into higher-order insights.',
  );
  lines.push('');
  lines.push('RULES (NON-NEGOTIABLE):');
  lines.push('  - Cite source memory IDs verbatim. Invent NO ids.');
  lines.push('  - Every derived insight MUST reference at least one source ID via "derived_from".');
  lines.push('  - Return STRICT JSON: an array of objects { "text": string, "derived_from": string[] }.');
  lines.push('  - If no consolidation is possible (memories are unrelated), return an empty array [].');
  lines.push('');
  lines.push(`SOURCE MEMORIES (${String(sourceMemories.length)} total):`);
  for (const m of sourceMemories) {
    lines.push(`  - id="${m.id}": ${m.text}`);
  }
  lines.push('');
  lines.push('Respond with the JSON array. No prose, no preamble.');
  return lines.join('\n');
}
