/**
 * CLI output renderer — DRY helper for `themory remember/recall/forget/reflect`
 * stdout serialization (JSON default OR --text human-readable).
 *
 * Per plan verbs-as-cli-themory-remember-recall-forget-reflect v1.1 § T1.2
 * + ADR D3.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T1.2 + ADR D3
 */
import type { MemoryItem, MemoryItemWithScore } from '../core/memory-item.js';

export type CliFormat = 'json' | 'text';

export type CliVerb = 'remember' | 'recall' | 'forget' | 'reflect';

export interface CliForgetResult {
  readonly id: string;
  readonly hard: boolean;
}

/**
 * CLI-shaped reflect result. Projected from the public `ReflectionResult` so
 * consumer scripts see ergonomic `{ sourceCount, derivedCount, derived,
 * reason? }` instead of the raw `{ higherOrderMemories, sourceIds,
 * derivedMemoriesCreated, reason? }` shape — see ADR D3 + T2.4 Deep Dives.
 */
export interface CliReflectResult {
  readonly sourceCount: number;
  readonly derivedCount: number;
  readonly derived: readonly MemoryItem[];
  readonly reason?: 'no-source-memories' | 'no-consolidation';
}

export type CliRenderableResult =
  | { verb: 'remember'; items: readonly MemoryItem[] }
  | { verb: 'recall'; items: readonly MemoryItemWithScore[] }
  | { verb: 'forget'; result: CliForgetResult }
  | { verb: 'reflect'; result: CliReflectResult };

/**
 * Render a verb result to stdout text. JSON via `JSON.stringify(_, null, 2)`;
 * text via verb-specific renderer per ADR D3 wording contract.
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
      return `Reflected ${String(payload.result.sourceCount)} → ${String(payload.result.derivedCount)} insights`;
  }
}
