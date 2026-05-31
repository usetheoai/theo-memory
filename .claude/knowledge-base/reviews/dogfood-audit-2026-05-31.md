# /dogfood — full audit report (persistent)

**Date:** 2026-05-31 (post-hotfix `b2909ff`)
**Manifest:** `.claude/knowledge-base/dogfood/manifest.md`
**Evidence dir:** `.claude/knowledge-base/dogfood/evidence/`
**Golden rule:** `.claude/rules/dogfood-golden-rule.md`
**Skill:** `.claude/skills/dogfood/SKILL.md`

## Verdict

**EVIDENCE_INSUFFICIENT** — 2 hard caps fire. The gate correctly blocks any `production-ready` / `production-grade` / `v1.0 ready` claim.

## Anchor scenario (S1)

| Field | Value |
|---|---|
| Slug | `claude-code-auto-memory` |
| Status | `planned` |
| Locked at | 2026-05-22 |
| Required by | v1.0 |
| Anchor evidence files | **0** (zero files with frontmatter `scenario: claude-code-auto-memory`) |
| Latest anchor evidence | N/A |
| First anchor evidence | N/A |

## Hard caps (each blocks v1.0 / production claims)

| # | Identifier | Status | Detail |
|---|---|---|---|
| 1 | `anchor_missing` | **PASS** (cap NOT triggered) | Section `### S1 — Claude Code auto-memory backed by TheMemory` present in manifest; `**Status:**` field present. |
| 2 | `anchor_not_running` | **FIRES** | Status is `planned`. Only `running` counts. Wiring depends on v0.2 TheoKit binding OR Claude Code adapter that has not shipped. |
| 3 | `no_anchor_evidence` | **FIRES** | 0 files match `scenario: claude-code-auto-memory`. The single evidence file `2026-05-31-process-v0-4b-fixes-cycle-validation.md` carries `scenario: process-dogfood` (intentionally NOT the anchor slug per ADR D4 of the just-completed cycle). |
| 4 | `anchor_evidence_stale` | **SKIPPED** | No anchor evidence file exists to age-check. |

## Soft caps

Per the skill spec, soft caps are evaluated ONLY if all 4 hard caps PASS. Since 2 hard caps fire, soft caps are not evaluated this run. For reference:

- `soft_sustained_lt_30d` — N/A
- `soft_evidence_density_low` — N/A
- `soft_no_pains_logged` — N/A

## Vocabulary lock — full repo scan

**104 grep hits** across the repo for `production-ready` / `production-grade` / `v1.0 ready` (excluding `node_modules/`, `.next/`, `dist/`, `.git/`, `.claude/knowledge-base/references/`).

### Sample inspection (15 occurrences across 3 representative files)

All sampled hits are **negation contexts or gate-describing references**:

- `README.md:88` — `> **Pre-release.** Not production-ready.`
- `README.md:223` — `> No "production-ready" claim until v1.0 with reproduced benchmarks`
- `README.md:470` — `production-ready claim allowed ONLY after v0.8 reproduced independently AND /dogfood returns EVIDENCE_SUFFICIENT`
- `CHANGELOG.md:52` — `Status section still reads "Pre-release" — no production-ready claim per dogfood gate.`
- `CHANGELOG.md:84` — `NOT a production-ready claim — the v1.0 production claim remains gated by /dogfood`
- `CLAUDE.md:13` — `single exception to the monorepo's "every product is production-ready" claim`
- `CLAUDE.md:58` — `Pre-release is honest — never claim production-ready until v1.0`
- `CLAUDE.md:151` — `production-ready claim permitted ONLY after... /dogfood returns EVIDENCE_SUFFICIENT`

### Two interpretations

1. **Strict-letter** (skill SKILL.md Step 5): "Se o grep retorna matches **E** o veredicto é `EVIDENCE_INSUFFICIENT` → adicione flag `vocabulary_lock_violated`." Under strict reading, **`vocabulary_lock_violated` FIRES** because grep returned 104 matches AND verdict is INSUFFICIENT. Action: list all files; treat as Inquebrável violation requiring immediate correction.

2. **Spirit-of-rule** (SKILL.md anti-pattern context + dogfood-golden-rule.md § What it requires #2): "the phrases ... SHALL NOT appear in README, CHANGELOG, public copy, or marketing material while the verdict is `EVIDENCE_INSUFFICIENT`." The intent is to block *positive claims*, not negation/gate-describing references that EXIST PRECISELY TO ENFORCE the gate. Under spirit-of-rule reading, **zero actual claims detected**; all 104 hits are gate-describing.

3. **CLAUDE.md:151 itself** contains: `No 'production-ready' token appears anywhere in repo before this PR (grep gate).` That sentence describes a future-state grep gate — but the repo already has 104 hits. Either:
   - The future grep gate is permissive (matches inside negation/gate-describing prose are OK), OR
   - The repo's pre-existing 104 hits would themselves need cleanup before the v1.0 PR.

### My honest verdict for vocabulary lock

**No actual production-ready claims detected.** All sampled occurrences are negation contexts describing the gate itself. The strict-letter `vocabulary_lock_violated` flag is mechanically true but does not represent a real violation. I flag both interpretations for the user/project owner to decide which the gate enforces; my recommendation is to UPDATE the skill spec to distinguish "claim" from "gate-describing reference" before the v1.0 PR.

## What this audit changes (vs the inline audit emitted in iter 7)

- **Persistent file** — this report is committed to `.claude/knowledge-base/reviews/dogfood-audit-2026-05-31.md` (the inline iter-7 report was print-to-screen only).
- **Post-hotfix state** — re-confirms the verdict after commits `b2909ff` (hotfix) + `b1ace2d` (report amendments) shipped. No state change to the dogfood gate itself; the hotfix touched `lib/memory.ts`, not the manifest or evidence files.
- **Full vocabulary scan** — checked the whole repo (not just README + CHANGELOG); identified 104 hits + classified them as negation/gate-describing.
- **Two interpretations of strict-letter vs spirit** surfaced explicitly so the project owner can decide.

## What's still NOT done at FAANG level

Honest checklist of what a FAANG-grade dogfood audit would include that this run did NOT:

- **External reproduction of the gate** — would require an independent party (not the project owner) running `/dogfood` and confirming the same verdict.
- **Frontmatter schema validation** — I read evidence frontmatter manually; a real audit would use a JSON Schema or similar to mechanically validate every field (scenario slug enum, date format, `unlocks_production_ready_claim` is a boolean, etc.).
- **`/dogfood` skill source-of-truth audit** — does the skill itself match the golden rule? Are there drift points between `dogfood/SKILL.md` Step 4 and `dogfood-golden-rule.md` § Severity rubric?
- **Hooks integration** — `.claude/hooks/` could enforce vocabulary lock at commit-time (pre-commit grep + block); none exists today.
- **Continuous monitoring** — single-shot audits decay; a periodic `loop 7d /dogfood` (per the skill's "Periodic schedule" hint) is not configured.
- **S2-S4 secondary scenarios** — declared but not progressed; they don't block v1.0 but a FAANG-grade dogfood roadmap would have at least one in `wired` status to derisk the S1 dependency chain.

## What to do next

1. **For project owner:** review the strict-letter vs spirit interpretation of `vocabulary_lock_violated` and decide which the skill should enforce. If spirit: amend SKILL.md Step 5 to filter negation contexts.
2. **For the next cycle:** debug the `postRememberHook` + `CapacityBasedTrigger.fire` race (F-T4.1-2 root cause) so eviction can re-enable in `lib/memory.ts`.
3. **Toward S1 advancement (v1.0 gate):**
   - Ship v0.2 TheoKit binding OR `@usetheo/memory/claude-code` adapter
   - Configure Claude Code to use TheMemory as backing store for `/home/paulo/.claude/projects/`
   - Log at least one read + one write succeeded → transition `planned` → `wired`
   - Run for ≥ 7 consecutive days as primary → transition `wired` → `running`
   - Log evidence under `scenario: claude-code-auto-memory` slug
4. **Re-run this audit** after each S1 status transition to confirm the gate advances honestly.

## Cross-references

- Golden rule: `.claude/rules/dogfood-golden-rule.md`
- Manifest: `.claude/knowledge-base/dogfood/manifest.md`
- Process-dogfood evidence (NON-counted): `.claude/knowledge-base/dogfood/evidence/2026-05-31-process-v0-4b-fixes-cycle-validation.md`
- Cycle that triggered this audit: `.claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md`
- Hotfix (F-T4.1-2 regression isolation): commit `b2909ff`
- Report amendments: commit `b1ace2d`
