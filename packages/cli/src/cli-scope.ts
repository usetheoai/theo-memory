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
 */
import type { Memory, ScopedMemory } from '@usetheo/memory/contract';

/**
 * Options shape: exactly one of `user` / `session` / `agent` MUST be defined.
 */
export interface CliScopeOptions {
  readonly user?: string;
  readonly session?: string;
  readonly agent?: string;
}

/**
 * @internal Shared CLI scope-resolver boundary helper for agent-tools subpath.
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Boundary-only validator. Throws when zero OR more than one scope field is
 * defined. No Memory dependency — invoke at the CLI boundary BEFORE warming
 * the expensive Memory factory (closes F-dom-cli-2: fail-fast ordering must
 * not pay the ~2-5s factory cost just to reject malformed input).
 *
 * Per plan verbs-as-cli-fixes-cycle-1 § T3.2 + EC-6 (3 contract tests).
 * @internal tag added by fix-cycle-2 hotfix (M1 closure from /review).
 *
 * @throws Error with the same message resolveCliScope used to throw.
 */
export function validateScopeOpts(opts: CliScopeOptions): void {
  const defined = [opts.user, opts.session, opts.agent].filter(
    (v): v is string => v !== undefined,
  );
  if (defined.length !== 1) {
    throw new Error('--user / --session / --agent: exactly one required');
  }
}

/**
 * @internal Shared CLI scope-resolver for agent-tools subpath.
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Resolve `--user <id>` / `--session <id>` / `--agent <id>` into a
 * `ScopedMemory` by invoking the corresponding `memory.user/session/agent(id)`.
 *
 * Pre-condition: `opts` already passed `validateScopeOpts`. The re-check
 * inside is defense-in-depth; callers should fail-fast BEFORE constructing
 * the Memory.
 *
 * @internal tag added by fix-cycle-2 hotfix (M1 closure from /review;
 * plan T2.3 undercounted by 1 — symmetric to validateScopeOpts boundary helper).
 *
 * @throws Error when zero OR more than one scope field is defined.
 */
export function resolveCliScope(memory: Memory, opts: CliScopeOptions): ScopedMemory {
  validateScopeOpts(opts);
  if (opts.user !== undefined) return memory.user(opts.user);
  if (opts.session !== undefined) return memory.session(opts.session);
  return memory.agent(opts.agent!);
}
