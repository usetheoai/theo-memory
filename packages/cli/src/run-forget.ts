/**
 * `themory forget` handler — invokes top-level Memory.forget(memoryId).
 *
 * Per plan verbs-as-cli-themory-remember-recall-forget-reflect v1.1 § T2.3
 * + ADR D2 (EC-1 absorbed: NO scope flags — memoryId globally unique per
 * ADR-0002 + memory-store.ts:59-60 EXPLICIT comment "Notably excludes
 * `forget` (memoryId is globally unique — use top-level Memory.forget)").
 * EC-3 absorbed via createAgentToolsMemory. EC-5 absorbed: UUID v4 validator
 * at handler entry.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T2.3
 */
import { createAgentToolsMemory } from '@usetheo/memory-agent-core';

import { renderCliOutput, type CliFormat } from './cli-output.js';

export interface RunForgetOptions {
  readonly id: string;
  readonly hard?: boolean;
  readonly format: CliFormat;
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function runForget(opts: RunForgetOptions): Promise<void> {
  // EC-5 absorption — UUID v4 validator BEFORE Memory factory warm-up.
  if (!UUID_V4_REGEX.test(opts.id)) {
    process.stderr.write(`Error: Invalid <id>: must be UUID v4 (got: ${opts.id}).\n`);
    process.exit(2);
  }

  const [memory, dispose] = await createAgentToolsMemory();
  try {
    const hard = opts.hard ?? false;
    await memory.forget(opts.id, { hard });
    const out = renderCliOutput(
      { verb: 'forget', result: { id: opts.id, hard } },
      opts.format,
    );
    process.stdout.write(out + '\n');
  } finally {
    await dispose();
  }
}
