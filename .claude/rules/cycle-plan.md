---
cycle: plan
phases:
  - to-plan
  - edge-case-plan
  - deps-audit
  - plan-confidence
  - plan-improve
trigger: when user wants an implementation plan derived from the current conversation + repo state
output: implementation plan at .claude/knowledge-base/plans/{slug}-plan.md with verdict ≥ SHIPPABLE_WITH_CAVEATS
---

# Cycle: Plan

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

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
  ↓ Plan template now MUST include a `## Dependencies` section (Existing / New / Removed)
  ↓ produces .claude/knowledge-base/plans/{slug}-plan.md v1.0
/edge-case-plan {slug}
  ↓ classifies edge cases: MUST FIX / SHOULD TEST / DOCUMENT / IGNORE
  ↓ plan bumped v1.0 → v1.1 with MUST FIX absorbed
/deps-audit {slug}       ← NEW v1.1
  ↓ auto-detects ecosystems (npm + Python + Rust + Go)
  ↓ runs osv-scanner + npm audit + npm outdated + pip-audit + cargo audit + govulncheck
  ↓ cross-references plan's `## Dependencies` section against audit + Rule 9 evaluation
  ↓ if any CRITICAL/HIGH CVE on declared dep without sunset-allowlist:
  ↓     verdict = FAIL_INSECURE → plan-confidence will cap at 49 (INVALID)
  ↓ if plan missing `## Dependencies` section OR dep without version pin OR NEW without Rule 9:
  ↓     verdict = INVALID_PLAN_DEPS → plan-confidence will cap at 49 (INVALID)
  ↓ writes .claude/knowledge-base/audits/{slug}-deps-audit-{date}.md
/plan-confidence {slug}
  ↓ scores plan structurally (M2: completude + risco_estrutural)
  ↓ hard caps audited (coverage_lt_100, no_adrs, no_alternatives, tdd_in_bugfix)
  ↓ consumes /deps-audit verdict (follow-up wiring — see § Downstream changes below)
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
| `to-plan` | Conversation context + `.claude/rules/*.md` + `.claude/skills/*-patterns/` frontmatter scan + repo state | `plans/{slug}-plan.md` v1.0 with all mandatory sections (incl. `## Dependencies`), ADRs, Coverage Matrix, TDD per task, Global DoD | Plan honors project rules + uses patterns from registered skills when relevant + declares Existing/New/Removed deps with versions and Rule 9 evaluation |
| `edge-case-plan` | `plans/{slug}-plan.md` | Edge case report (MUST FIX / SHOULD TEST / DOCUMENT) | Veredict PLAN OK or PRECISA DE AJUSTE |
| `deps-audit` | Plan v1.x + ecosystem manifests + allowlist (`.claude/rules/deps-audit-allowlist.txt`) | JSON audit report + `.claude/knowledge-base/audits/{slug}-deps-audit-{date}.md` + verdict (PASS / PASS_WITH_CAVEATS / FAIL_MEDIUM / FAIL_INSECURE / INVALID_PLAN_DEPS) | All declared deps audited; every NEW dep has Rule 9 rationale; no unallowlisted CRITICAL/HIGH CVE |
| `plan-confidence` | Plan + rubric (rubric-v1.md) + thresholds (`.claude/rules/plan-confidence-thresholds.txt`) + `deps-audit` verdict | JSON score + verdict | Hard caps audited; final score reflects active dimensions including deps |
| `plan-improve` | Plan + previous verdict (`< SHIPPABLE_WITH_CAVEATS`) | Patched plan + diff + iteration count | Verdict ≥ target OR honest exhaustion with remaining issues listed |

## Hard gates (cannot advance — BLOCK the cycle)

1. **`/plan-confidence` Coverage Matrix < 100%** — gaps not mapped to tasks. Score capped at 49 (INVALID). Cycle MUST loop back to `/to-plan` OR add tasks/ADRs manually.
2. **`/plan-confidence` ADR without alternatives** — capped at 70 (SHIPPABLE_WITH_CAVEATS at most). Cycle continues but with WITH_CAVEATS verdict; `/plan-improve` Phase B attempts to write alternatives.
3. **`/plan-confidence` bug-fix task without TDD** — capped at 70. `/plan-improve` Phase A injects TDD template.
4. **Fabricated citation in plan** (`referencia/` or `src/` path that doesn't exist) — **planned hard cap (M3 future)**. Not enforced by the M2 deterministic runner yet (see `plan-confidence/SKILL.md § What This Skill Does NOT Do`); human reviewers are expected to catch fabricated citations until M3 (SAFE adapted to `ripgrep + tree-sitter`) lands. The sibling `discover-confidence` already enforces this for blueprints today.
5. **`/plan-improve` max iterations reached without target verdict** — surface remaining issues honestly; do NOT pretend the plan passes.
6. **`/deps-audit` verdict FAIL_INSECURE (CRITICAL/HIGH CVE in declared dep)** — v1.1; caps plan-confidence at 49 (INVALID). Stable identifiers `plan_dep_critical_cve` / `plan_dep_high_cve`. Cycle MUST loop back: either bump the dep in the plan, allowlist with sunset ≤ 30/60 days (CRITICAL/HIGH respectively), OR replace the dep entirely via Rule 9 re-evaluation.
7. **`/deps-audit` verdict INVALID_PLAN_DEPS** — v1.1; plan missing `## Dependencies` section OR dep without version pin OR NEW dep without Rule 9 evaluation. Caps at 49 (INVALID). Cycle MUST loop back to `/to-plan` to populate the missing structure.

## Soft gates (advance, but require human review)

1. **`/plan-confidence` verdict NON_SHIPPABLE** (score 50-69) — no hard cap, but quality below threshold. `/plan-improve` runs; if no convergence, human reviews.
2. **`/plan-confidence` soft cap `soft_floor_smell_density_high`** — too many weak imperatives / loopholes / vague pronouns. Phase A of `/plan-improve` mitigates; verdict capped at 89.
3. **`/plan-confidence` soft cap `soft_floor_low_architecture_compliance`** — plan does not reference project rules. Verdict capped at 89.
4. **`/edge-case-plan` returns DISCOVERY PLAN PRECISA DE AJUSTE** — even if `/plan-confidence` would pass, the edge case report exposes risks. Human reviews MUST FIX items before advancing.
5. **`/deps-audit` verdict FAIL_MEDIUM (MEDIUM CVE in declared dep)** — v1.1; caps plan-confidence at 70. Cycle continues with WITH_CAVEATS verdict; recommended to bump dep or allowlist with sunset ≤ 90 days.
6. **`/deps-audit` verdict PASS_WITH_CAVEATS (LOW CVE OR outdated MAJOR not pinned)** — v1.1; caps at 89. Surface to human review.
7. **`/deps-audit` cap `auditor_unavailable_{name}`** — v1.1; an ecosystem present in plan has its auditor missing from runtime (e.g., `pip-audit` not installed). Caps at 70 because the CVE coverage gap is real.

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
9. **NEVER skip `/deps-audit`** (v1.1) — `/plan-confidence` consumes its verdict. A plan that "passes" plan-confidence with `/deps-audit` skipped is silently shipping uninspected supply chain.
10. **NEVER declare a dep in `## Dependencies` without an exact version pin** — `^X.Y.Z`, `~X.Y`, or `=X.Y.Z` only. Loose ranges like `*` or `latest` are forbidden by the deps-audit golden rule.
11. **NEVER list a NEW dep without naming the rejected alternatives** — Rule 9 evaluation is the only way to know we're using existing libs RESPONSIBLY. "Picked X because it's popular" is NOT Rule 9.
12. **NEVER allowlist a CRITICAL CVE with sunset > 30 days** — the urgency signal is in the severity; long allowlists for high severity defeat the gate.

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Plan in `plans/{slug}-plan.md` | Delete file; no further state to revert |
| Confidence reports in `reviews/{slug}-confidence-*.md` | Delete file(s) |
| `/plan-improve` patches | `git diff` against working tree; revert via standard git workflow |
| Deps audit report in `audits/{slug}-deps-audit-{date}.md` | Delete file; no further state to revert (skill is read-only on manifests) |
| Allowlist entry in `deps-audit-allowlist.txt` | Standard git revert of the line addition |

## Cross-references

- Phase SKILL.md (in chain order): `to-plan/`, `edge-case-plan/`, `deps-audit/`, `plan-confidence/`, `plan-improve/`
- Templates: implicit in `to-plan/SKILL.md § Plan Template` — v1.1 MUST include the `## Dependencies` section template (follow-up — see § Downstream changes below)
- Rubrics: `plan-confidence/templates/rubric-v1.md`
- Project rules consumed: `architecture.md`, `testing.md`, `public-copy.md`, `plan-confidence-golden-rule.md`, `plan-confidence-thresholds.txt`, `deps-audit-golden-rule.md` (v1.1), `deps-audit-allowlist.txt` (v1.1)
- Upstream cycle: `cycle-discover.md` — produces `*-patterns` skills that this cycle's `/to-plan` Step 0 consumes
- Downstream cycle: `cycle-implement.md` — consumes the validated plan as input
- Sibling cycle: `cycle-review.md` — reviews code produced by cycle-implement, may cite this cycle's plan as the ground truth

## Versioning

This cycle rule is **v1.1** as of 2026-05-22. Same evolution policy as `cycle-discover.md`.

### Change log

| Version | Date | Change | Rationale |
|---|---|---|---|
| v1.0 | 2026-05-21 | Initial cycle rule with 4 phases: `to-plan` → `edge-case-plan` → `plan-confidence` → `plan-improve`. | Baseline contract. |
| v1.1 | 2026-05-22 | Added `/deps-audit` phase between `/edge-case-plan` and `/plan-confidence`. Plan `## Dependencies` section is now mandatory. 2 hard gates added (`plan_dep_critical_cve` / `plan_dep_high_cve` and `INVALID_PLAN_DEPS` family). 3 soft gates added (FAIL_MEDIUM, PASS_WITH_CAVEATS, `auditor_unavailable_{name}`). 4 anti-patterns added. New rollback rows. | User directive 2026-05-22: skill `/deps-audit` must block plan execution; plan must declare deps explicitly with versions. Decisions captured via AskUserQuestion: multi-ecosystem auto-detection; tools = npm audit + npm outdated + pip-audit + osv-scanner + Renovate/Dependabot config; behavior = audit + propose diffs (no auto-apply); gate = blocks plan execution. |

### Downstream changes required (NOT yet shipped — follow-up work)

This cycle rule extension is a **contract extension**, not a softening. Per the locked policy in `plan-confidence-golden-rule.md` § When this rule may change, extensions follow the same process as softenings but with lower burden. The following files MUST be updated in a follow-up PR/cycle to align with v1.1:

1. `.claude/skills/to-plan/SKILL.md` + `templates/plan-template.md` — add mandatory `## Dependencies` section (Existing / New / Removed tables) per the shape declared in `deps-audit/SKILL.md § Step 4`.
2. `.claude/skills/plan-confidence/scripts/run_structural.py` — extend to invoke `/deps-audit {slug}` and consume its verdict; integrate caps into the rubric's `hard_caps_triggered` list.
3. `.claude/rules/plan-confidence-golden-rule.md` — add stable identifiers from deps-audit to the locked rule (since they cap plan-confidence). This is a LOCKED file, so the addition requires the explicit ADR-style note already authored in `deps-audit-golden-rule.md § Log of changes`.
4. `.claude/rules/plan-confidence-thresholds.txt` — bump sunset; cite v1.1 entry above as the ADR.
5. `.claude/rules/cycle-implement.md` — note that any plan reaching `/implement` already passed `/deps-audit` upstream; cycle-implement does NOT re-run the audit by default but MAY invoke `/deps-audit` standalone when an upgrade is part of the implementation tasks.
6. `.claude/rules/cycle-review.md` — `/review`'s cross-validation agent SHOULD verify that the dep versions in the manifest match those declared in the plan's `## Dependencies` section (no silent drift).
7. `.github/dependabot.yml` OR `renovate.json` — passive infra config to open PRs automatically when CVEs are disclosed; complementary to this skill (not a replacement).
8. `.claude/rules/token-budget.md` — already updated in v1.1 to include `/deps-audit` cost band.
9. `.claude/skills/deps-audit/scripts/run_audit.py` — OPTIONAL Python orchestrator that wraps the multi-ecosystem detection + auditor invocation + plan parsing. Useful only after the skill is invoked frequently enough to justify deterministic automation (YAGNI today).

This file is the contract; the 9 downstream items are the implementation. The contract is normative even if any single downstream file lags.
