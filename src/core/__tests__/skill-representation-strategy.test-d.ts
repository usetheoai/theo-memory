/**
 * T1.2 RED test-d for SkillRepresentationStrategy DIP per plan voyager-skill-library.
 *
 * Type-level conformance: any class implementing SkillRepresentationStrategy
 * MUST expose a `kind` discriminant + `serialize` / `deserialize` round-trip.
 * Method count: 2 required + 1 readonly tag.
 *
 * 7th DIP (slot only; no v0.6 implementation per plan ADR D2 + blueprint Rec #2).
 * Declared as the YAGNI-edge reservation for future representation strategies
 * (natural-language specs etc.); v0.6 ships only the code-as-skill shape inline
 * inside the consolidate orchestrator.
 *
 * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T1.2 + ADR D2
 * @see .claude/knowledge-base/discoveries/blueprints/voyager-skill-library-blueprint.md § Recommendation #2
 */
import { expectTypeOf, test } from 'vitest';

import type {
  SkillRepresentation,
  SkillRepresentationStrategy,
} from '../dip/skill-representation-strategy.js';
import type { SkillDraft } from '../skill.js';

test('SkillRepresentation enumerates the reserved strategy tags', () => {
  expectTypeOf<SkillRepresentation>().toEqualTypeOf<'code' | 'nl-spec'>();
});

test('SkillRepresentationStrategy.kind is the readonly discriminant', () => {
  expectTypeOf<SkillRepresentationStrategy['kind']>().toEqualTypeOf<SkillRepresentation>();
});

test('SkillRepresentationStrategy.serialize maps SkillDraft to a serialized string', () => {
  expectTypeOf<SkillRepresentationStrategy['serialize']>().parameters.toEqualTypeOf<[SkillDraft]>();
  expectTypeOf<SkillRepresentationStrategy['serialize']>().returns.toEqualTypeOf<string>();
});

test('SkillRepresentationStrategy.deserialize maps a serialized string back to a SkillDraft', () => {
  expectTypeOf<SkillRepresentationStrategy['deserialize']>().parameters.toEqualTypeOf<[string]>();
  expectTypeOf<SkillRepresentationStrategy['deserialize']>().returns.toEqualTypeOf<SkillDraft>();
});

test('SkillRepresentationStrategy has exactly 3 keys (kind + serialize + deserialize)', () => {
  type Keys = keyof SkillRepresentationStrategy;
  expectTypeOf<Keys>().toEqualTypeOf<'kind' | 'serialize' | 'deserialize'>();
});
