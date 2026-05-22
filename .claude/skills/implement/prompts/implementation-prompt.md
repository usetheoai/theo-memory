# Implementation Halt-Loop Driver Prompt

You are mid-implementation, iteration {ITERATION}/{MAX_ITERATIONS}. The user invoked `/implement {PLAN_SLUG}` to drive a TDD halt-loop over the implementation plan.

**Plan:** `{PLAN_PATH}`
**Implementation working contract:** `{IMPLEMENTATION_PATH}`
**Time budget remaining:** `{TIME_BUDGET}`
**Progress file:** `.claude/knowledge-base/implementations/.progress-{PLAN_SLUG}.json` (gitignored)

## Your contract for this iteration

1. **Read the progress file.** Find the next task whose status is `pending` AND whose dependencies are `committed` or `done`.

2. **For the picked task, run the complete TDD cycle in order:**

### RED phase (mandatory first)

- Read the plan's TDD section for this task
- Write the failing test FIRST in the declared `.test.ts` file
- Run `npm test -- {test-file-path}` and CONFIRM it FAILS for the expected reason
- If the test passes BEFORE implementation, the test does not exercise the targeted behavior — HALT, revise the test
- Update progress file: task status → `red`, log iteration outcome

### GREEN phase

- Write the MINIMAL production code that makes the RED test pass
- Run `npm test -- {test-file-path}` and confirm PASS
- If still failing after a reasonable attempt, increment task retry counter (max 3 per task)
- After 3 GREEN failures, mark task BLOCKED with reason "implementation strategy not viable"
- Update progress file: task status → `green`, log iteration outcome

### REFACTOR phase

Review the new code against quality rules from `SKILL.md § Quality rules`:

- **SOLID:** SRP (one reason to change), OCP (composition over inheritance), LSP (subtypes substitute), ISP (role-shaped interfaces), DIP (`src/core/` ↛ `src/local|cloud/`)
- **Clean Code:** naming conventions, function size, no dead code, no `any`, no `console.log`
- **DRY:** rule of three for extraction; don't merge code that looks similar but represents different concepts
- **Design Patterns:** apply established patterns when the problem matches; don't invent

If any violation found, fix it. Tests stay green throughout. If tests break, revert REFACTOR changes and continue (refactor was wrong shape).

Update progress file: task status → `refactor`, log iteration outcome.

### WIRING phase (HARD GATE — the main rule)

Identify the new public symbols introduced by this task (functions, classes, types exported from the changed files). For each symbol, run:

```bash
python3 .claude/skills/implement/scripts/check_wiring.py \
  --symbol {symbol-name} \
  --project-root .
```

The script emits JSON with three pillars:

- **(a) Static caller** — must find ≥1 production caller (non-test file under `src/`)
- **(b) Integration test** — must find ≥1 file under `tests/integration/` referencing the symbol OR an explicit `<!-- ADR-DEFER-WIRING-B: reason -->` marker in the implementation task contract
- **(c) Runtime metric** — if the plan's task or Global DoD declared a metric (`metric:name`), `.wiring-evidence.json` must show `name: count > 0`. If no metric declared, this pillar is `n/a`.

**Failure handling:**

- Pillar (a) FAIL: do NOT commit. Add a caller in production code (the caller must be functionally necessary — never a no-op call gaming the metric). If no real caller justifies this symbol, the symbol is dead code; remove it.
- Pillar (b) FAIL: add an integration test that exercises the symbol via a real boundary scenario, OR add `<!-- ADR-DEFER-WIRING-B: <rationale> -->` with reason (prototype phase, third-party API not yet stable, etc.).
- Pillar (c) FAIL: run the integration test that should fire the metric; if it doesn't fire, the wiring is wrong (metric is declared but not exercised). Fix and re-check.

After triad passes, update progress file: task status → `wired`, log iteration outcome.

### COMMIT phase

**Model routing (teacher/student split — experimental, T2.2-A of teacher-student-model-split plan):**

Before composing the commit message, check `.claude/rules/implement-model-routing.txt`. If a `commit:` entry exists (e.g., `commit: haiku ...`), delegate the commit-message composition to a nested `Agent` tool invocation with `model: <resolved>` and a phase-focused sub-prompt (stage facts + plan task ref + wiring summary as input; let the student model author only the one-line description + body). Main session retains the stage + commit execution (so git operations stay observable in the halt-loop transcript).

If the rule file is **missing** OR the `commit:` entry is **absent**, fall back to inline composition on the session model (status quo, no Agent nesting). See `.claude/rules/cycle-implement.md § Model routing` for the contract.

Standard commit instructions (apply whether routed or inline):

- Stage ONLY the files modified by this task (`git add` with specific file paths — NEVER `git add -A` or `git add .`)
- Commit with conventional-commit format:
  ```
  {type}({scope}): {one-line description}

  T{N.M}: {plan task reference}
  Wiring: a={pass/defer} b={pass/defer} c={pass/n/a}
  Closes: {issue-ref if applicable}
  ```
  Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- NEVER `git commit --no-verify` — if pre-commit hook fails, fix the underlying issue (Inquebrável Rule)
- Capture the commit SHA from `git rev-parse HEAD`

Update progress file: task status → `committed`, log SHA + iteration outcome.

### PROGRESS update

Append to `.claude/knowledge-base/implementations/.progress-{PLAN_SLUG}.json`:

```json
{
  "task_id": "T1.1",
  "status": "committed",
  "wiring": {"a": "pass", "b": "pass", "c": "n/a"},
  "commit_sha": "abc123...",
  "iterations_used": 7,
  "phases_completed": ["red", "green", "refactor", "wiring", "commit"]
}
```

## Re-evaluate halt conditions

After completing a task (or marking it BLOCKED), verify:

1. **Every task in the progress file has status `committed` OR `blocked` with reason.** Pending tasks remain → continue iterating.
2. **No task is `red`, `green`, `refactor`, or `wired` without `committed`.** A stuck mid-phase task → continue iterating to finish.
3. **All Acceptance Criteria checkboxes from the implementation task contract are TRUE.**

If ALL conditions hold, emit:

```
<promise>IMPLEMENTATION_COMPLETE</promise>
```

Then report: tasks completed / tasks blocked / iterations used / wiring triad summary / next step recommendation (run `scripts/run_validation.py`).

If conditions NOT met, do NOT emit the promise. STOP your current turn — the Stop hook will restart you in iteration {ITERATION + 1}.

## Inviolable rules (cycle-implement.md § Anti-patterns)

- NEVER write production code without a failing test first (TDD-first)
- NEVER mark a task `done` with red/skipped tests
- NEVER edit the implementation plan (`{PLAN_PATH}`) mid-iteration — the plan is the contract
- NEVER commit directly to `main` (verify `git branch --show-current` != `main` before each commit)
- NEVER use `git checkout`, `git revert`, `git push --force`, `git reset --hard` — use `git switch`, `git restore --staged`, `git stash`
- NEVER `--no-verify` to skip hooks
- NEVER scope-creep mid-task — opportunistic improvements go to followups, not current commit
- NEVER fabricate wiring evidence — if pillar (c) needs a metric that the system doesn't emit, mark BLOCKED, not faked

## When the loop should give up

If `iterations_used >= {MAX_ITERATIONS}` OR `time_budget` exhausted OR the same task fails GREEN 3 times in a row:

- Mark all remaining `pending` tasks as `blocked` with reason "loop exhausted"
- Emit the promise WITH the honest blocked-tasks report
- Do NOT pretend the implementation is complete (Inquebrável Rule 3)

The downstream validation gate (`run_validation.py`) will catch incomplete work regardless. Honest BLOCKED over false completion.
