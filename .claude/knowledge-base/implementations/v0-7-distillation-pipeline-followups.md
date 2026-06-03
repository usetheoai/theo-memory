# v0-7-distillation-pipeline — followups

## F-7-1: ConsolidationResult → ConflictResolutionResult rename
**Observed during:** T1.1 (iteration 2)
**Description:** Plan T1.1 declared type `ConsolidationResult` but `src/core/index.ts:50` already exports v0.6 voyager-skill-library `ConsolidationResult` (skill-memory domain). Renamed v0.7 type to `ConflictResolutionResult` (collision-free + matches DIP name).
**Impact on downstream tasks:** T1.2 (Noop/LWW), T1.3 (LlmJudgedMerge), T2.1 (wire reflect), T3.3 (THE GOAL TEST) — all references to "ConsolidationResult" in plan should be read as `ConflictResolutionResult` for v0.7 contexts.
**Recommended owner:** future plan author when v0.7.X revision lands; update plan v1.2 to use the new name.

## F-7-2: T1.1 RED test location moved to match precedent
**Observed during:** T1.1 (iteration 2)
**Description:** Plan T1.1 declared RED test at `tests/unit/conflict-resolution/dip-shape.test.ts` but vitest.contract typecheck only covers `src/{core,theokit}/**/__tests__/**/*.test-d.ts` AND type-only imports erase at runtime — RED would silently pass. Relocated to `src/core/__tests__/dip-conflict-resolution-policy.test.ts` to match `dip-eviction-policy.test.ts` v0.4b precedent; tsconfig.contract `src/core/` include forces tsc-enforced RED.
**Impact on downstream tasks:** none (T1.2/T1.3 will follow new convention).
**Recommended owner:** future plan author should update to-plan/SKILL.md preflight check to validate test-path-vs-config reachability for type-only assertions.
