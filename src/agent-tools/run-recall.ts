/**
 * `themory recall` handler — queries Memory.scoped.recall() and renders.
 *
 * Per plan verbs-as-cli-themory-remember-recall-forget-reflect v1.1 § T2.2
 * + ADRs D2 + D4. EC-3 absorbed via createCliMemory. EC-6 absorbed: bounds
 * validators for --top-k (int 1-100), --threshold (float 0-1), --diversify
 * (float 0-1). EC-7 absorbed: BEFORE rendering, the handler strips the
 * `embedding` field from each item to prevent 1536-float arrays from
 * ballooning stdout to 80 KB+ per top-k=10 and breaking shell pipes.
 * EC-9 absorbed (DOCUMENT): recall returns MemoryItemWithScore[] with extra
 * `score: number` field — text renderer uses `[<score>] <id>: <text>` pattern.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T2.2
 */
import type { MemoryItemWithScore } from '../core/memory-item.js';

import { createCliMemory } from './agent-tools-memory.js';
import { renderCliOutput, type CliFormat } from './cli-output.js';
import { resolveCliScope, validateScopeOpts } from './cli-scope.js';

export interface RunRecallOptions {
  readonly query: string;
  readonly user?: string;
  readonly session?: string;
  readonly agent?: string;
  readonly topK?: number;
  readonly threshold?: number;
  readonly diversify?: number;
  readonly format: CliFormat;
}

export async function runRecall(opts: RunRecallOptions): Promise<void> {
  // verbs-as-cli-fixes-cycle-1 T3.2 / F-dom-cli-2 absorption: validate scope
  // flags BEFORE the ~2-5s createCliMemory warm-up.
  validateScopeOpts(opts);

  const [memory, dispose] = await createCliMemory();
  try {
    const scoped = resolveCliScope(memory, opts);
    const recallOpts: { topK?: number; threshold?: number; diversify?: { lambda: number } } = {};
    if (opts.topK !== undefined) recallOpts.topK = opts.topK;
    if (opts.threshold !== undefined) recallOpts.threshold = opts.threshold;
    if (opts.diversify !== undefined) recallOpts.diversify = { lambda: opts.diversify };
    const items = await scoped.recall(opts.query, recallOpts);
    // EC-7 absorption — defensive strip of any `embedding` field before stdout
    // serialization. MemoryItemWithScore TYPE does NOT declare `embedding`,
    // but adapter implementations may project the column at runtime; emitting
    // a 1536-float vector via JSON.stringify would balloon stdout to 80 KB+
    // per top-k=10 and break shell pipes.
    const stripped = items.map((item) => {
      const entries = Object.entries(item).filter(([key]) => key !== 'embedding');
      return Object.fromEntries(entries) as MemoryItemWithScore;
    });
    const out = renderCliOutput({ verb: 'recall', items: stripped }, opts.format);
    process.stdout.write(out + '\n');
  } finally {
    await dispose();
  }
}
