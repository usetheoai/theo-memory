/**
 * `themory remember` handler — writes a fact via Memory.scoped.remember().
 *
 * Per plan verbs-as-cli-themory-remember-recall-forget-reflect v1.1 § T2.1
 * + ADRs D2 + D4. EC-3 absorbed: env-fail uses direct `process.exit(2)`
 * (commander v12 would swallow throw → exit 1). EC-4 absorbed: empty text
 * rejected at CLI boundary BEFORE round-tripping to LLM extraction.
 * EC-8 absorbed (DOCUMENT): each invocation has ~2-5s warm-up cost; batch
 * ops > 50 should use REST server + curl.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T2.1
 */
import { createAgentToolsMemory } from '@usetheo/memory-agent-core';

import { renderCliOutput, type CliFormat } from './cli-output.js';
import { resolveCliScope, validateScopeOpts } from './cli-scope.js';

export interface RunRememberOptions {
  readonly text: string;
  readonly user?: string;
  readonly session?: string;
  readonly agent?: string;
  readonly format: CliFormat;
}

export async function runRemember(opts: RunRememberOptions): Promise<void> {
  // EC-4 absorption — empty text rejected at boundary BEFORE Memory factory
  // costly warm-up (model download + pg connect + journal sync).
  if (opts.text.trim().length === 0) {
    process.stderr.write('Error: remember requires a non-empty text positional argument.\n');
    process.exit(2);
  }

  // verbs-as-cli-fixes-cycle-1 T3.2 / F-dom-cli-2 absorption: validate scope
  // flags BEFORE the ~2-5s createAgentToolsMemory warm-up so consumers with
  // malformed `--user a --session b` exit in <2s.
  validateScopeOpts(opts);

  const [memory, dispose] = await createAgentToolsMemory();
  try {
    const scoped = resolveCliScope(memory, opts);
    const items = await scoped.remember(opts.text);
    const out = renderCliOutput({ verb: 'remember', items }, opts.format);
    process.stdout.write(out + '\n');
  } finally {
    await dispose();
  }
}
