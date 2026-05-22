---
cycle: plan
phases:
  - to-plan
  - edge-case-plan
  - plan-confidence
  - plan-improve
trigger: when user wants an implementation plan derived from the current conversation + repo state
output: implementation plan at .claude/knowledge-base/plans/{slug}-plan.md with verdict ≥ SHIPPABLE_WITH_CAVEATS
---

# Cycle: Plan

Source of truth for the implementation-planning cycle. Every phase has its own SKILL.md, but the chain order, gates, anti-patterns, and rollback live here. SKILL.md files point HERE.

## Purpose

Convert the current conversation context + repo state + project rules into a **structurally validated implementation plan** ready for the cycle-implement.

The plan that comes out of this cycle is:

- Mapped to a Coverage Matrix (every gap → at least one task)
- Backed by ADRs with alternatives + rationale + consequences
- TDD-disciplined (every bug-fix task has RED-GREEN-REFACTOR)
- Scored deterministically (`/plan-confidence` M2 rubric)
- Auto-improved via halt-loop if structurally weak

## Trigger conditions

Invoke this cycle when:

- User explicitly asks `/to-plan {topic}`
- The conversation has enough context to draft a plan WITHOUT additional interviews
- The current state of `.claude/rules/` is complete (architecture, testing, conventions)
- Any relevant `*-patterns` skills from cycle-discover are registered and discoverable via Step 0

Do NOT invoke when:

- The current task is exploratory (no concrete change in mind) — discuss first
- `.claude/rules/` is missing or stale — fix rules first
- The change is trivial (single-line, no architectural impact) — write the change directly

## Chain (inquebrável)

```
/to-plan {topic-slug}
  ↓ Step 0: reads .claude/rules/ AND .claude/skills/*-patterns/ frontmatter
  ↓ produces .claude/knowledge-base/plans/{slug}-plan.md v1.0
/edge-case-plan {slug}
  ↓ classifies edge cases: MUST FIX / SHOULD TEST / DOCUMENT / IGNORE
  ↓ plan bumped v1.0 → v1.1 with MUST FIX absorbed
/plan-confidence {slug}
  ↓ scores plan structurally (M2: completude + risco_estrutural)
  ↓ hard caps audited (coverage_lt_100, no_adrs, no_alternatives, tdd_in_bugfix)
  ↓ if verdict < SHIPPABLE_WITH_CAVEATS:
/plan-improve {slug}
  ↓ halt-loop (Phase A deterministic: weak imperatives, loopholes, TDD template injection;
  ↓              Phase B LLM: ADR alternatives writing)
/plan-confidence {slug}    [re-score]
  ↓ if verdict ≥ SHIPPABLE_WITH_CAVEATS:
DONE — plan is ready for cycle-implement
```

The cycle is **inquebrável as a contract**, not as a runtime orchestration. Today each phase is **human-invoked** sequentially — there is no orchestrator that auto-advances `/to-plan` → `/edge-case-plan` → `/plan-confidence` → `/plan-improve`. Treat the chain as the recommended order; auto-orchestration (via Skill tool composition or a wrapper skill) is a future enhancement tracked in roadmap.

A `/to-plan` invocation is NOT considered complete until either:

1. Final `/plan-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS, OR
2. An honest exhausted / blocked report is delivered to the user with specific issues that need human intervention

## Phase contracts

| Phase | Input | Output | Success criterion |
|---|---|---|---|
| `to-plan` | Conversation context + `.claude/rules/*.md` + `.claude/skills/*-patterns/` frontmatter scan + repo state | `plans/{slug}-plan.md` v1.0 with all mandatory sections, ADRs, Coverage Matrix, TDD per task, Global DoD | Plan honors project rules + uses patterns from registered skills when relevant |
| `edge-case-plan` | `plans/{slug}-plan.md` | Edge case report (MUST FIX / SHOULD TEST / DOCUMENT) | Veredict PLAN OK or PRECISA DE AJUSTE |
| `plan-confidence` | Plan + rubric (rubric-v1.md) + thresholds (`.claude/rules/plan-confidence-thresholds.txt`) | JSON score + verdict | Hard caps audited; final score reflects active dimensions |
| `plan-improve` | Plan + previous verdict (`< SHIPPABLE_WITH_CAVEATS`) | Patched plan + diff + iteration count | Verdict ≥ target OR honest exhaustion with remaining issues listed |

## Hard gates (cannot advance — BLOCK the cycle)

1. **`/plan-confidence` Coverage Matrix < 100%** — gaps not mapped to tasks. Score capped at 49 (INVALID). Cycle MUST loop back to `/to-plan` OR add tasks/ADRs manually.
2. **`/plan-confidence` ADR without alternatives** — capped at 70 (SHIPPABLE_WITH_CAVEATS at most). Cycle continues but with WITH_CAVEATS verdict; `/plan-improve` Phase B attempts to write alternatives.
3. **`/plan-confidence` bug-fix task without TDD** — capped at 70. `/plan-improve` Phase A injects TDD template.
4. **Fabricated citation in plan** (`referencia/` or `src/` path that doesn't exist) — **planned hard cap (M3 future)**. Not enforced by the M2 deterministic runner yet (see `plan-confidence/SKILL.md § What This Skill Does NOT Do`); human reviewers are expected to catch fabricated citations until M3 (SAFE adapted to `ripgrep + tree-sitter`) lands. The sibling `discover-confidence` already enforces this for blueprints today.
5. **`/plan-improve` max iterations reached without target verdict** — surface remaining issues honestly; do NOT pretend the plan passes.

## Soft gates (advance, but require human review)

1. **`/plan-confidence` verdict NON_SHIPPABLE** (score 50-69) — no hard cap, but quality below threshold. `/plan-improve` runs; if no convergence, human reviews.
2. **`/plan-confidence` soft cap `soft_floor_smell_density_high`** — too many weak imperatives / loopholes / vague pronouns. Phase A of `/plan-improve` mitigates; verdict capped at 89.
3. **`/plan-confidence` soft cap `soft_floor_low_architecture_compliance`** — plan does not reference project rules. Verdict capped at 89.
4. **`/edge-case-plan` returns DISCOVERY PLAN PRECISA DE AJUSTE** — even if `/plan-confidence` would pass, the edge case report exposes risks. Human reviews MUST FIX items before advancing.

## Stop conditions (cycle aborts honestly — NOT a failure)

1. **`/plan-improve` no-improvement in 2 consecutive iterations** — declare stuck; emit promise with remaining issues. Better to surface to human than loop indefinitely.
2. **Hard cap that requires human intervention** — e.g., unmapped Coverage Matrix gap that requires adding a NEW task (not just rewording). Phase A/B cannot create tasks safely.
3. **Plan touches architectural boundaries declared in `architecture.md`** — additional strategic review required even if `/plan-confidence` would PASS.

## Anti-patterns (NEVER do these — violates the contract)

1. **NEVER skip `/edge-case-plan`** — edge cases found pre-implementation are 100x cheaper than post-implementation.
2. **NEVER advance to cycle-implement with verdict INVALID or NON_SHIPPABLE** — implementation built on a broken plan produces unwirable code.
3. **NEVER write tasks without TDD** for bug-fix tasks (Inquebrável Rule 5). Bug fixes ship a regression test FIRST.
4. **NEVER fabricate `referencia/` or `src/` paths** in the plan — confidence checker catches it; honest "(NEW)" for files that don't exist yet is required.
5. **NEVER override a Pattern from a `*-patterns` skill silently** — must include an ADR naming the patterns skill + the specific pattern + the reason for divergence.
6. **NEVER write a plan without reading `.claude/rules/`** — Step 0 is mandatory; fabricated rules are worse than missing rules.
7. **NEVER set time budgets vaguely** ("TBD") — every plan declares time-shape per phase OR an ADR deferring it.
8. **NEVER claim Coverage Matrix 100% without backing every gap with a task or ADR-deferral** — `/plan-confidence` catches it.

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Plan in `plans/{slug}-plan.md` | Delete file; no further state to revert |
| Confidence reports in `reviews/{slug}-confidence-*.md` | Delete file(s) |
| `/plan-improve` patches | `git diff` against working tree; revert via standard git workflow |

## Cross-references

- Phase SKILL.md (in chain order): `to-plan/`, `edge-case-plan/`, `plan-confidence/`, `plan-improve/`
- Templates: implicit in `to-plan/SKILL.md § Plan Template`
- Rubrics: `plan-confidence/templates/rubric-v1.md`
- Project rules consumed: `architecture.md`, `testing.md`, `public-copy.md`, `plan-confidence-golden-rule.md`, `plan-confidence-thresholds.txt`
- Upstream cycle: `cycle-discover.md` — produces `*-patterns` skills that this cycle's `/to-plan` Step 0 consumes
- Downstream cycle: `cycle-implement.md` — consumes the validated plan as input
- Sibling cycle: `cycle-review.md` — reviews code produced by cycle-implement, may cite this cycle's plan as the ground truth

## Versioning

This cycle rule is **v1.0** as of 2026-05-21. Same evolution policy as cycle-discover.md.
