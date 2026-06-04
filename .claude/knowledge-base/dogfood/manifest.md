# Dogfood Manifest — @usetheo/memory

**Locked at:** 2026-05-22 (day 0 — pre-code)
**Source of truth:** This file + `.claude/knowledge-base/dogfood/evidence/`
**Golden rule (inquebrável):** [`.claude/rules/dogfood-golden-rule.md`](../../rules/dogfood-golden-rule.md)
**Skill that audits this file:** [`.claude/skills/dogfood/SKILL.md`](../../skills/dogfood/SKILL.md)

This manifest declares the dogfood scenarios required before any `production-ready` / `production-grade` / `v1.0 ready` claim for TheMemory. The anchor scenario S1 is **locked** — it cannot be silently substituted; changing it requires strategic review per the golden rule.

## Status field — legend

| Value | Meaning |
|---|---|
| `planned` | Declared in this manifest. No code wiring exists yet. |
| `wired` | Code path exists (TheMemory selected as backing store), but not in steady-state daily use. |
| `running` | **Daily, continuous use as primary backing store.** If TheMemory falls over, real memory is lost. Evidence files MUST be logged regularly. |
| `paused` | Temporarily stopped. Must be accompanied by a reason in the latest evidence file. NOT counted toward `EVIDENCE_SUFFICIENT`. |
| `abandoned` | Given up. NOT counted toward `EVIDENCE_SUFFICIENT`. Anchor scenario CANNOT enter this state without strategic review. |

## Anchor scenario (LOCKED — required for v1.0 / production claim)

### S1 — Claude Code auto-memory backed by TheMemory

**Slug:** `claude-code-auto-memory`
**Status:** `wired`
**Locked at:** 2026-05-22
**Required by:** v1.0
**Owner:** project owner (`usetheodev@gmail.com`)
**Latest evidence:** `2026-06-04-anchor-claude-code-first-wiring.md`
**First evidence:** `2026-06-04-anchor-claude-code-first-wiring.md`

#### Description

Claude Code maintains persistent auto-memory at `/home/paulo/.claude/projects/<project-slug>/memory/` — exactly the problem TheMemory solves: scoped (per-project), persistent (across sessions), retrievable on demand. Wiring this storage to TheMemory makes us the heaviest, highest-frequency user of our own product.

This is the most direct dogfood possible:

- Same shape as the API contract (User / Session / Agent — Claude Code's memory is per-user, per-project, per-conversation).
- High-frequency: the team uses Claude Code daily.
- Failure surfaces immediately (a bad retrieval shows up as "Claude forgot what we discussed last session").
- Not privileged-access — Claude Code is a third-party CLI consuming TheMemory through its public API.

#### Wiring depends on TheMemory roadmap

The anchor scenario CANNOT be in `running` state before the following milestones land:

- **v0.1 — core + local runtime.** Without it, there is no API to call.
- **v0.2 — TheoKit binding OR a direct adapter for Claude Code.** TBD: decide whether Claude Code consumes via TheoKit (default-on, request-context resolved) or via a dedicated adapter package (e.g., `@usetheo/memory/claude-code`). Open question for v0.0 contract design.

Until then, status remains `planned` (and the gate correctly blocks v1.0 claims).

#### Status transition criteria

| From → To | Required evidence |
|---|---|
| `planned` → `wired` | Code path exists: Claude Code is configured (via env var, settings.json, or adapter) to write/read its auto-memory through TheMemory's API. At least one read AND one write succeeded. Log via `/dogfood log-evidence`. |
| `wired` → `running` | TheMemory has been the PRIMARY backing store (not fallback) for ≥ 7 consecutive days. No silent fallback to file-based memory during that period. Log via `/dogfood log-evidence`. |
| `running` → `paused` | Explicit pause, with reason logged in evidence file. Resume by transitioning back to `running` (resets the 30-day sustained-evidence clock — see soft cap `soft_sustained_lt_30d`). |
| `running` → `abandoned` | **Anchor scenario cannot enter `abandoned` without strategic review.** A separate ADR + decision-log entry below required. |

#### What counts as sufficient evidence

Per the golden rule:

- **Hard gates (block v1.0 claim):**
  1. Status field is `running`.
  2. At least 1 evidence file exists referencing this scenario.
  3. The most recent evidence file is ≤ 30 days old.
- **Soft gates (caveats but not block):**
  1. First evidence file is ≥ 30 days old (sustained dogfood).
  2. Evidence density ≥ 1 file per 10 days running.
  3. At least one evidence file logs concrete DX pains or API gaps.

#### Open questions for this scenario

These remain open until v0.0 contract design completes; tracked here as part of TheMemory's "Open questions for the contract design" set (see project CLAUDE.md):

- Does Claude Code consume TheMemory via TheoKit (v0.2 binding) or via a dedicated adapter? Decision shapes whether v0.2 or v0.3 unblocks the `wired` transition.
- How does Claude Code's MEMORY.md index file map to TheMemory's retrieval model? Is the index itself a memory, or a derived view?
- The current Claude Code auto-memory uses a single hierarchical project slug. Does TheMemory's User scope map to user-level identity, project-level identity, or both via composite key?

---

## Other scenarios (optional — can be added as roadmap progresses)

None declared at day 0. The anchor scenario is the only LOCKED requirement.

Candidates for future addition (NOT counted toward v1.0 gate unless added by strategic review):

- **S2 — `@usetheo/sdk` agents using `agent-tools` MCP exposure.** Unblocked by v0.3.
- **S3 — TheoKit scaffolded apps with memory default-on.** Unblocked by v0.2.
- **S4 — Internal Theo team tools (Slack bots, internal RAG scripts) using TheMemory directly.** Unblocked by v0.1 (no specific milestone required beyond core).

Adding any of these as `required` for v1.0 (versus optional) requires strategic review per the golden rule. The anchor scenario remains the single locked baseline either way.

---

## Decision log

| Date | Decision | Rationale | Author |
|---|---|---|---|
| 2026-05-22 | Anchor scenario locked: Claude Code auto-memory backed by TheMemory. | Most direct dogfood available (same problem shape, high frequency, non-privileged access). Locked at day 0 to prevent silent slide into easier-but-less-honest scenarios when wiring is near. | project owner |
| 2026-06-04 | Anchor S1 transitions `planned` → `wired`. Plan: `dogfood-anchor-scenario-launch` T2.2. Round-trip integration test PASSES against real `themory mcp` + pgvector via Option C MCP `_meta` scope binding (`io.usetheo.themory/user_id`). T2.1 architectural gap (MCP stdio scope binding) closed in commit `95bd168`. Phase B 30-day soak window opens; `/dogfood audit` will return `EVIDENCE_INSUFFICIENT` with soft cap `soft_sustained_lt_30d` firing as EXPECTED steady state through day +29 (EC-11 absorption). T5.1 final audit runs at day +30+ when cap clears — interim audits during soak are NOT regressions. | dogfood-anchor-scenario-launch cycle |

Future decisions modifying the anchor scenario MUST be appended here with an ADR reference.

---

## How to update this manifest

- **Status transitions:** edit the `**Status:**` field in S1 directly. Add a note in `Decision log` if the transition is non-trivial (e.g., `running` → `paused` should reference an evidence file with the reason).
- **Latest evidence:** update the `**Latest evidence:**` field whenever a new evidence file is logged. The `/dogfood log-evidence` flow suggests this update.
- **Adding scenarios:** append to `## Other scenarios`. Promoting an optional scenario to `required` for v1.0 requires the strategic-review process documented in the golden rule.
- **NEVER edit this file to claim evidence that does not exist** — Inquebrável Rule 3 (Honestidade Extrema). The `/dogfood` audit reads evidence files, not the manifest; lying in the manifest produces a verdict that immediately contradicts the file system.

---

## Appendix — Process dogfood (NON-counted secondary scenario)

Added 2026-05-31 by plan `examples-chat-with-memory-v0-4b-expansion` ADR D4.

The `evidence/` directory may contain files with frontmatter `scenario: process-dogfood`. These document the **process** by which TheMemory's cycles (cycle-plan + cycle-implement + cycle-review) were validated against running infrastructure — `npm test`, `/test-chat-with-memory`, integration suites against real pgvector, etc.

**Process-dogfood files do NOT count toward S1 advancement or `EVIDENCE_SUFFICIENT`.** They carry `unlocks_production_ready_claim: false` in their frontmatter. The `/dogfood` audit reads the `scenario:` field and only counts entries that match the anchor slug `claude-code-auto-memory` AND where the manifest status of S1 is `running`. Anything else is informational.

This appendix exists because the absence of any evidence files (the directory contained only `.gitkeep` before 2026-05-31) was itself an honesty risk per `dogfood-golden-rule.md` § Anti-pattern 5 (`no_anchor_evidence` stable identifier). Process-dogfood files surface the process work that DOES happen, without contaminating the anchor-scenario gate.

Files registered to date under `scenario: process-dogfood`:

- `2026-05-31-process-v0-4b-fixes-cycle-validation.md` — validates PR #24 merge + the v0.4b-expansion follow-on cycle.
