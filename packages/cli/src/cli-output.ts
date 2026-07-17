/**
 * CLI output renderer — DRY helper for `themory remember/recall/forget/reflect`
 * stdout serialization (JSON default OR --text human-readable).
 *
 * Per plan verbs-as-cli-fixes-cycle-1 § T1.2 + ADR D2: the reflect variant
 * now emits the RAW `ReflectionResult` (not a projection). Restores 3-way
 * parity with MCP + REST surfaces (closes F-dom-api-1).
 *
 */
import type { MemoryItem, MemoryItemWithScore } from '@usetheo/memory/contract';
import type { ReflectionResult } from '@usetheo/memory/contract';

export type CliFormat = 'json' | 'text';

export type CliVerb = 'remember' | 'recall' | 'forget' | 'reflect';

export interface CliForgetResult {
  readonly id: string;
  readonly hard: boolean;
}

export type CliRenderableResult =
  | { verb: 'remember'; items: readonly MemoryItem[] }
  | { verb: 'recall'; items: readonly MemoryItemWithScore[] }
  | { verb: 'forget'; result: CliForgetResult }
  | { verb: 'reflect'; result: ReflectionResult };

/**
 * Render a verb result to stdout text. JSON via `JSON.stringify(_, null, 2)`;
 * text via verb-specific renderer.
 */
export function renderCliOutput(payload: CliRenderableResult, format: CliFormat): string {
  if (format === 'json') {
    if (payload.verb === 'remember' || payload.verb === 'recall') {
      return JSON.stringify(payload.items, null, 2);
    }
    return JSON.stringify(payload.result, null, 2);
  }
  // text format
  switch (payload.verb) {
    case 'remember': {
      const ids = payload.items.map((m) => m.id).join(', ');
      return `Wrote ${String(payload.items.length)} memories: ${ids}`;
    }
    case 'recall': {
      const lines = payload.items.map(
        (m) => `  - [${m.score.toFixed(3)}] ${m.id}: ${m.text}`,
      );
      return `Found ${String(payload.items.length)} memories:\n${lines.join('\n')}`;
    }
    case 'forget':
      return `Forgot ${payload.result.id} (hard=${String(payload.result.hard)})`;
    case 'reflect':
      return `Reflected ${String(payload.result.sourceIds.length)} → ${String(payload.result.derivedMemoriesCreated)} insights`;
  }
}
