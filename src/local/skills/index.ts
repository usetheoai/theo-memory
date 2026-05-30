/**
 * v0.6 — public barrel for the code-as-skill orchestrator surface.
 *
 * `consolidate()` is the 4-phase orchestrator (Orient → Gather → Consolidate →
 * Report) wrapping the v0.4a `executeReflection + validateProvenance + insertDerivedSkill`
 * chain to produce `kind='skill'` derived rows with `derived_from = cluster.sourceIds`.
 *
 * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T3.1 + ADRs D1 + D4
 */
export { consolidate } from './consolidate.js';
export type { ConsolidateDeps } from './consolidate.js';
