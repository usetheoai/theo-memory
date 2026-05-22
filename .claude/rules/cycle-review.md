---
cycle: review
phases:
  - review       (single entry-point; orchestrates internally via dynamically-spawned specialized agents)
trigger: when code on a feature branch passed /implement validation and is ready to merge
output: severity-classified review report at .claude/knowledge-base/reviews/{slug}-review-{date}.md + audit trail of spawned agents at .claude/agents/review-{slug}-{date}/
status: v1.0 ACTIVE — skill `/review` built and validated 2026-05-21
---

# Cycle: Review

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for the post-implementation review cycle. **Status: v1.0 ACTIVE.** The single skill `/review` (in `.claude/skills/review/`) drives the cycle. Before invoking review proper, the skill **generates specialized review agents** for the plan's domain (architecture, tests, wiring, cross-validation, and 1-3 domain-specific) and **spawns them in parallel** via the Agent tool. The original v0.1 PROPOSED design (4 separate skills) was consolidated into 1 entry-point + dynamic agent generation at strategic review 2026-05-21.

The "most rigorous gate of the ecosystem" framing is intentional: this cycle costs 150-250k tokens per invocation. Trade-off accepted in exchange for catching defects pre-merge that all upstream cycles missed.

## Purpose

Convert a feature branch (post cycle-implement) into a structured review report with severity-classified findings, before merge. Distinct from cycle-implement's `/implement-validate`:

- `/implement-validate` is **deterministic** — passes/fails based on test/lint/typecheck/coverage gates.
- Cycle review is **semantic** — does the code actually solve the problem the plan declared? Does it respect cross-cutting concerns (security, perf, maintainability) that gates can't measure?

## Trigger conditions

Invoke this cycle when:

- A feature branch passed `/implement-validate` (cycle-implement gate)
- The branch is ready to merge (PR drafted OR ready to be drafted)
- The implementation plan at `plans/{slug}-plan.md` is still the canonical contract
- Tests pass and CI is green

Do NOT invoke when:

- The branch has uncommitted changes — commit first
- `/implement-validate` did not run or did not PASS — loop back to cycle-implement
- The plan has been revised post-implementation — the plan is the review's ground truth; revising it after the fact undermines the review

## Chain (v1.0 — inquebrável)

```
/review {plan-slug}
  ↓ Step 1: pre-conditions (feature branch, /implement PASS, plan exists, tests green)
  ↓ Step 2: DOMAIN DETECTION (scripts/detect_domain.py)
  ↓   read plan + git diff + patterns skills frontmatter
  ↓   detect primary + secondary domains with confidence scores
  ↓ Step 3: SPAWN SPECIALIZED AGENTS (parallel)
  ↓   - scripts/spawn_reviewers.py writes 5-7 agent definition files at
  ↓     .claude/agents/review-{slug}-{date}/ — PERSIST as audit trail
  ↓   - 4 baseline (always): architecture, tests, wiring, cross-validation
  ↓   - 1-3 domain-specific (from detect_domain.py output)
  ↓   - skill invokes each agent in parallel via Agent tool
  ↓   - each agent emits structured findings (YAML format)
  ↓ Step 4: CONSOLIDATE findings (scripts/consolidate_findings.py)
  ↓   deduplicate cross-agent findings; classify severity
  ↓ Step 5: RE-VALIDATE quality gates (reuse implement/run_validation.py)
  ↓   with tighter thresholds (coverage 100% on critical paths; 0 lint warnings)
  ↓ Step 6: EDGE-CASE COVERAGE (scripts/edge_case_coverage.py)
  ↓   verify integration tests cover every Edge Case declared in plan
  ↓ Step 7: HALT-IF-BLOCKER decision
  ↓   any BLOCKER → cannot merge; loop back to /implement
  ↓   any CRITICAL without ADR-dismissal → cannot merge
  ↓ Step 8: write consolidated report at
  ↓   .claude/knowledge-base/reviews/{slug}-review-{date}.md
HANDOFF — branch ready to merge (after addressing BLOCKER + CRITICAL findings) OR loop back
```

## Phase contracts (v1.0)

Single phase, but logically broken into 8 stages by `/review`:

| Stage | Input | Output | Success criterion |
|---|---|---|---|
| Pre-conditions | feature branch state | refuse-or-proceed decision | branch clean, /implement validation PASS, plan un-revised since /implement |
| Domain detection | plan + git diff + patterns skills | JSON with primary + secondary domains | confidence ≥ 0.5 for primary; 0-3 secondary |
| Agent spawn | domain JSON + agent templates | 5-7 agent .md files persisted in `.claude/agents/review-{slug}-{date}/` | All file writes successful; agent frontmatter valid |
| Parallel agent execution | agent .md files | per-agent findings in YAML | All agents return (or honest timeout); each emits ≥1 finding per file in scope |
| Consolidation | per-agent findings | classified report (BLOCKER/CRITICAL/MAJOR/MINOR/INFO) | dedup applied; all findings cross-referenced to plan |
| Quality gates re-validation | feature branch | gate status JSON | tighter thresholds vs /implement (100% critical paths, 0 lint warnings) |
| Edge-case coverage | plan + tests dir | covered/partial/missing list | every Edge Case in plan has at least 1 covered or explicit ADR-deferral |
| Halt decision | consolidated findings | READY_TO_MERGE / NEEDS_FIXES / NEEDS_DEEPER | BLOCKER count == 0 for READY |

## Model routing (teacher/student split)

Source of truth for which model each review agent runs on: [`.claude/rules/review-model-routing.txt`](./review-model-routing.txt). Consumed by `scripts/spawn_reviewers.py` via `--routing-rule` (defaults to the canonical path).

- **Baseline arquétipos** (architecture, tests, wiring, domain) — **student** (default `haiku`). Checklist-shape execution; minimal cross-cutting reasoning.
- **Cross-validation arquétipo** — **teacher** (`opus`). Cross-cutting plan-vs-code semantic audit; raciocínio profundo justifica o custo.
- **Fallback chain:** `--model-override ROLE=MODEL` (operator-time) > rule file entry > default `opus`. Missing OR malformed rule file → all agents fall back to `opus` (status quo preserved, no silent breakage).
- **EC-1 invariant** (locked v1.1): role `domain-X` collapses to base key `domain` for rule lookup; primary + secondary domain agents share the same student model unless overridden.
- **Experimental marker:** each non-default entry carries `experimental_until: YYYY-MM-DD` + `rollback_if: <criterion>`. No A/B baseline yet — marker is the stand-in honesty signal. Rollback is `git rm .claude/rules/review-model-routing.txt` (single-file revert).
- **Escalation override** for critical reviews: invoke `spawn_reviewers.py --model-override architecture=opus --model-override domain=opus` to lift the baseline agents back to teacher when the diff is high-blast-radius.

## Hard gates (cannot advance — BLOCK the cycle)

1. **`/review-execute` finds BLOCKER severity** — merge MUST NOT proceed until BLOCKER is resolved. Loop back to cycle-implement to fix; OR mark BLOCKER as `dismissed` with explicit ADR in `/review-improve`.
2. **`/review-execute` finds CRITICAL security issue** — merge MUST NOT proceed; treat as BLOCKER even if originally classified as CRITICAL. Loop back.
3. **`/review-confidence` verdict INVALID** — review was structurally incomplete (e.g., > 50% of changed files not reviewed). Cycle MUST re-run `/review-execute` with broader scope.
4. **Tests are failing on the branch at review time** — the contract assumes tests pass per `/implement-validate`. If tests broke between `/implement-validate` and `/review-execute`, halt; loop back to cycle-implement.

## Soft gates (advance, but require human review)

1. **`/review-confidence` verdict NEEDS_DEEPER** — coverage or depth below threshold. `/review-improve` runs; if no convergence, human reviews remaining gaps.
2. **CRITICAL non-security finding** — performance regression, breaking API change. Surface to human: accept WITH_CAVEATS in PR description, or loop back to cycle-implement to fix.
3. **MAJOR finding without clear fix** — surface to human as "discuss before merge"; not auto-blocking.
4. **Large diff (> 1000 lines changed)** — soft warning to human reviewer; consider splitting the PR into smaller commits before merge.

## Stop conditions (cycle aborts honestly — NOT a failure)

1. **`/review-improve` no-improvement in 2 iterations** — surface remaining gaps to human.
2. **Review depth would require domain knowledge outside the agent's training** — e.g., cryptography, hardware-specific code. Mark BLOCKED with reason "requires human domain expert"; do NOT pretend to review.
3. **PR scope ambiguous** — the change touches files unrelated to the plan's declared scope. Halt; surface to human: is this intentional scope expansion, or accidental?

## Anti-patterns (NEVER do these — violates the contract)

1. **NEVER approve a PR with unresolved BLOCKER findings** — even if the human says "ship it anyway", refuse unless they dismiss the BLOCKER explicitly with rationale.
2. **NEVER mark a finding as `dismissed` without an ADR-style justification** — silent dismissal turns reviews into rubber-stamps.
3. **NEVER skip review for files modified by `/implement-execute`** — every changed file gets at least cursory review. If a file is too trivial, the finding is "INFO: no issues found".
4. **NEVER review without the plan as ground truth** — the implementation plan declares the contract; the review checks whether the code honors that contract. Reviewing without the plan turns the review into vibes.
5. **NEVER fabricate findings** — if a file has no issues, say so. Padding the review with fake MAJOR findings to look thorough is dishonest.
6. **NEVER auto-merge after `/review-improve`** — final merge decision is human, even if `/review-confidence` returns SHIPPABLE. The cycle delivers a recommendation, not a merge.
7. **NEVER review code that was MODIFIED between `/implement-validate` and `/review-execute`** — review must run on the same code state that validate passed. If commits happened, re-run `/implement-validate`.

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Review plan in `reviews/{slug}-review-plan-{date}.md` | Delete file |
| Findings in `reviews/{slug}-review-findings-{date}.md` | Delete file |
| Confidence reports | Delete file |
| Review patches (NOT code patches — only review report patches) | `git diff` against working tree; revert via standard git |

The cycle-review NEVER modifies code on the feature branch. If a finding requires a code change, the human (or cycle-implement re-run) does it. Review-improve only modifies the review report (findings list, false-positive marks, ADR dismissals).

## Cross-references

- Phase SKILL.md: [`review/`](../skills/review/SKILL.md)
- Agent templates (parameterized): `.claude/skills/review/templates/agent-*.md`
- Domain detection script: `.claude/skills/review/scripts/detect_domain.py`
- Agent spawning script: `.claude/skills/review/scripts/spawn_reviewers.py`
- Edge-case coverage analysis: `.claude/skills/review/scripts/edge_case_coverage.py`
- Findings consolidator: `.claude/skills/review/scripts/consolidate_findings.py`
- Reused from cycle-implement: `.claude/skills/implement/scripts/run_validation.py` (quality gates), `check_wiring.py` (wiring re-validation)
- Built-in tools used as agent invocation target: `Agent` tool with `subagent_type=general-purpose` + agent prompt loaded from the generated `.md` file
- Audit trail: `.claude/agents/review-{slug}-{date}/` (PERSISTED in git for reproducibility — see v0.1 → v1.0 resolved decisions)
- Output destination: PR comments + `.claude/knowledge-base/reviews/{slug}-review-{date}.md`
- Project rules consumed: `architecture.md`, `testing.md`, `public-copy.md`, `discover-blueprint-golden-rule.md` (if review touches docs/blueprints), `cycle-discover.md` (when reviewing generated `*-patterns` skills)
- Upstream cycle: `cycle-implement.md` — must have PASSed validation before this cycle starts

## Versioning

This cycle rule is **v1.0 ACTIVE** as of 2026-05-21. Promoted from v0.1 PROPOSED after the strategic review consolidated 4 proposed skills into 1 entry-point + dynamic agent generation, and the `/review` skill was built + scripts validated.

### v0.1 → v1.0 resolved decisions

The 5 open design questions from v0.1 are resolved as follows:

1. **Simple mode vs deep mode?** → ALWAYS DEEP. `/review` is positioned as "most rigorous gate of the ecosystem" — trivial PRs use Anthropic's built-in `/review` (10× cheaper). When the team invokes `/review` from this cycle, the cost (150-250k tokens) is intentional.
2. **Severity rubric SoT?** → IN this cycle rule (see § Hard gates and Soft gates). Single source; not duplicated to a separate file.
3. **Integration with GitHub PR API?** → OUT OF SCOPE for v1.0. `/review` writes report markdown; user manually copies to PR comment OR uses `gh pr comment --body-file`. Future: a `/review-publish` skill could automate this.
4. **Cross-cycle review (re-validate plan vs code)?** → YES, included. The `cross-validation-reviewer` baseline agent does line-by-line plan vs commit comparison semantically (decision from strategic review: Agent task, not Python script).
5. **Review of generated patterns skills?** → DEFERRED to next cycle-review iteration. Currently `skill-validator` covers structural checks; semantic review of a generated skill's quality is left to humans for now. Re-evaluate when 5+ patterns skills exist in production.
