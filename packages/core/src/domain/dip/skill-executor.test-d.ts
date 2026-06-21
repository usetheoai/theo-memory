/**
 * Type-level shape assertion for T1.1 — the `SkillExecutor` DIP port.
 *
 * The port is a pure, I/O-free, addon-free contract: `execute(skill, args, opts?)`
 * returns a captured `SkillExecutionResult`. The default impl (`SandboxedSkillExecutor`,
 * T1.3) runs the skill in an isolated V8 context; an out-of-process impl is a future
 * seam (ADR D1 + D2 — DIP keeps the addon out of the domain layer).
 *
 * RED for this task is the typecheck error from the absent module, not a runtime assert.
 *
 * @see .claude/knowledge-base/plans/agentic-skill-execution-sandbox-plan.md § T1.1 + ADR D1
 */
import { describe, test, expectTypeOf } from 'vitest';

import type { Skill } from '../skill.js';
import type {
  SkillExecutor,
  SkillExecutionOptions,
  SkillExecutionResult,
} from './skill-executor.js';

describe('SkillExecutor — type-level shape (T1.1)', () => {
  test('execute(skill, args, opts?) -> Promise<SkillExecutionResult>', () => {
    expectTypeOf<SkillExecutor['execute']>().parameters.toEqualTypeOf<
      [Skill, Readonly<Record<string, unknown>>, SkillExecutionOptions?]
    >();
    expectTypeOf<SkillExecutor['execute']>().returns.toEqualTypeOf<
      Promise<SkillExecutionResult>
    >();
  });

  test('SkillExecutionResult shape: output unknown + truncated + elapsedMs', () => {
    expectTypeOf<SkillExecutionResult>().toEqualTypeOf<{
      readonly output: unknown;
      readonly truncated: boolean;
      readonly elapsedMs: number;
    }>();
  });

  test('SkillExecutionOptions: all four fields optional numbers', () => {
    expectTypeOf<SkillExecutionOptions>().toEqualTypeOf<{
      readonly timeoutMs?: number;
      readonly memoryLimitMb?: number;
      readonly maxOutputBytes?: number;
      readonly maxToolCalls?: number;
    }>();
  });
});
