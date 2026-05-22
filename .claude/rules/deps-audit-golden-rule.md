# Deps-Audit Golden Rule (INQUEBRÁVEL)

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

**Source of truth for the `/deps-audit` skill's most important contract.**

Sibling of [`plan-confidence-golden-rule.md`](./plan-confidence-golden-rule.md) and [`dogfood-golden-rule.md`](./dogfood-golden-rule.md) — same shape, applied to dependency hygiene.

## The Rule

**An implementation plan is INVALID and CANNOT proceed to `/plan-confidence` (and therefore CANNOT reach `/implement`) when any of these fire:**

1. **Plan missing `## Dependencies` section.** Every plan that introduces, uses, or removes a dependency MUST declare it explicitly. Stable identifier: `plan_dependencies_section_missing`.
2. **Plan declares a dep WITHOUT a version pin.** Every declared dep MUST have a version spec (`^1.2.3`, `~1.2.0`, `=1.2.3-rc1`, etc.). Stable identifier: `plan_dep_version_unspecified`.
3. **Plan declares a dep that has a CRITICAL or HIGH CVE at the declared version.** Without an explicit allowlist entry (with sunset ≤ 30 days for CRITICAL, ≤ 60 days for HIGH), this is BLOCKER. Stable identifiers: `plan_dep_critical_cve` / `plan_dep_high_cve`.
4. **Plan declares a NEW dep without Rule 9 evaluation.** Every NEW row in `## Dependencies` MUST list: which libraries were evaluated, which were rejected, and why this one was selected. Stable identifier: `plan_new_dep_no_rule9_evaluation`.
5. **Plan declares a dep that does not exist on its ecosystem registry.** Stable identifier: `plan_dep_not_on_registry`.

This is NOT a guideline. It is a constraint enforced by `/deps-audit` itself. The skill SHALL fail-closed when an unbreakable rule is violated.

## Additional inquebráveis that cap at 70 (SHIPPABLE_WITH_CAVEATS at most):

6. **Plan declares dep with MEDIUM CVE.** Stable identifier: `plan_dep_medium_cve`. Allowlistable with rationale; sunset ≤ 90 days.
7. **Plan declares MAJOR-outdated dep without ADR pinning rationale.** Stable identifier: `plan_dep_major_outdated_unpinned`. Major bumps may break; if the plan pins to an older major, it MUST justify why via an ADR row.
8. **Auditor unavailable for an ecosystem present in the plan.** E.g., plan introduces Python deps but `pip-audit` not installed in the runtime. Stable identifier: `auditor_unavailable_{name}`. The cap reflects the inability to RULE OUT a HIGH/CRITICAL exposure honestly.

## Severity rubric (locked)

| Finding | Cap | Stable identifier |
|---|---|---|
| CVE CRITICAL in declared dep | 49 (INVALID) | `plan_dep_critical_cve` |
| CVE HIGH in declared dep | 49 (INVALID) | `plan_dep_high_cve` |
| CVE MEDIUM in declared dep | 70 | `plan_dep_medium_cve` |
| CVE LOW in declared dep | 89 | `plan_dep_low_cve` |
| Outdated MAJOR, not pinned via ADR | 89 | `plan_dep_major_outdated_unpinned` |
| Plan `## Dependencies` missing | 49 | `plan_dependencies_section_missing` |
| Plan dep version unspecified | 49 | `plan_dep_version_unspecified` |
| Plan NEW dep no Rule 9 eval | 49 | `plan_new_dep_no_rule9_evaluation` |
| Plan dep not on registry | 49 | `plan_dep_not_on_registry` |
| Auditor unavailable, ecosystem present | 70 | `auditor_unavailable_{name}` |

Allowlisted findings (within sunset) downgrade by ONE severity level (CRITICAL → MEDIUM, HIGH → LOW). Expired allowlist entries are ignored — the CVE re-fires at full severity.

## What it requires

1. **Score capping in `/plan-confidence`.** When `/deps-audit` returns a verdict ≤ FAIL_*, `/plan-confidence` MUST cap at the corresponding band. *(Follow-up wiring — see `cycle-plan.md` v1.1 § Downstream changes for the formal ADR-tracked integration.)*
2. **Vocabulary lock.** The phrase "no known vulnerabilities" SHALL NOT appear in any report when an auditor failed to run (incomplete coverage ≠ clean).
3. **Hard cap audit.** Every report MUST list all triggered caps in `hard_caps_triggered` with the stable identifiers above.
4. **No bypass flag.** `--force`, `--skip-audit`, `--accept-cves` SHALL NOT exist. Allowlist with mandatory sunset is the ONLY mechanism to suppress findings.

## Why this rule exists

Two failure modes drive it:

1. **Silent supply-chain compromise.** A dep with a known CVE gets pulled into the project; no audit ran; production ships with the hole. Historical incidents: event-stream (2018), ua-parser-js (2021), xz (2024), `colors.js` (2022), `node-ipc` (2022).
2. **"It was on the radar."** Team knew about a CVE but had no formal gate; the upgrade slipped; release went out anyway. The allowlist + sunset mechanism converts informal awareness into auditable record with a forced revisit date.

Plus Inquebrável Rule 9 (Não Reinvente a Roda): the only way to know we're using existing libs RESPONSIBLY (not just to dodge work) is to actively audit them. A plan that introduces a NEW dep without naming the alternatives it rejected is failing Rule 9 silently.

## Allowlist mechanism

`.claude/rules/deps-audit-allowlist.txt` — line-per-entry format:

```
ECOSYSTEM|PACKAGE|VERSION-RANGE|CVE-ID|REASON|SUNSET-DATE
```

Example:

```
npm|lodash|^4.17.20|CVE-2021-23337|patch upgrade requires regression test suite rerun, scheduled Q3|2026-08-01
```

Rules:

- **Sunset is MANDATORY** and MUST be ≤ 30 days for CRITICAL, ≤ 60 days for HIGH, ≤ 90 days for MEDIUM/LOW from the entry's creation date.
- After sunset passes, the entry is IGNORED (CVE re-fires at full severity).
- REASON MUST be specific (no "WIP", "TODO", "later", "investigating").
- Adding an entry requires a comment in the plan that introduced it, explaining the rationale + linking the planned remediation.
- Removing/extending an entry requires a commit message with rationale.

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement — including renaming, replacing, or removing any of the stable identifiers above — MUST:

1. Cite the ADR that justifies the change.
2. Document changes in the `## Rules that cannot be bent` section of this file.
3. Update `.claude/rules/deps-audit-allowlist.txt` policy section (if changed) + bump sunset.
4. Surface the change in CHANGELOG when created.

PRs that **add** new inquebráveis (e.g., M2 future "supply-chain provenance check via SLSA attestation", "transitive dep blast-radius") follow the same process, but with lower burden — extending the contract is less load-bearing than weakening it.

## Soft gates (do not block; surface in the report)

These are NOT inquebrável — they downgrade verdict from `PASS` (90+) to `PASS_WITH_CAVEATS` (cap 89), not to `INVALID`:

1. **Outdated MINOR / PATCH across many deps.** If >50% of direct deps are at least PATCH behind, surface as `soft_floor_stale_deps_density`.
2. **Lockfile out of sync with manifest.** Manifest declares `^1.2.3` but lockfile resolves `1.0.0`. Stable identifier `soft_floor_lockfile_drift`.
3. **Multiple lockfiles for the same ecosystem.** E.g., both `package-lock.json` AND `yarn.lock` present. Stable identifier `soft_floor_multiple_lockfiles`.

## Related

- Skill: [`.claude/skills/deps-audit/SKILL.md`](../skills/deps-audit/SKILL.md)
- Allowlist: [`.claude/rules/deps-audit-allowlist.txt`](./deps-audit-allowlist.txt)
- Cycle: [`.claude/rules/cycle-plan.md`](./cycle-plan.md) § Phase contracts (v1.1)
- Sibling golden rule (plans): [`plan-confidence-golden-rule.md`](./plan-confidence-golden-rule.md)
- Sibling golden rule (production claims): [`dogfood-golden-rule.md`](./dogfood-golden-rule.md)
- Inquebrável Rule 9: [`/home/paulo/.claude/CLAUDE.md § 9`](file:///home/paulo/.claude/CLAUDE.md) (Não Reinvente a Roda)
- Token budget: [`.claude/rules/token-budget.md`](./token-budget.md) § cycle-plan

## Log of changes to this file

| Date | Change | Rationale |
|---|---|---|
| 2026-05-22 | Rule created at day 0 of the `/deps-audit` skill. Anchor: deps MUST be declared in the plan + version-pinned + Rule-9-evaluated + CVE-clean before `/plan-confidence` can return ≥ SHIPPABLE_WITH_CAVEATS. | User directive 2026-05-22: skill must block plan execution; plan must declare which dependencies will be used and their versions. Decisions captured via AskUserQuestion: multi-ecosystem auto-detection; tools = npm audit + npm outdated + pip-audit + osv-scanner + Renovate/Dependabot config; behavior = audit + propose diffs (no auto-apply); gate = blocks plan execution via declared `## Dependencies` section validation. |
