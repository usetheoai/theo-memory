# Dogfood Golden Rule (INQUEBRÁVEL)

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

**Source of truth for the `/dogfood` skill's most important contract.**

## The Rule

**A `production-ready` claim, a promotion to v1.0, or any public copy stating that TheMemory is production-grade is INVALID and CANNOT be made when:**

1. **The anchor scenario is missing from the manifest.** `.claude/knowledge-base/dogfood/manifest.md` does not declare the anchor scenario "Claude Code auto-memory backed by TheMemory" with `Status:` field present.
2. **The anchor scenario is not `running`.** Status is `planned`, `wired`, `paused`, or `abandoned`. Only `running` counts. As of [ADR-0012](../knowledge-base/adrs/ADR-0012-dogfood-gate-empirical-snapshot-amendment.md) (2026-06-04), the `running` status is reachable via either the original sustained-soak path OR the empirical-snapshot path — see § Status transition criteria in the manifest.
3. **No evidence file exists for the anchor scenario.** `.claude/knowledge-base/dogfood/evidence/` contains zero files whose frontmatter `scenario:` matches the anchor scenario slug.
4. **The latest anchor-scenario evidence file is older than 30 days.** A `running` status with stale evidence (no log in the last 30 days) is treated as silent abandonment.

This is NOT a guideline. It is a constraint enforced by the `/dogfood` skill itself. The skill SHALL fail-closed when an unbreakable rule is violated.

## What it requires

1. **Verdict capping.** Final verdict is `EVIDENCE_INSUFFICIENT` (not `EVIDENCE_WITH_CAVEATS` or `EVIDENCE_SUFFICIENT`) when any unbreakable rule is violated — regardless of how complete other dogfood scenarios are.
2. **Vocabulary lock.** The phrases `production-ready`, `production-grade`, and `v1.0 ready` SHALL NOT appear in README, CHANGELOG, public copy, or marketing material while the verdict is `EVIDENCE_INSUFFICIENT`.
3. **Audit list.** When emitting `EVIDENCE_INSUFFICIENT`, the skill MUST list which of the 4 unbreakable rules above are triggered, using stable identifiers (`anchor_missing`, `anchor_not_running`, `no_anchor_evidence`, `anchor_evidence_stale`).
4. **No bypass flag.** A `--force` / `--skip-checks` / `--accept-caveats` flag does NOT exist and SHALL NOT be added to the `/dogfood` skill.

## Why this rule exists

CLAUDE.md (root) locks the honesty discipline: "No production claims until v1.0 with benchmarks reproduced independently." Benchmarks prove the system responds; **dogfood proves the system is usable**. The two are complementary.

The SOTA failure mode for memory systems is exactly this: high benchmark scores in synthetic eval (LongMemEval, MemQA, etc.) combined with miserable real-world DX. A team can ship a Mem0 clone that passes its own benchmarks while being unusable in any actual agent loop. Without a dogfood gate, the temptation to claim production-ready at v1.0 — backed only by benchmarks reproduced against curated datasets — is high.

The anchor scenario "Claude Code auto-memory backed by TheMemory" was chosen because:

- It is the same problem TheMemory solves (scoped persistent memory across sessions).
- The team uses Claude Code daily, so dogfood signal is high-frequency.
- DX pain, API gaps, and retrieval misses surface immediately, not in monthly review cycles.
- It cannot be a privileged-access dogfood (the kind that becomes theater) — Claude Code is a third-party CLI consuming TheMemory through its public API.

The rule closes the honesty gap by forcing minimum real-usage evidence PRESENT before the production claim can be made.

## Rules that cannot be bent

| Rule | Enforcement |
|---|---|
| Anchor scenario present in manifest | `/dogfood` audit — `check_anchor_present` |
| Anchor scenario status == `running` | `/dogfood` audit — `check_anchor_running` |
| At least 1 anchor-scenario evidence file exists | `/dogfood` audit — `check_anchor_evidence` |
| Latest anchor-scenario evidence ≤ 30 days old | `/dogfood` audit — `check_anchor_evidence_fresh` |
| Vocabulary lock on `production-ready` / `production-grade` / `v1.0 ready` while verdict is INSUFFICIENT | `/dogfood` audit + manual review of public copy |
| `--force` / `--skip-checks` flag MUST NOT exist | Constructor invariant in `/dogfood` skill |
| Anchor scenario itself MUST NOT be silently swapped | Strategic review required (see § When this rule may change) |

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement — including renaming, replacing, or removing the anchor scenario — MUST:

1. Cite the ADR that justifies the change.
2. Document what changes in the `## Rules that cannot be bent` section of this file.
3. Update the manifest with a `## Decision log` entry pointing to the ADR.
4. Surface the change in the CLAUDE.md change log (when CHANGELOG.md is created) under `Changed`.

PRs that **add** new dogfood scenarios (e.g., `@usetheo/sdk agents using agent-tools` once v0.3 ships) follow the same process, but with lower burden (extending, not softening). The anchor scenario cannot be one of several equals — it remains the locked baseline.

## Soft gates (do not block, but surface in the report)

These are NOT inquebrável — they downgrade verdict from `EVIDENCE_SUFFICIENT` to `EVIDENCE_WITH_CAVEATS`, not to `EVIDENCE_INSUFFICIENT`:

1. **No DX pains or API gaps logged.** Evidence files have empty `DX pains encountered` / `API gaps surfaced` sections. Stable identifier `soft_no_pains_logged`. Either dogfood is too shallow OR the API is suspiciously perfect (the latter is rarely true). This soft cap is REINFORCED as of ADR-0012 — promoted to mandatory pre-requisite of the empirical-snapshot path (the evidence file documenting the snapshot MUST list ≥ 3 concrete DX pains to satisfy the path's bar).

### Dropped soft gates (per ADR-0012 — 2026-06-04)

The following soft caps applied only to the original sustained-soak path. With the empirical-snapshot path added by ADR-0012, they no longer fire under any path:

- **`soft_sustained_lt_30d`** — first evidence file is less than 30 days old. Dropped because the empirical-snapshot path treats day-0 evidence as legitimate when the snapshot bar is met.
- **`soft_evidence_density_low`** — fewer than 1 evidence file per 10 days running. Dropped for the same rationale; density-per-running-day is a sustained-soak measure that does not apply to snapshot evidence.

Teams that prefer the original sustained-soak operating model can still satisfy the gate that way (the path remains in the manifest's § Status transition criteria), but the soft caps no longer enforce density / 30-day soak — DX pains documentation is now the load-bearing honesty signal.

## Related

- Skill: `.claude/skills/dogfood/SKILL.md`
- Manifest: `.claude/knowledge-base/dogfood/manifest.md`
- Evidence dir: `.claude/knowledge-base/dogfood/evidence/`
- Inquebrável Rule 3 (Honestidade Extrema) — root `/home/paulo/.claude/CLAUDE.md`
- Project honesty discipline — `/home/paulo/Projetos/usetheo/theo-memory/CLAUDE.md § Roadmap → Honesty discipline`

## Log of changes to this file

| Date | Change | Rationale |
|---|---|---|
| 2026-05-22 | Rule created at day 0 of TheMemory project. Anchor scenario locked. | User decision: enforce dogfood discipline before any code lands, to prevent silent slide into production-ready claims backed only by benchmarks. |
| 2026-06-04 | **ADR-0012 amendment** — added empirical-snapshot validation as an alternative path to `running` status (sustained-soak path REMAINS). Dropped soft caps `soft_sustained_lt_30d` + `soft_evidence_density_low`. Reinforced `soft_no_pains_logged` as mandatory pre-requisite of the empirical-snapshot path. The 30-day calendar window did not match project velocity at this stage; rather than incentivize evidence file backdating (anti-pattern #3) or gate-bypass (anti-pattern #6), the rule now recognizes session-bounded end-to-end empirical validation as legitimate evidence when measurable criteria are met (concrete pgvector row counts, semantic recall cosine threshold, configuration reproducibility, ≥ 3 DX pains logged). Authorized via project-owner `AskUserQuestion` response "Option A" in the same session that produced the empirical artifacts. | [ADR-0012](../knowledge-base/adrs/ADR-0012-dogfood-gate-empirical-snapshot-amendment.md) — see § Decision + § Consequences for the trade-off rationale and the rollback procedure. |
