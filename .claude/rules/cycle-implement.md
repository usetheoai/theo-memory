---
cycle: implement
phases:
  - implement       (single entry-point; orchestrates internally via ralph-loop halt-loop)
trigger: when a plan from cycle-plan has verdict ≥ SHIPPABLE_WITH_CAVEATS and is ready to be coded
output: feature branch with atomic commits per task, validation report, ready for cycle-review
status: v1.2 ACTIVE — skill `/implement` built 2026-05-21, SEPA augmented 2026-05-22, resume-after-blocker protocol locked 2026-05-23
---

# Cycle: Implement

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for the implementation-execution cycle. **Status: v1.2 ACTIVE.** Single skill `/implement` (in `.claude/skills/implement/`) drives the cycle via ralph-loop halt-loop. The original v0.1 PROPOSED design (3 separate skills: to-implement, implement-execute, implement-validate) was consolidated into 1 entry-point at strategic review 2026-05-21 to reduce orchestration complexity.

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

## Chain (v1.1 — inquebrável; SEPA-augmented)

```
/implement {plan-slug}
  ↓ pre-condition validation (refuse if any fails)
  ↓   - plan verdict ≥ SHIPPABLE_WITH_CAVEATS
  ↓   - not on `main`; no uncommitted changes
  ↓   - tooling present (npm) or package.json absent (pre-code phase SKIP)
  ↓ parse plan → ordered implementation task list at
  ↓   .claude/knowledge-base/implementations/{slug}-implementation.md
  ↓
  ↓ SPAWN SEPA (Staff Engineer Pair-Program Agent) as Claude Code-conformant agent at
  ↓   .claude/agents/implement-{slug}-{date}/sepa.md (YAML frontmatter + system prompt body)
  ↓   — agent `name` field: implement-{slug}-sepa (resolves as subagent_type)
  ↓   — composed from FULL plan + ADRs + edge-cases + deps audit + plan-confidence + rules
  ↓   — initial-brief via Agent(subagent_type='implement-{slug}-sepa', prompt=<question>)
  ↓   — per-iteration logs persisted to .claude/knowledge-base/implementations/{slug}/sepa-iterations/
  ↓     (NOT .claude/agents/ — that dir is reserved for agent definitions, not log outputs)
  ↓   — read-only observer; main session retains commit authority
  ↓
  ↓ invoke ralph-loop:ralph-loop with halt-loop prompt:
  ↓ FOR EACH task in dependency order:
  ↓   SEPA 1/3      — pre-RED brief: recap plan task + gotchas
  ↓   RED phase     — write failing test FIRST; confirm it fails
  ↓   GREEN phase   — minimal code; test passes (max 3 retries per task)
  ↓   SEPA 2/3      — post-GREEN review: SOLID/Clean Code/DRY violations
  ↓   REFACTOR phase — apply quality rules + SEPA findings; tests stay green
  ↓   WIRING phase  — triad check (scripts/check_wiring.py):
  ↓                   (a) Static caller   — grep production callers ≥ 1
  ↓                   (b) Integration test — grep tests/integration/ ≥ 1 OR ADR-DEFER
  ↓                   (c) Runtime metric   — .wiring-evidence.json count > 0 OR n/a
  ↓                   HALT before commit if any required pillar fails
  ↓   SEPA 3/3      — pre-COMMIT audit: DoD checkboxes + commit shape
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
  ↓
  ↓ /code-quality {plan-slug} (v1.1 — added 2026-05-22 via code-quality-skill plan)
  ↓   - Detects dead code (D1 — vulture/knip/cargo-udeps/deadcode)
  ↓   - Detects fabricated symbols (D2 — tree-sitter + registry lookup)
  ↓   - Writes audit to .claude/knowledge-base/audits/{slug}-code-quality-{date}.md
  ↓   - If verdict is FAIL_HARD or INVALID: HALT before review handoff
  ↓
HANDOFF — cycle-review can begin
```

## Phase contracts (v1.0)

Single phase, but logically broken into 3 stages by the halt-loop:

| Stage | Input | Output | Success criterion |
|---|---|---|---|
| **Pre-condition + parse** | `plans/{slug}-plan.md` (verdict ≥ SHIPPABLE_WITH_CAVEATS) + repo state | `implementations/{slug}-implementation.md` (ordered task list) | All pre-conditions PASS; task list reflects plan exactly |
| **Halt-loop execute** | Implementation task list + feature branch | Atomic commits per task + `.progress-{slug}.json` | All tasks status=`committed` OR honest BLOCKED report |
| **Final validation** | Code on feature branch + progress audit | JSON validation report + handoff decision | All validate gates PASS (or SKIP gracefully in pre-code phase) |

## Model routing (teacher/student split — experimental)

Source of truth for which model each `/implement` halt-loop phase runs on: [`.claude/rules/implement-model-routing.txt`](./implement-model-routing.txt). Consumed by `.claude/skills/implement/prompts/implementation-prompt.md` (halt-loop driver) when rule file is present.

- **RED phase** — judgment-heavy (write failing test). **No entry → session model** (status quo, typically opus).
- **GREEN phase** — minimal code to pass. Student candidate; **migration deferred** to 2026-08-22 review (per `implement-model-routing.txt` comment).
- **REFACTOR phase** — SOLID/Clean Code review. **No entry → session model.**
- **WIRING phase** — Python script (`check_wiring.py`); zero LLM cost, no routing entry needed.
- **COMMIT phase** — conventional-commits message; highly templated. **Initial migration: `haiku`** (experimental_until=2026-07-22).
- **Fallback chain:** rule file missing OR phase not listed → session model (no Agent tool nesting; status quo preserved).
- **Mechanism:** for phases with a routing entry, the halt-loop driver invokes `Agent` tool nested with `model: <resolved>` and a phase-focused sub-prompt. Main session continues coordinating the loop.
- **Experimental marker:** each non-default entry carries `experimental_until` + `rollback_if`. Rollback is `git rm .claude/rules/implement-model-routing.txt` (single-file revert).
- **Scope intentionally enxuto:** only COMMIT migrated in v1.1; GREEN migration follows after first-month review.

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

These are the **ONLY** valid reasons for `/implement` to exit before `IMPLEMENTATION_COMPLETE`. Any other reason (running low on context, "feels like a natural break", "should I continue?") is a contract violation.

1. **Task fails to GREEN after 3 implementation attempts** — mark task BLOCKED with reason "implementation strategy not viable"; surface to human. Do NOT skip and continue (poisons the chain).
2. **Halt-loop max iterations reached** — emit promise with honest "tasks N through M remaining" report.
3. **External dependency missing** — Postgres down for integration test, npm package not installed. Halt; surface for human to fix the environment.
4. **Plan task assumes behavior contradicted by reality** — e.g., a borrowed pattern doesn't actually exist in `.claude/knowledge-base/references/` even though plan cited it. Halt; loop back to cycle-discover or cycle-plan.
5. **Real-tree validation surfaces a HIGH/CRITICAL CVE** on a declared dep (e.g., `npm audit` post-install) — halt; loop back to cycle-plan for ADR + dep bump. After the plan is corrected, **re-invoke ralph-loop per the resume protocol below** — do NOT drive remaining tasks manually.

### Resume after recovered blocker (canonical protocol)

Stop conditions 3 + 4 + 5 are RECOVERABLE: the user fixes the environment, the cycle-plan revises the plan, the dep gets bumped. Once the blocker is resolved, the skill MUST re-invoke ralph-loop — driving remaining tasks manually in the foreground session is a contract violation (loses audit trail, restart-on-Stop hook, max-iterations safety, promise-marker termination, and the discipline against ad-hoc scope creep).

The resume protocol lives in [`.claude/skills/implement/SKILL.md § Step 4 / Resume after recovered blocker`](../skills/implement/SKILL.md). The skill is the source of truth for the 6-step procedure (verify blocker resolved → refresh SEPA brief → reset progress JSON → verify halt-loop driver → re-invoke ralph-loop with SAME flags → fresh iteration picks up). The cycle rule's job is to lock the invariant: **after a recoverable halt, re-invoke ralph-loop; do not continue manually.**

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
10. **NEVER drive implementation tasks manually outside of ralph-loop.** The halt-loop is the ONLY execution mode. Pause in the foreground session = re-invoke ralph-loop per the resume protocol above. The skill's value (audit trail, Stop hook restart, max-iterations safety, promise-marker contract) evaporates the moment manual driving begins. This anti-pattern was added 2026-05-23 after the v0-1-local-runtime session surfaced the gap: ralph-loop was cancelled by a recoverable HIGH CVE blocker, then 22 subsequent tasks were driven manually in the foreground with per-phase user-confirmation prompts — a contract violation despite shipping correct code.
11. **NEVER ask the user for permission between phases while pending tasks remain.** Once `/implement {slug}` is invoked with a verdict ≥ SHIPPABLE_WITH_CAVEATS plan, the only valid stops are the 5 Stop conditions above. "Should I continue with Phase N+1?" or "Phase N done — continue or stop?" prompts are a contract violation. The promise-marker `<promise>IMPLEMENTATION_COMPLETE</promise>` OR an honest BLOCKED report is the only legitimate way to exit. Token-budget anxiety is not a Stop condition — the halt-loop's Stop hook + restart pattern is designed to span context boundaries, and fresh iterations carry minimal state.

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

This cycle rule is **v1.5 ACTIVE** as of 2026-05-26 (v0-4a T0.1 retrospective absorption — see change log entry).

### Change log

| Version | Date | Change | Rationale |
|---|---|---|---|
| v1.0 | 2026-05-21 | Initial halt-loop design (single-skill entry, ralph-loop iteration, TDD per task, wiring triad gate). | Strategic review consolidated 3 proposed skills into 1 entry-point. |
| v1.1 | 2026-05-22 | Added SEPA (Staff Engineer Pair-Program Agent) at `/implement` startup. Runtime-generated specialist agent composed from FULL plan + ADRs + edge-cases + deps audit + plan-confidence + project rules. Consulted 3× per iteration (pre-RED, post-GREEN, pre-COMMIT) as read-only observer. Catches plan deviations + ADR cross-reference misses + SOLID/Clean Code violations + scope creep inline. Cost: ~30-60k tokens extra per cycle. | User directive 2026-05-22 post memory-contract-v0-0 retrospective: serial halt-loop lacked second-eyes safeguard; missed cross-references and required reactive fixes. Mirrors `/review`'s parallel-specialist pattern but inline during /implement instead of post-hoc. |
| v1.2 | 2026-05-23 | Added § "Resume after recovered blocker" protocol + 5th Stop condition (real-tree HIGH/CRITICAL CVE) + 2 new anti-patterns (#10 never drive manually outside ralph-loop; #11 never ask user for permission between phases while pending tasks remain). Tightened § Stop conditions preamble to "ONLY valid reasons". Skill `/implement` SKILL.md updated in same PR with Step 4 expansion. | User directive 2026-05-23 post v0-1-local-runtime session retrospective: ralph-loop was cancelled by a recoverable HIGH CVE blocker; 22 subsequent tasks driven manually in foreground with per-phase user-confirmation prompts. Correct code shipped but contract violated (lost audit trail, lost Stop-hook restart, lost max-iterations safety). User flagged: "Voce nao deve parar ate o plano estiver completo, deveriamos esta usando o ralph-loop ou o goal para terminar o plano. Isso nao esta clara em nossas skills principalmente na skill implement?" — gap closed by making the resume protocol explicit + lifting "never ask between phases" to an anti-pattern. |
| v1.3 | 2026-05-25 | SEPA agent file made Claude Code-conformant: YAML frontmatter (`name: implement-{slug}-sepa`, `description`, `tools`, `model: opus`) + system prompt body. File renamed `sepa-staff-engineer.md` → `sepa.md`. Invocation switched from `Agent(subagent_type='general-purpose', prompt=<file content>)` to `Agent(subagent_type='implement-{slug}-sepa', prompt=<iteration question>)` — Claude Code auto-discovers via frontmatter `name` field. Per-iteration logs MOVED from `.claude/agents/implement-{slug}-{date}/iteration-N-*.md` to `.claude/knowledge-base/implementations/{slug}/sepa-iterations/iteration-N-{phase}.md` — `.claude/agents/` is now reserved exclusively for agent DEFINITIONS, not invocation logs (aligns with Claude Code spec + matches /review pattern). | User flagged 2026-05-25: "os agentes autogerado nao esta no padrao do CLAUDE code". `/review` was Claude Code-conformant (YAML frontmatter present); `/implement` SEPA was not (raw markdown brief passed as Agent `prompt`). Refactor closes the inconsistency + makes SEPA invocable as a first-class subagent reusable across cycles. Pre-existing SEPA artifacts under `.claude/agents/implement-{old-slug}-{date}/` remain in place per audit-trail-rotation invariant; only forward-going /implement invocations use the new structure. |
| v1.4 | 2026-05-25 | Per-plan paired knowledge skill: `/implement` Step 2.5 now generates BOTH the SEPA agent at `.claude/agents/implement-{slug}-{date}/sepa.md` AND a paired knowledge skill at `.claude/skills/implement-{slug}-sepa-knowledge/SKILL.md`. The skill is Claude Code Skills-spec-conformant (frontmatter with name, description "pushy", `allowed-tools: Read Glob Grep WebSearch WebFetch`, model: opus). Body hydrates plan-specific context (Goal, ADR table, edge-case findings absorbed, project rules) + instructs 3 invocation modes: Mode A plan-context recap, Mode B WebSearch community knowledge refresh, Mode C cross-reference grep. SEPA invokes the skill via Skill tool when reasoning needs community knowledge — never cites from training-data recall. Mirrors cycle-review.md v1.1 spawn_reviewers.py change shipped same day. | User flagged 2026-05-25: "Crie conforme especificou Per-plan". Agents auto-generated per plan needed paired knowledge skills (also per plan, also auto-generated). Without paired skills, SEPA findings cite training-data recall — stale + un-citable. With paired skills, SEPA cites WebSearched canonical sources (allowlisted domains) + plan-specific context (frozen ADRs + EC findings). Honors Inquebrável Rule 3 (extreme honesty) + Anti-pattern #10 from cycle-discover.md v1.1. |
| v1.5 | 2026-05-26 | First-execution retrospective (v0-4a T0.1 BLOCKED in iter 1 — plan defect). Five operational fixes absorbed: (1) **SEPA discovery timing** — agent registry loaded at session start; mid-session-written SEPA file requires fallback `subagent_type='general-purpose'` + SEPA file path in prompt (path in `implementation-prompt.md` § SEPA invocation discipline). (2) **Promise marker emission discipline** — backtick or fenced-code wrapping breaks ralph-loop regex; plain-text isolated-line emission rule LOCKED in `loop-engine-convention.md` § Halt-loop driver promise-marker emission rule. (3) **Plan path validation** — `/to-plan` Step 0 now requires validating "Files to edit" + RED test paths against existing test-runner configs (`vitest.contract.config.ts` etc.). Prevents Stop Condition #4 plan defects. (4) **Node version pre-flight** — `/implement` Step 1 Check 6 verifies `node --version` satisfies `package.json#engines.node`; surfaces nvm path guidance when shell default is older Node. (5) **`vitest.contract.config.ts` include extension** — `tests/unit/**/*.test.ts` added (sibling of existing `src/**/__tests__/**`) so plans can use either convention without unreachable-path defect. | User directive 2026-05-26 post v0-4a T0.1 retrospective: "Corrija TODOS OS PROBLEMAS do implement". Surface area: 6 distinct operational gaps caught during the project's FIRST real `/implement` halt-loop execution. Plan-vs-config drift was the immediate blocker; SEPA discovery + promise marker were ergonomic gaps that required multiple iterations. Node version + shell PATH were environment gotchas. v1.5 makes all five learnable surfaces explicit in their respective skills/rules. Stop Condition #4 (plan defect → halt + loop back to cycle-plan) remains the canonical handling path; v1.5 just narrows the pre-flight gate so fewer plan defects reach `/implement` startup. |

### v0.1 → v1.0 resolved decisions

### v0.1 → v1.0 resolved decisions

The 5 open design questions from v0.1 are resolved as follows:

1. **Halt-loop engine?** → `ralph-loop:ralph-loop`. Commit hygiene (one commit per task) is honored by the halt-loop emitting promise ONLY when task's status=`committed`; halt-loop's restart pattern is fine because state lives in `.progress-{slug}.json` and is read at iteration start.
2. **Implementation task list location?** → `.claude/knowledge-base/implementations/{slug}-implementation.md` (markdown working contract) + `.progress-{slug}.json` (machine-readable state). Both, complementary roles.
3. **Validation BLOCK on test runtime?** → SOFT warn at task level (>30s integration test surfaces a warning); HARD fail only when the test fails or times out. Speed is a separate concern from correctness.
4. **Cross-platform Postgres provisioning?** → DEFERRED to cycle-discover output (`letta-pgvector-schema` blueprint). When that blueprint passes confidence, the recommendation will inform our local-dev script.
5. **`/implement-improve` skill?** → OUT OF SCOPE. Auto-fixing lint/format is what pre-commit hooks and `npm run lint:fix` already do; a dedicated skill would duplicate. The halt-loop's REFACTOR phase covers the semantic improvements.
