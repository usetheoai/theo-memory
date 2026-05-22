# Plan-Confidence Golden Rule (INQUEBRÁVEL) — TEMPLATE

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

> Copy this file to `.claude/rules/plan-confidence-golden-rule.md` in your project.

**Source of truth for the `/plan-confidence` skill's most important contract.**

## The Rule

**A plan is INVALID and CANNOT produce a SHIPPABLE verdict when:**

1. Coverage Matrix < 100% (gaps not mapped to tasks)
2. At least one fabricated citation (file/symbol pointed to in `Evidence:` does not exist in the repo) — *M3, future*

This is NOT a guideline. It is a constraint enforced by the skill itself.
The skill SHALL fail-closed when an unbreakable rule is violated.

## What it requires

1. **Score capping.** Final score is capped at 49 when any unbreakable rule is violated — regardless of how high the weighted_avg would be.
2. **Mandatory verdict.** The returned verdict is `INVALID`, not `SHIPPABLE_WITH_CAVEATS` or any other band.
3. **Vocabulary lock.** The word "shippable" SHALL NOT appear in the report (unqualified) when the score is capped.
4. **Hard cap audit.** JSON output MUST list all triggered caps in `hard_caps_triggered` with stable identifiers (e.g., `"coverage_lt_100"`, `"adr_without_alternatives"`).
5. **Visual rendering.** When capped, the INVALID band appears in red (terminal with color; plain `[INVALID]` when no color).

## Why this rule exists

The SOTA literature documents that ~57% of citations in LLM systems are post-rationalizations (Wallat et al. 2024, `arXiv:2412.18004`). The model decides first and cites later. Without unbreakable hard caps, a plan with incomplete Coverage Matrix or fabricated citations can score high via composition (other dimensions perfect mask structural failure).

The lesson: **tests passing ≠ system works.** Applied to planning: **average scores ≠ implementable plan.** A plan with coverage gaps or fabricated claims will produce production bugs even if 90% of other checks are green.

The rule closes this gap by forcing minimum structural state PRESENT before the aggregate matters.

## Rules that cannot be bent

| Rule | Enforcement |
|---|---|
| Coverage Matrix present and 100% | M2 — `run_structural.py` via `check_coverage_matrix.py` |
| Fabricated citation → score ≤ 49 | M3 (future) — SAFE adapted to `ripgrep + tree-sitter + read_file` |
| ADR without alternatives in Rationale → score ≤ 70 | M2 — `check_adr_completeness.py` |
| Bug-fix task without TDD RED-GREEN-REFACTOR → score ≤ 70 | M2 — `check_tdd_in_bugfix.py` |
| `--skip-checks` flag does not exist and SHALL NOT be added | Constructor invariant in `run_structural.py` |
| Score capped MUST appear marked in the report | Rendering rule |
| `hard_caps_triggered` list MUST be non-empty when verdict==INVALID | JSON schema invariant |
| Renormalization (D8) does NOT bypass hard caps | `final_score_after_caps = min(weighted_avg, smallest_active_cap)` |
| `/deps-audit` returns FAIL_INSECURE → score ≤ 49 (CVE in declared dep) | v1.1 (2026-05-22) — wired via `run_structural.py` `--invoke-deps-audit` (planned downstream — see `cycle-plan.md` v1.1 § Downstream changes) |
| `/code-quality` returns FAIL_HARD → score ≤ 49 (unallowlisted dead code OR fabricated symbol) | v1.2 (2026-05-22) — wired via `run_structural.py::_invoke_code_quality()` extension shipped in T6.5 of code-quality-skill-plan.md (EC-29 Opção A). Stable identifiers: `dead_code_unallowlisted_{python\|typescript\|rust\|go}`, `symbol_fabrication_{python\|typescript\|rust\|go}`, `allowlist_malformed_entry`. |

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement MUST:

1. Cite the ADR that justifies the change.
2. Document what changes in the `## Rules that cannot be bent` section of this file.
3. Bump `plan-confidence-thresholds.txt` reference to the new ADR.
4. Add log entry with date and reason.

PRs that **add** new hard caps (e.g., M3 activates "fabricated citation") follow the same process, but with lower burden (extending, not softening).

## Related

- Skill: `.claude/skills/plan-confidence/SKILL.md`
- Thresholds: `.claude/rules/plan-confidence-thresholds.txt`
- Allowlist: `.claude/rules/plan-confidence-allowlist.txt`
- Defaults (fallback): `.claude/skills/plan-confidence/defaults/`
- Sibling golden rules consumed at runtime: [`deps-audit-golden-rule.md`](./deps-audit-golden-rule.md), [`code-quality-golden-rule.md`](./code-quality-golden-rule.md)

## Log of changes

| Date | Change | Authorized by |
|---|---|---|
| 2026-05-22 | Extension: added `/deps-audit` (v1.1) + `/code-quality` (v1.2) verdict consumption rows to `## Rules that cannot be bent`. Extension (not softening) per the policy in `## When this rule may change`. Sibling golden rules added to `## Related`. | Project owner via explicit approval during T6.2 of `code-quality-skill-plan.md` v1.3 execution. |
