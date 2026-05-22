# Discover-Plan Golden Rule (INQUEBRÁVEL)

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

**Source of truth for the `/discover-plan-confidence` skill's most important contract.**

Sibling of [`plan-confidence-golden-rule.md`](./plan-confidence-golden-rule.md) and [`discover-blueprint-golden-rule.md`](./discover-blueprint-golden-rule.md) — same shape, applied to **discovery plans** (output of `/discover-plan`).

## The Rule

**A discovery plan is INVALID and CANNOT produce a SHIPPABLE verdict when any of these fire:**

1. **Empty coverage corner** — the plan's `## Research Questions` table does NOT map at least one question to a given coverage corner (`tests`, `deps`, `tools`, `techniques`) AND no `<!-- DEFER-CORNER: {corner} | {reason} -->` marker exists for that corner.
2. **Fabricated `referencia/` citation** — at least one `referencia/{project}/{path}` referenced in the plan does NOT exist when checked via `Path.exists()`.

**Additional inquebráveis that cap verdict at 70 (SHIPPABLE_WITH_CAVEATS at most):**

3. **Mandatory section missing** — any of: Header (`# Discovery Plan:`), Context, Objective, In-Scope/Out-of-Scope, ADRs, Research Questions, Coverage Matrix, Halt-loop Checkpoints, Acceptance Criteria, Global Definition of Done.
4. **Insufficient ADRs** — fewer than 2 ADRs in `## ADRs` section. The discovery plan template requires D1 (time budget + stop conditions) and D2 (investigation depth) at minimum.
5. **Question budget violated** — total Research Questions outside [5, 10] OR more than 3 questions mapped to a single corner OR a corner with 0 questions and no DEFER-CORNER marker.
6. **Method missing on a question** — a row in the Research Questions table with empty `Fase A` (and not the literal token `SKIP`) OR empty `Fase B`.

This is NOT a guideline. It is a constraint enforced by the `/discover-plan-confidence` skill itself. The skill SHALL fail-closed when an unbreakable rule is violated.

## What it requires

1. **Score capping.** Final score is capped at 49 (INVALID band) when rules 1-2 fire; capped at 70 (SHIPPABLE_WITH_CAVEATS band) when rules 3-6 fire. The cap is independent of the weighted_avg — even a structurally perfect plan with a fabricated citation caps at 49.
2. **Mandatory verdict label.** Returned verdict is `INVALID` for rules 1-2; `SHIPPABLE_WITH_CAVEATS` (at most) for rules 3-6.
3. **Vocabulary lock.** The word "shippable" (unqualified) SHALL NOT appear in the score report when any inquebrável fires.
4. **Hard cap audit.** JSON output MUST list every triggered cap in `hard_caps_triggered` using stable identifiers:
   - `empty_corner_tests`, `empty_corner_deps`, `empty_corner_tools`, `empty_corner_techniques`
   - `fabricated_citation`
   - `mandatory_section_missing`
   - `insufficient_adrs`
   - `question_budget_violated`
   - `method_missing`
5. **Visual rendering.** When capped, the INVALID band appears in red (terminal color when available; plain `[INVALID]` when no color).
6. **No bypass flag.** A `--force` / `--skip-checks` / `--accept-caveats` flag does NOT exist and SHALL NOT be added to `run_discover_plan_score.py`.

## Why this rule exists

Discovery plans drive `/discover-execute` which produces blueprints which produce patterns skills which feed every future `/to-plan` invocation. A malformed discovery plan poisons the entire `cycle-discover → cycle-plan` chain — silently, because each downstream stage trusts its input.

The cheap fail-closed gate at the plan stage prevents 100× more expensive corrections at the blueprint or patterns-skill stage.

The deferral mechanism (DEFER-CORNER marker per D5 of the source plan) exists to distinguish HONEST deferrals (with documented rationale) from accidental omissions. A coverage corner that's genuinely out of scope can be marked explicitly and counted as populated; an undocumented zero is treated as a structural defect.

## Rules that cannot be bent

| Rule | Enforcement |
|---|---|
| All 4 coverage corners populated OR explicitly DEFER-CORNER marker | M2 — `check_research_coverage.py` |
| All `referencia/{...}` citations resolve via `Path.exists()` | M2 — `check_reference_citations.py` (sibling of `discover-confidence`'s) |
| All 10 mandatory sections present | M2 — `check_plan_completeness.py` (sub-check 1) |
| ADR count ≥ 2 in `## ADRs` section | M2 — `check_plan_completeness.py` (sub-check 4) |
| Question budget 5 ≤ N ≤ 10, per-corner ≤ 3, per-corner ≥ 1 OR DEFER-CORNER | M2 — `check_plan_completeness.py` (sub-check 2) |
| Method (Fase A + Fase B) present on every Q | M2 — `check_plan_completeness.py` (sub-check 3, header-text-based per EC-2 of source plan) |
| `--skip-checks` / `--force` flag MUST NOT exist | Constructor invariant in `run_discover_plan_score.py` |
| `hard_caps_triggered` list MUST be non-empty when verdict == INVALID | JSON schema invariant |
| `<!-- DEFER-CORNER: {corner} | {reason} -->` is the ONLY recognized deferral marker (per D5 of source plan) | M2 — shared recognizer across `check_research_coverage` + `check_plan_completeness` |

## Soft gates (do not block; surface in the report)

These are NOT inquebrável — they downgrade verdict from `SHIPPABLE` (90+) to `SHIPPABLE_WITH_CAVEATS` (cap 89), not to `INVALID`:

1. **High smell density** — ≥ 20 weak-imperative / loophole / vague-pronoun hits in prose. Stable identifier `soft_floor_smell_density_high`.
2. **Citation density low** — < 1 `referencia/` citation per 200 words of plan prose, AND at least one citation exists. Stable identifier `soft_floor_citation_density_low`.

Soft caps appear in `hard_caps_triggered` with prefix `soft_floor_` for auditability. They do NOT trigger `verdict == INVALID`.

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement — including renaming, replacing, or removing any of the stable identifiers above — MUST:

1. Cite the ADR that justifies the change.
2. Document what changes in the `## Rules that cannot be bent` section of this file.
3. Update `.claude/rules/discover-plan-thresholds.txt` reference to the new ADR + bump sunset date.
4. Surface the change in the CHANGELOG when the file is created.

PRs that **add** new inquebráveis (e.g., M3 future "fabricated symbol citation" check via SAFE-adapted semantic check) follow the same process, but with lower burden — extending the contract is less load-bearing than weakening it.

## Related

- Skill: [`.claude/skills/discover-plan-confidence/SKILL.md`](../skills/discover-plan-confidence/SKILL.md) (created in T3.1 of the discover-plan-confidence implementation plan)
- Thresholds: [`.claude/rules/discover-plan-thresholds.txt`](./discover-plan-thresholds.txt)
- Sibling rule: [`plan-confidence-golden-rule.md`](./plan-confidence-golden-rule.md) (gates implementation plans)
- Sibling rule: [`discover-blueprint-golden-rule.md`](./discover-blueprint-golden-rule.md) (gates blueprints)
- D5 (DEFER-CORNER convention): source plan § ADRs D5

## Log of changes to this file

| Date | Change | Rationale |
|---|---|---|
| 2026-05-22 | Rule created during T0.1 of the discover-plan-confidence implementation halt-loop. | Establishes the inquebrável contract for the new structural gate before the implementing code ships. |
