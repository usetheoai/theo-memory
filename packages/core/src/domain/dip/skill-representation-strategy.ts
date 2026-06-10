/**
 * SkillRepresentationStrategy DIP — pluggable surface for choosing HOW a skill
 * is materialized at the serialization / LLM-prompt layer.
 *
 * 7th DIP (slot only at v0.6; no implementation ships). Reserved per plan
 * skill-library blueprint Recommendation #2 so a future
 * natural-language-spec representation can land without a contract break.
 *
 * Default `'code'` representation is consumed inline by the v0.6 consolidate
 * orchestrator (no class needed — `SkillDraft` IS the wire shape). The
 * `'nl-spec'` representation is intentionally NOT shipped in v0.6 — adding it
 * later means writing a class that implements this interface, no other plumbing.
 *
 * Divergence from plan literal text: the plan's example tags
 * `'REDACTED' | 'procmem'` are replaced with neutral
 * `'code' | 'nl-spec'` per `.claude/rules/no-paper-names-in-code.md`. The
 * DIP slot's INTENT (a future representation extension point) is unchanged.
 *
 * Method count: 1 readonly tag + 2 methods (serialize / deserialize).
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T1.2 + ADR D2
 * @see .claude/knowledge-base/discoveries/blueprints/skill-library-blueprint.md § Recommendation #2
 */
import type { SkillDraft } from '../skill.js';

/**
 * Reserved tags for the SkillRepresentationStrategy discriminant.
 *
 * - `'code'`    — executable code-as-skill payload (`SkillDraft.code` populated). v0.6 default.
 * - `'nl-spec'` — natural-language specification (e.g., Activation / Execution / Termination tuple).
 *                 No implementation ships in v0.6; the tag is reserved so a future class can claim
 *                 it without contract evolution.
 */
export type SkillRepresentation = 'code' | 'nl-spec';

/**
 * Strategy contract for serializing / deserializing skill payloads across the
 * LLM-prompt + persistence boundary.
 *
 * Round-trip invariant: for every SkillDraft `d` and every conforming strategy
 * `s`, `s.deserialize(s.serialize(d))` MUST equal `d` (structural equality on
 * the `code` / `description` / `codeLanguage` fields).
 */
export interface SkillRepresentationStrategy {
  /** Discriminant tag identifying the representation shape this strategy speaks. */
  readonly kind: SkillRepresentation;

  /** Serialize a SkillDraft into the wire/prompt string for this representation. */
  serialize(skill: SkillDraft): string;

  /** Deserialize a wire/prompt string back into a SkillDraft for this representation. */
  deserialize(raw: string): SkillDraft;
}
