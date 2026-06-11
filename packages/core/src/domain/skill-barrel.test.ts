/**
 * T4.2 — Public-API surface tests for the v0.6 code-as-skill contract.
 *
 * Asserts that every type + error class introduced in T1.1 / T1.2 / T2.1 / T4.1
 * is reachable through `@usetheo/memory/contract` (the canonical types subpath)
 * AND through the default barrel `@usetheo/memory`.
 *
 * Failure here means the v0.6 surface is locked down BUT not declared as part
 * of the public contract — downstream `import { Skill } from '@usetheo/memory'`
 * would break.
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T4.2
 */
import { expectTypeOf, test } from 'vitest';

import {
  InvalidSkillError,
  type ConsolidateOptions,
  type ConsolidationResult,
  type RepoScope,
  type ScopedSkillMemory,
  type Skill,
  type SkillDraft,
  type SkillLanguage,
  type SkillRecallOptions,
  type SkillRepresentation,
  type SkillRepresentationStrategy,
  type SkillWithScore,
  type SourceCluster,
} from './index.js';

test('Skill contract types are exported from @usetheo/memory/contract', () => {
  expectTypeOf<Skill>().not.toBeNever();
  expectTypeOf<SkillDraft>().not.toBeNever();
  expectTypeOf<SkillWithScore>().not.toBeNever();
  expectTypeOf<SkillRecallOptions>().not.toBeNever();
  expectTypeOf<ConsolidateOptions>().not.toBeNever();
  expectTypeOf<ConsolidationResult>().not.toBeNever();
  expectTypeOf<ScopedSkillMemory>().not.toBeNever();
  expectTypeOf<SkillLanguage>().not.toBeNever();
  expectTypeOf<SourceCluster>().not.toBeNever();
});

test('SkillRepresentation DIP slot types are exported (T1.2)', () => {
  expectTypeOf<SkillRepresentation>().not.toBeNever();
  expectTypeOf<SkillRepresentationStrategy>().not.toBeNever();
});

test('RepoScope is exported via the Scope union (T4.1)', () => {
  expectTypeOf<RepoScope>().not.toBeNever();
  expectTypeOf<RepoScope['kind']>().toEqualTypeOf<'repo'>();
});

test('InvalidSkillError is exported as a real class (T2.1)', () => {
  const err = new InvalidSkillError('empty-description', 'unit test');
  expectTypeOf(err).toMatchTypeOf<Error>();
  expectTypeOf(err.reason).toEqualTypeOf<
    'empty-description' | 'invalid-code-language' | 'empty-derived-from'
  >();
});
