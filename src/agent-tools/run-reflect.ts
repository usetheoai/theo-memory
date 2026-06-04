/**
 * `themory reflect` handler — invokes Memory.scoped.reflect() and renders
 * the projected CLI-shape (sourceCount + derivedCount).
 *
 * Per plan verbs-as-cli-themory-remember-recall-forget-reflect v1.1 § T2.4
 * + ADRs D2 + D3 + D4. EC-3 absorbed via createCliMemory.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T2.4
 */
import { createCliMemory } from './cli-memory-factory.js';
import {
  renderCliOutput,
  type CliFormat,
  type CliReflectResult,
} from './cli-output.js';
import { resolveCliScope } from './cli-scope.js';

export interface RunReflectOptions {
  readonly user?: string;
  readonly session?: string;
  readonly agent?: string;
  readonly format: CliFormat;
}

export async function runReflect(opts: RunReflectOptions): Promise<void> {
  const [memory, dispose] = await createCliMemory();
  try {
    const scoped = resolveCliScope(memory, opts);
    const result = await scoped.reflect();
    // Project ReflectionResult into the consumer-friendly CLI shape per
    // ADR D3 + T2.4 Deep Dives.
    const projected: CliReflectResult = {
      sourceCount: result.sourceIds.length,
      derivedCount: result.derivedMemoriesCreated,
      derived: result.higherOrderMemories,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    };
    const out = renderCliOutput({ verb: 'reflect', result: projected }, opts.format);
    process.stdout.write(out + '\n');
  } finally {
    await dispose();
  }
}
