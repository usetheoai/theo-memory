---
name: implement
description: Executes an implementation plan from cycle-plan via halt-loop (ralph-loop) with TDD discipline + wiring triad (caller + integration test + runtime metric) + quality gates (SOLID, Clean Code, DRY, Design Patterns). Single entry-point for cycle-implement. Use after /to-plan chain returned verdict ≥ SHIPPABLE_WITH_CAVEATS and a feature branch is ready.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "{plan-slug} [--max-iterations 50] [--time-budget 8h]"
---

# Implement — Plan → Code Halt-Loop

Single entry-point for [`cycle-implement`](../../rules/cycle-implement.md). Reads a validated implementation plan, drives an autonomous TDD halt-loop task-by-task, enforces the **wiring triad** + quality rules, and produces commits on a feature branch ready for `cycle-review`.

## Cycle contract

This skill is **the only phase** of [`cycle-implement`](../../rules/cycle-implement.md). The cycle rule is the **source of truth** for:

- Pre-conditions (plan verdict ≥ SHIPPABLE_WITH_CAVEATS; feature branch ready; not on `main`)
- Hard gates (TDD RED phase MUST fail; TDD GREEN MUST pass; wiring triad; validate gate)
- Stop conditions (3-attempt fail per task; max iterations; environment broken)
- Anti-patterns (no TDD-skip, no main commits, no `git checkout`/`git revert`/`git push --force`)
- Rollback (`git stash` + `git switch`/`--soft reset`, NEVER `--hard`)

**Read `cycle-implement.md` before invoking this skill.** This SKILL.md retains phase-specific detail (halt-loop driver workflow, wiring triad script, quality-rule enforcement during execute, validation gate).

## When to Trigger

User explicitly invokes `/implement {plan-slug}` when:

- A plan at `.claude/knowledge-base/plans/{slug}-plan.md` has `/plan-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- A feature branch is set up (verify: `git branch --show-current` ≠ `main`)
- The development environment is operational (`npm install` done; Postgres up if integration tests require it)

Refuse to start when any pre-condition fails — surface the missing piece honestly.

## Quality rules (enforced during the halt-loop)

These are the rules that EVERY task in the halt-loop honors. Phase-specific enforcement:

### SOLID

Each new module/class/function checked against SOLID at REFACTOR phase of TDD:

- **SRP**: function/class has ONE reason to change. If you used "and" in the description ("X validates AND persists AND notifies"), split.
- **OCP**: prefer composition over inheritance for variation points. Add behavior via new code, not by editing existing switch/case branches.
- **LSP**: subtypes substitute parent without breaking callers. No `NotImplementedException` in overrides.
- **ISP**: interfaces are role-shaped, not header-shaped. If consumers depend on methods they don't call, split the interface.
- **DIP**: high-level modules (e.g., `src/core/`) MUST NOT import from low-level (`src/local/`, `src/cloud/`). Enforced by `.claude/hooks/boundary-check.sh`.

### Clean Code

- Naming: kebab-case files, PascalCase types, camelCase functions, UPPER_SNAKE_CASE constants (per `architecture.md § Naming conventions`)
- Function size: < 20 lines as guideline; if larger, justify or split
- No comments explaining WHAT (well-named code already does that); only WHY when non-obvious
- No dead code: every export reachable from a public entry-point OR a test
- No `any` in TypeScript (`architecture.md § Module hygiene`)
- No `console.log` in production paths — use structured logger from `src/core/`

### DRY

- Rule of three: extract abstraction only on the third repetition of the same KNOWLEDGE
- Code that LOOKS similar but represents DIFFERENT concepts: do NOT merge — accidental coupling is worse than minor duplication
- Constants and enums centralized; magic numbers forbidden

### Design Patterns

Use established patterns when the problem matches; do NOT invent novel patterns mid-implementation.

Common patterns relevant to TheMemory's domain:

- **Adapter** (`src/local/`, `src/cloud/`) — implements the same contract for different runtimes
- **Strategy** (retrieval scorer variants: additive Mem0-style vs multiplicative Generative Agents) — interchangeable algorithms behind a stable contract
- **Repository** (memory store boundary) — abstracts persistence behind a domain-shaped interface
- **Pipeline** (Mem0's six-phase write) — sequential stages with explicit fallbacks

When a `*-patterns` skill from `cycle-discover` is registered AND its trigger phrases match the current task, the halt-loop SHOULD consult it as documented in `to-plan/SKILL.md § Step 0`. Override of a pattern requires an ADR.

### WIRING (HARD GATE — the main rule)

**Implementation is NOT done until it is wired.** "Code compiles" and "tests pass" are necessary but NOT sufficient.

The wiring triad — enforced by `scripts/check_wiring.py` at the end of every task and before final commit:

| Pillar | What it asserts | Enforcement |
|---|---|---|
| **(a) Static caller** | Every new public export is invoked by at least 1 production caller | `grep -rl 'symbolName' src/ --exclude='*test*' --exclude-dir=node_modules` must return ≥1 file |
| **(b) Integration test** | Every new behavior is exercised in at least 1 integration test that hits the real boundary (Postgres + pgvector, real LLM stub with deterministic fixture, etc.) | `grep -rl 'symbolName' tests/integration/` must return ≥1 file OR ADR-deferred for first-iteration prototypes |
| **(c) Runtime metric** | Every metric/counter declared in the plan's Global DoD is observed non-zero during an integration test run | `.wiring-evidence.json` (written by integration test infra) shows `metric_name: count > 0` OR plan declared no metrics for this task |

Failure of any pillar = HALT before commit. The halt-loop iterates until all three pass OR an ADR explicitly defers a pillar with rationale (warn-first for pillars (b) and (c) during prototype phases; pillar (a) is non-negotiable).

**Pre-code phase reality check.** In a project without `src/` (pre-release, like TheMemory today), the `.wiring-evidence.json` writer infra does not yet exist. Any plan that declares a runtime metric MUST explicitly defer pillar (c) via an ADR, e.g.: `ADR D-wiring-c: pillar (c) deferred until integration-test infra ships with evidence writer (planned: v0.1)`. Without that ADR, the first task declaring a metric will HALT at pillar (c) with no remediation path. Plans authored during pre-code phase SHOULD either omit metric declarations or include the deferral ADR upfront.

**Why the triad exists:** "code compiles + unit tests pass" routinely lets dead code, orphan exports, and unobserved metrics ship as if they were wired. The triad forces evidence that the new symbol is actually called from production paths, exercised by an integration test against the real boundary, and (when the plan promised observability) observed firing at least once.

## Workflow

### Step 1 — Pre-condition validation (refuse if any fails)

```bash
# Check 1: plan exists and verdict is acceptable
test -f .claude/knowledge-base/plans/{slug}-plan.md
# Check 2: not on main
[ "$(git branch --show-current)" != "main" ]
# Check 3: no uncommitted changes
[ -z "$(git status --porcelain)" ]
# Check 4: tooling present
command -v npm && npm --version
# Check 5: project bootstrapped (if applicable — pre-code projects skip this gracefully)
test -f package.json || echo "WARN: package.json missing — pre-code phase, validate gate will skip npm-based checks"
```

If any HARD check fails, refuse to start. Surface the missing piece.

### Step 2 — Parse plan into ordered task list

Read `.claude/knowledge-base/plans/{slug}-plan.md`. Extract:

- Phase list with dependencies (declared in plan's Dependency Graph section)
- Per-task: Files to edit, TDD section (RED tests), Acceptance Criteria, DoD entries
- Global DoD entries (test/typecheck/lint/coverage gates + runtime-metric proof targets)

Write the ordered task list to `.claude/knowledge-base/implementations/{slug}-implementation.md` using `templates/implementation-task-template.md`. This file is the halt-loop's working contract.

### Step 3 — Build the halt-loop prompt

Read `prompts/implementation-prompt.md` and substitute:

- `{PLAN_SLUG}`, `{PLAN_PATH}`, `{IMPLEMENTATION_PATH}`
- `{MAX_ITERATIONS}` — default 50 (more than discover-execute because TDD has 3 phases per task)
- `{TIME_BUDGET}` — default 8h (configurable; warn at 75%, halt at 100%)

### Step 4 — Invoke ralph-loop

Use the Skill tool to invoke `ralph-loop:ralph-loop` with the assembled prompt + `--completion-promise IMPLEMENTATION_COMPLETE` + `--max-iterations N`.

Each iteration executes ONE task's complete TDD cycle:

1. **RED phase:** write the failing test from the plan's TDD section, run it, confirm FAIL
2. **GREEN phase:** write minimal production code, run test, confirm PASS
3. **REFACTOR phase:** review code against SOLID/Clean Code/DRY rules; clean up; tests stay green
4. **WIRING phase:** run `python3 .claude/skills/implement/scripts/check_wiring.py {symbol-name}` — HALT if any pillar fails
5. **COMMIT phase:** atomic commit with conventional-commit format (`feat(scope): description`, `fix(scope): description`, etc.) referencing plan task ID
6. **PROGRESS:** update `.progress-{slug}.json` audit trail

If a task fails at any phase, the iteration HALTS (no commit), surfaces the failure honestly, and the loop attempts up to 3 retries with revised approach. After 3 attempts, mark task BLOCKED and continue OR escalate to human per stop conditions in cycle rule.

### Step 5 — Final validation gate

After the halt-loop emits `<promise>IMPLEMENTATION_COMPLETE</promise>` (or exhausts), run:

```bash
python3 .claude/skills/implement/scripts/run_validation.py {slug}
```

This script runs (and gates on):

- `npm test` — exit 0 (or skip if package.json absent — pre-code phase)
- `npm run typecheck` — exit 0
- `npm run lint` — exit 0
- `npm run test:coverage` — ≥ 90% on changed files; 100% on critical paths declared in plan
- Wiring summary — re-run `check_wiring.py` aggregated across all changed symbols

Outputs JSON report at `.claude/knowledge-base/reviews/{slug}-implement-validate-{date}.md`.

### Step 6 — Recommend next step

```
=== /implement complete ===
Plan: {slug}
Branch: {feature-branch}
Tasks completed: N / total
Tasks blocked: M (see .progress-{slug}.json for reasons)
Validation verdict: PASS / FAIL / PARTIAL

Wiring triad summary:
  (a) Static caller:    N/N symbols wired
  (b) Integration test: N/N symbols covered
  (c) Runtime metric:   N/N metrics observed non-zero

Next: cycle-review (when implemented) — for now, manual review of PR + merge.
To handoff: gh pr create
```

## Halt-loop invariants

- The skill NEVER commits directly to `main` (Inquebrável Rule 4)
- The skill NEVER uses `git checkout`, `git revert`, `git push --force`, `git reset --hard` (Inquebrável Rule 4) — uses `git switch`, `git restore --staged`, `git stash` instead
- The skill NEVER skips `--no-verify` on pre-commit hooks (Inquebrável: fix the root cause, not bypass)
- The skill NEVER writes production code without a failing test first (TDD-first, Inquebrável Rule 5)
- The skill NEVER fabricates runtime-metric evidence — if `.wiring-evidence.json` is missing, the metric is unproven
- The skill NEVER edits `.claude/knowledge-base/plans/{slug}-plan.md` during execution — the plan is the contract; revisions go through `cycle-plan` again
- The skill NEVER scope-creeps mid-task — opportunistic improvements logged to `{slug}-followups.md`, NOT included in current commit

## When to give up honestly

Per `cycle-implement.md § Stop conditions`:

1. Task fails GREEN 3 times → BLOCKED, surface to human
2. Halt-loop max iterations reached → emit promise with honest "tasks N through M remaining"
3. External dependency missing (Postgres down, lib not installed) → halt; surface for human to fix environment
4. Plan task assumes behavior contradicted by reality (e.g., referenced pattern doesn't actually exist) → halt; loop back to `cycle-plan` for revision

Honest BLOCKED > false completion (Inquebrável Rule 3).

## Related

- Cycle rule (SoT): [`cycle-implement.md`](../../rules/cycle-implement.md)
- Upstream cycle: [`cycle-plan.md`](../../rules/cycle-plan.md) — consumes its output
- Downstream cycle: [`cycle-review.md`](../../rules/cycle-review.md) — consumes this skill's output (when built)
- Templates: `templates/implementation-task-template.md`
- Prompts: `prompts/implementation-prompt.md`
- Scripts: `scripts/check_wiring.py`, `scripts/run_validation.py`
- Loop engine: `ralph-loop` plugin (must be enabled in `~/.claude/settings.json`)
- Project rules consumed: `architecture.md` (DIP, naming, hygiene), `testing.md` (TDD pyramid)
- Hooks enforced: `.claude/hooks/validate-command.sh` (git safety), `.claude/hooks/boundary-check.sh` (DIP)

## Anti-patterns specific to /implement

These are anti-patterns INSIDE the halt-loop that go beyond the cycle-level anti-patterns documented in `cycle-implement.md`:

1. **Marking a task `done` because "tests pass" without running wiring triad** — the triad is the difference between code-that-compiles and code-that-runs-in-the-system.
2. **Skipping REFACTOR phase to "save time"** — refactor is where SOLID/Clean Code violations are caught. Skipping it accumulates debt by the iteration.
3. **Writing tests AFTER code "just to verify"** — that's not TDD; that's regression testing. RED must precede GREEN.
4. **Inventing a Design Pattern not declared in the plan** — if the plan didn't specify Strategy here, don't introduce it mid-task. If a pattern is clearly missing, halt and revise plan.
5. **Wiring a new function with a forced caller** (e.g., adding a no-op call from main just to satisfy pillar (a)) — that's gaming the metric. The caller must be functionally necessary.
