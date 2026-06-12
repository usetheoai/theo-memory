/**
 * T1.1 RED type-tests for the `Skill` / `ScopedSkillMemory` contract.
 *
 * Asserts the type-level shape of the v0.6 public skill surface BEFORE any
 * runtime code lands. Failures at this layer surface as `tsc --noEmit` errors,
 * not at vitest runtime (mirrors the existing `memory-store.test-d.ts` precedent).
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T1.1
 * @see .claude/knowledge-base/discoveries/blueprints/skill-library-blueprint.md § ADR D2
 */
import { expectTypeOf, test } from 'vitest';

import type { MemoryItem } from './memory-item.js';
import type { Memory } from './memory-store.js';
import type {
  ConsolidateOptions,
  ConsolidationResult,
  ScopedSkillMemory,
  Skill,
  SkillDraft,
  SkillRecallOptions,
  SkillWithScore,
  SourceCluster,
} from './skill.js';

test('Skill structurally extends MemoryItem (v0.6 type discipline)', () => {
  expectTypeOf<Skill>().toMatchTypeOf<MemoryItem>();
});

test('Skill carries the discriminant kind=\'skill\' + code-as-skill payload + supersession chain (v0.6.1: code+codeLanguage NULLABLE per T0.2)', () => {
  expectTypeOf<Skill['kind']>().toEqualTypeOf<'skill'>();
  expectTypeOf<Skill['code']>().toEqualTypeOf<string | null>();
  expectTypeOf<Skill['description']>().toEqualTypeOf<string>();
  expectTypeOf<Skill['codeLanguage']>().toEqualTypeOf<'typescript' | 'javascript' | null>();
  expectTypeOf<Skill['supersededBy']>().toEqualTypeOf<string | null>();
  expectTypeOf<Skill['derivedFrom']>().toEqualTypeOf<readonly string[]>();
});

test('SkillDraft is the input shape to add() — code + description + codeLanguage only', () => {
  expectTypeOf<SkillDraft['code']>().toEqualTypeOf<string>();
  expectTypeOf<SkillDraft['description']>().toEqualTypeOf<string>();
  expectTypeOf<SkillDraft['codeLanguage']>().toEqualTypeOf<'typescript' | 'javascript'>();
});

test('SkillWithScore extends Skill with composite score in [0, 1]', () => {
  expectTypeOf<SkillWithScore>().toMatchTypeOf<Skill>();
  expectTypeOf<SkillWithScore['score']>().toEqualTypeOf<number>();
});

test('SkillRecallOptions has the v0.6 filters', () => {
  expectTypeOf<SkillRecallOptions['topK']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<SkillRecallOptions['threshold']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<SkillRecallOptions['includeSuperseded']>().toEqualTypeOf<boolean | undefined>();
});

test('ConsolidateOptions exposes clusterThreshold knob', () => {
  expectTypeOf<ConsolidateOptions['clusterThreshold']>().toEqualTypeOf<number | undefined>();
});

test('SourceCluster carries source skill IDs + their full Skill records', () => {
  expectTypeOf<SourceCluster['sourceIds']>().toEqualTypeOf<readonly string[]>();
  expectTypeOf<SourceCluster['skills']>().toEqualTypeOf<readonly Skill[]>();
});

test('ConsolidationResult is the 4-phase orchestrator return shape (D4)', () => {
  expectTypeOf<ConsolidationResult['sourceClusters']>().toEqualTypeOf<readonly SourceCluster[]>();
  expectTypeOf<ConsolidationResult['derivedSkills']>().toEqualTypeOf<readonly Skill[]>();
  expectTypeOf<ConsolidationResult['supersededIds']>().toEqualTypeOf<readonly string[]>();
  expectTypeOf<ConsolidationResult['durationMs']>().toEqualTypeOf<number>();
});

test('ScopedSkillMemory exposes 4 verbs (add / recall / consolidate / forget) and NO reflect', () => {
  expectTypeOf<ScopedSkillMemory['add']>().parameters.toEqualTypeOf<[SkillDraft]>();
  expectTypeOf<ScopedSkillMemory['add']>().returns.resolves.toEqualTypeOf<Skill>();

  expectTypeOf<ScopedSkillMemory['recall']>().parameters.toEqualTypeOf<[string, SkillRecallOptions?]>();
  expectTypeOf<ScopedSkillMemory['recall']>().returns.resolves.toEqualTypeOf<readonly SkillWithScore[]>();

  expectTypeOf<ScopedSkillMemory['consolidate']>().parameters.toEqualTypeOf<[ConsolidateOptions?]>();
  expectTypeOf<ScopedSkillMemory['consolidate']>().returns.resolves.toEqualTypeOf<ConsolidationResult>();

  expectTypeOf<ScopedSkillMemory['forget']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<ScopedSkillMemory['forget']>().returns.resolves.toEqualTypeOf<void>();
});

test('ScopedSkillMemory has exactly the 4 keys (D2 — no reflect; consolidate is the skill-specific verb)', () => {
  type Keys = keyof ScopedSkillMemory;
  expectTypeOf<Keys>().toEqualTypeOf<'add' | 'recall' | 'consolidate' | 'forget'>();
});

test('Memory.skills(repoId: string) is the v0.6 factory returning ScopedSkillMemory', () => {
  expectTypeOf<Memory['skills']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<Memory['skills']>().returns.toEqualTypeOf<ScopedSkillMemory>();
});
