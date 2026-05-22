# Code-Quality Golden Rule (INQUEBRÁVEL)

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

**Source of truth for the `/code-quality` skill's most important contract.**

Sibling of [`plan-confidence-golden-rule.md`](./plan-confidence-golden-rule.md), [`deps-audit-golden-rule.md`](./deps-audit-golden-rule.md), and [`dogfood-golden-rule.md`](./dogfood-golden-rule.md) — same shape, applied to code-quality hygiene (dead code, fabricated symbols, orphan exports, weak test quality).

## The Rule

**A pull request (or a plan when bound via Mode 2) is INVALID and CANNOT proceed to `/review` (and therefore CANNOT be merged) when any of these fire:**

1. **Dead code present and NOT allowlisted.** Functions, classes, modules, exports, or dependencies that are unused AND have no active allowlist entry with sunset ≤ 90 days. Stable identifier: `dead_code_unallowlisted_{language}` (one per language: `dead_code_unallowlisted_python`, `dead_code_unallowlisted_typescript`, `dead_code_unallowlisted_rust`, `dead_code_unallowlisted_go`).
2. **Fabricated symbol (package or API).** A package import that does not exist on its registry (PyPI, npm, crates.io, Go proxy) at the declared version, OR a function/method call against a known library whose signature introspection confirms the symbol does NOT exist. Stable identifier: `symbol_fabrication_{language}`.

This is NOT a guideline. It is a constraint enforced by `/code-quality` itself. The skill SHALL fail-closed when an unbreakable rule is violated.

## Additional inquebráveis that cap at 70 (SHIPPABLE_WITH_CAVEATS at most):

3. **Plan invokes Mode 2 + D4 enabled BUT plan lacks `## Critical paths` section.** Mutation testing has no scope to operate against. Stable identifier: `plan_missing_critical_paths_section`.
4. **Allowlist entry malformed.** A line in `.claude/rules/code-quality-allowlist.txt` failing format validation (regex `^\d{4}-\d{2}-\d{2}$` on sunset, calendar-valid date, non-empty rationale). Silent acceptance would let typos bypass the gate. Stable identifier: `allowlist_malformed_entry`.

## Soft caps (do not invalidate; surface in report)

5. **Cross-package orphan export.** A public symbol exported by a file under `src/` (production) that has ZERO importers across the repo (excluding test files + barrel `index.ts`/`__init__.py` files + declared package.json entry points). May be a legitimate library API awaiting consumers OR forgotten dead code. Stable identifier: `soft_cap_orphan_export_{language}`. Cap: 70.
6. **Mutation score < 60% on critical path.** Test quality below floor. Stable identifier: `soft_cap_mutation_score_low_{language}`. Cap: 70.
7. **Mutation score 60-79% on critical path.** Test quality medium tier. Stable identifier: `soft_floor_mutation_score_medium_{language}`. Cap: 89.
8. **Auditor unavailable for an enabled language.** E.g., language is `ENABLED` in `code-quality-languages.txt` but the corresponding external CLI (knip, vulture, cargo-udeps, deadcode) is not installed in the runtime. Stable identifier: `auditor_unavailable_{tool}`. Cap: 70.
9. **`--no-network` flag set; D2 (symbol fabrication) skipped.** Single INFO Finding emitted, NOT capping verdict directly. Stable identifier (informational only, not in `hard_caps_triggered`): `d2_disabled_no_network`. Behavior documented for air-gapped CI.

## Severity rubric (locked)

| Finding | Cap | Stable identifier |
|---|---|---|
| Dead code not allowlisted (any language) | 49 (INVALID) | `dead_code_unallowlisted_{language}` |
| Symbol fabrication (any language) | 49 (INVALID) | `symbol_fabrication_{language}` |
| Plan missing `## Critical paths` when D4 enabled | 70 | `plan_missing_critical_paths_section` |
| Allowlist entry malformed | 49 | `allowlist_malformed_entry` |
| Cross-package orphan export | 70 | `soft_cap_orphan_export_{language}` |
| Mutation score < 60% on critical path | 70 | `soft_cap_mutation_score_low_{language}` |
| Mutation score 60-79% on critical path | 89 | `soft_floor_mutation_score_medium_{language}` |
| Auditor unavailable, language enabled | 70 | `auditor_unavailable_{tool}` |

Allowlisted findings (within sunset) downgrade by ONE severity level: HARD (49) → SOFT_CAP (70), SOFT_CAP → SOFT_FLOOR (89). Expired allowlist entries are IGNORED — the finding re-fires at full severity.

## What it requires

1. **Score capping in `/plan-confidence`.** When `/code-quality` returns a verdict ≤ FAIL_HARD, `/plan-confidence` MUST cap at the corresponding band. Runtime integration shipped via T6.5 of the code-quality-skill implementation plan (extending `plan-confidence/scripts/run_structural.py`).
2. **Vocabulary lock.** The phrase "no dead code detected" SHALL NOT appear in any report when D1 auditors failed to run (incomplete coverage ≠ clean). Similarly "no fabricated symbols" SHALL NOT appear when D2 was disabled via `--no-network`.
3. **Hard cap audit.** Every report MUST list all triggered caps in `hard_caps_triggered` with the stable identifiers above.
4. **No bypass flag.** `--force`, `--skip-checks`, `--accept-caveats`, `--ignore-dead-code` SHALL NOT exist. Allowlist with mandatory sunset is the ONLY mechanism to suppress findings.
5. **Read-only invariant.** Skill SHALL NOT edit source code, manifests, or test files. Findings are SUGGESTIONS for human application. Auto-fix lives in a separate skill (does not yet exist by design — same constraint as `/deps-audit`).

## Why this rule exists

Three failure modes drive it:

1. **Silent dead code accumulation.** Functions and modules ship that nobody calls. Production carries dead weight; refactors become risky because devs can't tell what's actually used. Documented impact: codebases routinely carry 15-30% dead code by line count after 2-3 years without dead-code detection.

2. **Slopsquatting and fabricated APIs.** LLM-generated code hallucinates package names and API methods at quantifiable rates: GPT-4 Turbo hallucinates packages 4% of the time; CodeLlama 7B 26% (Spracklen et al. 2025). 19.7% of recommended packages in LLM code are fabricated; 58% repeat across queries, creating exploitable attack surface (slopsquatting). Without an automated gate, every PR carries this risk.

3. **Coverage theater.** Test suites with 90%+ line coverage but 40%+ mutation survival rate are common. Tests execute code without asserting anything meaningful. Without mutation testing on critical paths, "tests pass" is uncorrelated with "behavior protected".

Plus Inquebrável Rule 5 (TDD-first): the only way to know we're testing correctly is to validate via mutation testing. Plans that ship code with low mutation score have weak tests by definition.

## Allowlist mechanism

`.claude/rules/code-quality-allowlist.txt` — line-per-entry format:

```
ECOSYSTEM|FILE-PATH|FINDING-TYPE|SYMBOL-OR-LINE|REASON|SUNSET-DATE
```

Where:
- `ECOSYSTEM` ∈ `{python, typescript, rust, go}`
- `FILE-PATH` — repo-relative path (e.g., `src/foo/bar.py`)
- `FINDING-TYPE` ∈ `{dead_code, symbol_fab, orphan_export, mutation_low}`
- `SYMBOL-OR-LINE` — symbol name (sanitized — pipe characters escaped as `\|`)
- `REASON` — specific rationale; "WIP" / "TODO" / "later" / "investigating" are NOT accepted
- `SUNSET-DATE` — YYYY-MM-DD; MUST be:
  - ≤ 30 days from entry creation for HARD CAP findings (`dead_code_unallowlisted`, `symbol_fabrication`)
  - ≤ 90 days for SOFT findings (`orphan_export`, `mutation_low`)

Example:

```
python|.claude/skills/foo/scripts/legacy.py|dead_code|unused_helper|Pending refactor in Q3 sprint|2026-08-22
```

Rules:

- **Sunset is MANDATORY** and validated by `_shared.py::load_allowlist`. Format violations emit `allowlist_malformed_entry` HARD Finding (49) — NOT silently ignored.
- After sunset passes, the entry is IGNORED (finding re-fires at full severity).
- REASON MUST be specific. Vague placeholders rejected.
- Adding an entry requires a comment in the PR that introduced it, explaining the rationale + linking the planned remediation.
- Removing/extending an entry requires a commit message with rationale.

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement — including renaming, replacing, or removing any of the stable identifiers above — MUST:

1. Cite the ADR that justifies the change.
2. Document changes in the `## Severity rubric (locked)` section of this file.
3. Update `.claude/rules/code-quality-allowlist.txt` policy section (if changed) + bump sunset.
4. Surface the change in CHANGELOG.md under `Changed`.

PRs that **add** new inquebráveis (e.g., M2 future "static type narrowness check", "n+1 query detection") follow the same process, but with lower burden — extending the contract is less load-bearing than weakening it.

## Related

- Skill: [`.claude/skills/code-quality/SKILL.md`](../skills/code-quality/SKILL.md)
- Languages config: [`.claude/rules/code-quality-languages.txt`](./code-quality-languages.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](./code-quality-thresholds.txt)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](./code-quality-allowlist.txt)
- Cycle: [`.claude/rules/cycle-implement.md`](./cycle-implement.md) (when extended — wiring tracked via T6.1 of code-quality-skill-plan.md)
- Sibling golden rules: [`plan-confidence-golden-rule.md`](./plan-confidence-golden-rule.md), [`deps-audit-golden-rule.md`](./deps-audit-golden-rule.md), [`dogfood-golden-rule.md`](./dogfood-golden-rule.md)
- Inquebrável principles: [`/home/paulo/.claude/CLAUDE.md`](file:///home/paulo/.claude/CLAUDE.md) § 5 (TDD), § 9 (Não Reinvente)
- Token budget: [`.claude/rules/token-budget.md`](./token-budget.md) § cycle-implement (when extended)

## Log of changes to this file

| Date | Change | Rationale |
|---|---|---|
| 2026-05-22 | Rule created at T0.1 of the `/code-quality` skill implementation. Anchor: dead code + symbol fabrication MUST be detected and gated before any PR can merge. | Implements blueprint `wiring-deadcode-gates-blueprint.md` (2026-05-22) per plan `code-quality-skill-plan.md` v1.3 (SHIPPABLE_WITH_CAVEATS 85.2/100). |
