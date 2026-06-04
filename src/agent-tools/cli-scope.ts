/**
 * CLI scope resolver — DRY helper for `themory remember/recall/reflect`
 * mutually-exclusive scope flag binding (`--user` / `--session` / `--agent`).
 *
 * Per plan verbs-as-cli-themory-remember-recall-forget-reflect v1.1 § T1.1
 * + ADR D2 (EC-2 absorbed: `--skills` NOT included — ScopedSkillMemory has
 * divergent verb surface per ADR-0010 + skill.ts; skill-CLI surface deferred
 * to a separate plan with `themory skill {add,recall,forget,consolidate}`).
 *
 * Per ADR-0002 + memory-store.ts:59-60 the `forget` verb does NOT bind scope
 * (memoryId globally unique) — `forget` subcommand bypasses this helper.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T1.1 + ADR D2
 */
import type { Memory, ScopedMemory } from '../core/memory-store.js';

/**
 * Options shape: exactly one of `user` / `session` / `agent` MUST be defined.
 */
export interface CliScopeOptions {
  readonly user?: string;
  readonly session?: string;
  readonly agent?: string;
}

/**
 * Resolve `--user <id>` / `--session <id>` / `--agent <id>` into a
 * `ScopedMemory` by invoking the corresponding `memory.user/session/agent(id)`.
 *
 * @throws Error when zero OR more than one scope field is defined.
 */
export function resolveCliScope(memory: Memory, opts: CliScopeOptions): ScopedMemory {
  const defined = [opts.user, opts.session, opts.agent].filter(
    (v): v is string => v !== undefined,
  );
  if (defined.length !== 1) {
    throw new Error('--user / --session / --agent: exactly one required');
  }
  if (opts.user !== undefined) return memory.user(opts.user);
  if (opts.session !== undefined) return memory.session(opts.session);
  return memory.agent(opts.agent!);
}
