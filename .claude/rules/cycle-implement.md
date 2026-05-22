---
cycle: implement
phases:
  - implement       (single entry-point; orchestrates internally via ralph-loop halt-loop)
trigger: when a plan from cycle-plan has verdict ≥ SHIPPABLE_WITH_CAVEATS and is ready to be coded
output: feature branch with atomic commits per task, validation report, ready for cycle-review
status: v1.0 ACTIVE — skill `/implement` built and validated 2026-05-21
---

# Cycle: Implement

Source of truth for the implementation-execution cycle. **Status: v1.0 ACTIVE.** Single skill `/implement` (in `.claude/skills/implement/`) drives the cycle via ralph-loop halt-loop. The original v0.1 PROPOSED design (3 separate skills: to-implement, implement-execute, implement-validate) was consolidated into 1 entry-point at strategic review 2026-05-21 to reduce orchestration complexity.

## Purpose

Convert a validated implementation plan from cycle-plan into working code, with TDD discipline, halt-loop execution, and quality gates before handoff to cycle-review.

## Trigger conditions

Invoke this cycle when:

- A plan at `.claude/knowledge-base/plans/{slug}-plan.md` has `/plan-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- All MUST FIX items from `/edge-case-plan` were absorbed (plan ≥ v1.1)
- The feature branch is set up (NEVER work directly on `main` per Inquebrável Rule 4)
- All project tooling is operational (`npm install` done, Postgres up if integration tests need it, etc.)

Do NOT invoke when:

- Plan verdict is INVALID or NON_SHIPPABLE — loop back to cycle-plan first
- Plan contains unmapped Coverage Matrix gaps — fix the plan
- A previous `/implement-execute` for this slug is mid-flight with unmerged commits — finish or abort it first

## Chain (v1.0 — inquebrável)

```
/implement {plan-slug}
  ↓ pre-condition validation (refuse if any fails)
  ↓   - plan verdict ≥ SHIPPABLE_WITH_CAVEATS
  ↓   - not on `main`; no uncommitted changes
  ↓   - tooling present (npm) or package.json absent (pre-code phase SKIP)
  ↓ parse plan → ordered implementation task list at
  ↓   .claude/knowledge-base/implementations/{slug}-implementation.md
  ↓
  ↓ invoke ralph-loop:ralph-loop with halt-loop prompt:
  ↓ FOR EACH task in dependency order:
  ↓   RED phase     — write failing test FIRST; confirm it fails
  ↓   GREEN phase   — minimal code; test passes (max 3 retries per task)
  ↓   REFACTOR phase — SOLID + Clean Code + DRY review; tests stay green
  ↓   WIRING phase  — triad check (scripts/check_wiring.py):
  ↓                   (a) Static caller   — grep production callers ≥ 1
  ↓                   (b) Integration test — grep tests/integration/ ≥ 1 OR ADR-DEFER
  ↓                   (c) Runtime metric   — .wiring-evidence.json count > 0 OR n/a
  ↓                   HALT before commit if any required pillar fails
  ↓   COMMIT phase  — staged-files-only commit, conventional-commits format
  ↓                   NEVER --no-verify, NEVER on main
  ↓ emits <promise>IMPLEMENTATION_COMPLETE</promise> when all tasks done OR honest BLOCKED
  ↓
  ↓ final validation gate (scripts/run_validation.py):
  ↓   - npm test (or SKIP if package.json absent)
  ↓   - npm run typecheck (or tsc --noEmit fallback)
  ↓   - npm run lint (or SKIP)
  ↓   - npm run test:coverage (≥ 90% changed files, 100% critical paths)
  ↓   - wiring triad aggregation
  ↓ produces validation report at
  ↓   .claude/knowledge-base/reviews/{slug}-implement-validate-{date}.md
  ↓
  ↓ if validation PASS:
HANDOFF — cycle-review can begin
```

## Phase contracts (v1.0)

Single phase, but logically broken into 3 stages by the halt-loop:

| Stage | Input | Output | Success criterion |
|---|---|---|---|
| **Pre-condition + parse** | `plans/{slug}-plan.md` (verdict ≥ SHIPPABLE_WITH_CAVEATS) + repo state | `implementations/{slug}-implementation.md` (ordered task list) | All pre-conditions PASS; task list reflects plan exactly |
| **Halt-loop execute** | Implementation task list + feature branch | Atomic commits per task + `.progress-{slug}.json` | All tasks status=`committed` OR honest BLOCKED report |
| **Final validation** | Code on feature branch + progress audit | JSON validation report + handoff decision | All validate gates PASS (or SKIP gracefully in pre-code phase) |

## Hard gates (cannot advance — BLOCK the cycle)

1. **Pre-condition fail** — plan verdict < SHIPPABLE_WITH_CAVEATS OR working on `main` OR uncommitted changes from prior cycle. Refuse to start.
2. **TDD RED phase did not fail** — if the test passes BEFORE implementation, the test does not exercise the targeted behavior. Halt and revise the test.
3. **TDD GREEN phase has test failures** — code does not satisfy the test. Halt; do NOT commit failing tests.
4. **Wiring triad pillar (a) FAIL** — symbol has zero production callers. NON-NEGOTIABLE. Symbol must be deleted OR a functionally necessary caller added (never a no-op gaming the metric). Halt before commit.
5. **Wiring triad pillar (b) FAIL without ADR-DEFER** — symbol not exercised in `tests/integration/`. Halt; either add integration test OR add explicit `<!-- ADR-DEFER-WIRING-B: <reason> -->` marker.
6. **Wiring triad pillar (c) FAIL** — plan declared a runtime metric for this task but `.wiring-evidence.json` doesn't show count > 0. Halt; integration test does not exercise the metric path.
7. **Final validation FAIL gate** — any of test/typecheck/lint/coverage fail. Halt before handoff to cycle-review.
8. **Plan task references a file that did not exist when the plan was written AND was not marked `(NEW)`** — fabrication; abort and loop back to cycle-plan.

## Soft gates (advance, but require human review)

1. **Coverage < 100% on critical path** — Global DoD said 100%; halt-loop reached 95%. Surface to human: accept WITH_CAVEATS or push to 100%.
2. **Test took > N seconds** (configurable; suggested 30s for integration) — soft warning, not failure.
3. **REFACTOR phase made non-trivial structural changes** — surface diff to human; ensure no scope creep into the next task.
4. **Commit message did not follow conventional-commits format** — surface; ask user to amend if cosmetic.

## Stop conditions (cycle aborts honestly — NOT a failure)

1. **Task fails to GREEN after 3 implementation attempts** — mark task BLOCKED with reason "implementation strategy not viable"; surface to human. Do NOT skip and continue (poisons the chain).
2. **Halt-loop max iterations reached** — emit promise with honest "tasks N through M remaining" report.
3. **External dependency missing** — Postgres down for integration test, npm package not installed. Halt; surface for human to fix the environment.
4. **Plan task assumes behavior contradicted by reality** — e.g., a borrowed pattern doesn't actually exist in `referencia/` even though plan cited it. Halt; loop back to cycle-discover or cycle-plan.

## Anti-patterns (NEVER do these — violates the contract)

1. **NEVER write production code without a failing test** (Inquebrável Rule 5, TDD-first). RED MUST precede GREEN.
2. **NEVER mark a task `done` if its tests are skipped, commented, or red.** Done means all tests green AND coverage gate passes AND lint green.
3. **NEVER edit the implementation plan during `/implement-execute`** — if the plan is wrong, halt and loop back to cycle-plan. The plan is the contract.
4. **NEVER commit with `--no-verify`** to skip pre-commit hooks (Inquebrável Rule via global CLAUDE.md). If a hook fails, fix the underlying issue.
5. **NEVER commit directly to `main`** (Inquebrável Rule 4). Feature branch only.
6. **NEVER use `git checkout`, `git revert`, `git push --force`, or `git reset --hard`** (Inquebrável Rule 4). Use `git switch`, `git restore --staged`, `git stash` instead.
7. **NEVER scope-creep mid-task** — if you discover an unrelated improvement opportunity, log it in `implementations/{slug}-followups.md` and continue with the current task.
8. **NEVER bypass `/implement-validate`** even if "it's just a tiny change" — validate is the gate; tiny changes silently break things.
9. **NEVER fabricate runtime-metric proof** — the plan's Global DoD requires observing the metric non-zero. Reading the code that emits the metric is NOT proof; the metric must actually fire in an integration workload.

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Implementation task list in `implementations/{slug}-implementation.md` | Delete file; no further state to revert |
| Commits on feature branch | Standard git workflow: `git reset --soft HEAD~N` (NOT `--hard` per Inquebrável); `git stash` before reset |
| `.progress-{slug}.json` audit trail | Delete file; halt-loop will re-derive from commits |
| Validation report | Delete file |

NEVER rollback `main` — work happens on feature branches. If the cycle produced bad code, abandon the branch (or do `git switch main` then delete the feature branch after `git push --delete origin {branch}`).

## Cross-references

- Phase SKILL.md: [`implement/`](../skills/implement/SKILL.md)
- Wiring triad script: `.claude/skills/implement/scripts/check_wiring.py`
- Validation gate script: `.claude/skills/implement/scripts/run_validation.py`
- Implementation task template: `.claude/skills/implement/templates/implementation-task-template.md`
- Halt-loop prompt: `.claude/skills/implement/prompts/implementation-prompt.md`
- Loop engine: `ralph-loop` plugin (must be enabled in `~/.claude/settings.json`)
- Project rules consumed: `architecture.md` (DIP, naming, module hygiene), `testing.md` (TDD pyramid)
- Hooks enforced: `.claude/hooks/validate-command.sh` (git safety), `.claude/hooks/boundary-check.sh` (DIP boundaries)
- Cycle inputs: plan from `cycle-plan.md` (verdict ≥ SHIPPABLE_WITH_CAVEATS)
- Cycle output: feature branch ready for `cycle-review.md`
- Patterns skills (registered by `cycle-discover.md`): consumed at task-level when implementing borrowed patterns; `/to-plan` Step 0 already wired this discovery into the plan

## Versioning

This cycle rule is **v1.0 ACTIVE** as of 2026-05-21. Promoted from v0.1 PROPOSED after the strategic review consolidated 3 proposed skills into 1 entry-point + halt-loop, and the `/implement` skill was built + scripts validated.

### v0.1 → v1.0 resolved decisions

The 5 open design questions from v0.1 are resolved as follows:

1. **Halt-loop engine?** → `ralph-loop:ralph-loop`. Commit hygiene (one commit per task) is honored by the halt-loop emitting promise ONLY when task's status=`committed`; halt-loop's restart pattern is fine because state lives in `.progress-{slug}.json` and is read at iteration start.
2. **Implementation task list location?** → `.claude/knowledge-base/implementations/{slug}-implementation.md` (markdown working contract) + `.progress-{slug}.json` (machine-readable state). Both, complementary roles.
3. **Validation BLOCK on test runtime?** → SOFT warn at task level (>30s integration test surfaces a warning); HARD fail only when the test fails or times out. Speed is a separate concern from correctness.
4. **Cross-platform Postgres provisioning?** → DEFERRED to cycle-discover output (`letta-pgvector-schema` blueprint). When that blueprint passes confidence, the recommendation will inform our local-dev script.
5. **`/implement-improve` skill?** → OUT OF SCOPE. Auto-fixing lint/format is what pre-commit hooks and `npm run lint:fix` already do; a dedicated skill would duplicate. The halt-loop's REFACTOR phase covers the semantic improvements.
