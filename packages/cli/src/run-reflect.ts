/**
 * `themory reflect` handler — invokes Memory.scoped.reflect() and renders
 * the RAW `ReflectionResult` shape (3-way contract parity with MCP + REST).
 *
 * Per plan verbs-as-cli-fixes-cycle-1 § T1.2 + ADR D2. Closes F-dom-api-1
 * (CLI reflect projection broke 3-way parity vs REST: consumers piping
 * `themory reflect --json | jq .higherOrderMemories` got `null` because the
 * projection renamed it to `derived`).
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-1-plan.md § T1.2
 */
import { createAgentToolsMemory } from '@usetheo/memory-agent-core';

import { renderCliOutput, type CliFormat } from './cli-output.js';
import { resolveCliScope, validateScopeOpts } from './cli-scope.js';

export interface RunReflectOptions {
  readonly user?: string;
  readonly session?: string;
  readonly agent?: string;
  readonly format: CliFormat;
}

export async function runReflect(opts: RunReflectOptions): Promise<void> {
  // verbs-as-cli-fixes-cycle-1 T3.2 / F-dom-cli-2 absorption: validate scope
  // flags BEFORE the ~2-5s createAgentToolsMemory warm-up.
  validateScopeOpts(opts);

  const [memory, dispose] = await createAgentToolsMemory();
  try {
    const scoped = resolveCliScope(memory, opts);
    const result = await scoped.reflect();
    const out = renderCliOutput({ verb: 'reflect', result }, opts.format);
    process.stdout.write(out + '\n');
  } finally {
    await dispose();
  }
}
