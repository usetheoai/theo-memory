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
**Status:** `running`
**Locked at:** 2026-05-22
**Status transitioned:** `planned` → `wired` → `running` on 2026-06-04 (see Decision log entries of same date; the `wired` → `running` transition uses the empirical-snapshot path introduced by [ADR-0012](../../knowledge-base/adrs/ADR-0012-dogfood-gate-empirical-snapshot-amendment.md), satisfied by evidence file `2026-06-04-anchor-claude-code-real-providers-wired.md`)
**Required by:** v1.0
**Owner:** project owner (`usetheodev@gmail.com`)
**Latest evidence:** `2026-06-07-anchor-claude-code-post-pr32-relaunch.md` (post PR #32 merge `fca24a7` re-validation — 3 facts extracted from this session into pgvector at `kind=extracted` + recall cosine 0.5126 > 0.5 on query "OAuth token introspection standard claims" with limited lexical overlap + 5 concrete DX pains logged including 0-extraction silent drop + empty history-table on MCP path + cross-language recall degradation + dogfood-anchor data didn't survive cycle-dev schema reset + admin-keys post-fixes-cycle-1 contract change docs gap + configuration reproducible via PR #32 chain). Status `running` continuity maintained across Item 20 + fixes-cycle-1 + /review-fixes release.
**Prior evidence:** `2026-06-04-anchor-claude-code-real-providers-wired.md` (original `wired → running` empirical-snapshot via ADR-0012; cosine 0.657 + 3 DX pains; commits e43d801 / 1319f35 / 45d21f7).
**First evidence:** `2026-06-04-anchor-claude-code-first-wiring.md` (pre-real-provider isolation verification; kept as truth-of-work-done audit trail).

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
| `wired` → `running` (sustained-soak path) | TheMemory has been the PRIMARY backing store (not fallback) for ≥ 7 consecutive days. No silent fallback to file-based memory during that period. Log via `/dogfood log-evidence`. |
| `wired` → `running` (empirical-snapshot path — added by ADR-0012 2026-06-04) | A single evidence file documents end-to-end empirical validation with REAL providers (no stubs in production path), including: (a) write produces concrete pgvector rows with `kind=extracted`, (b) semantic recall returns relevant top-K with cosine score > 0.5 against a query with no lexical overlap with the stored fact, (c) ≥ 3 concrete DX pains logged in the evidence file's `## DX pains encountered` section, (d) configuration is reproducible (commit hash documented + `grep StubLLM dist/agent-tools/run-mcp-server.js` returns 0). |
| `running` → `paused` | Explicit pause, with reason logged in evidence file. Resume by transitioning back to `running`. |
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
| 2026-06-04 | T2.2 attempted `planned` → `wired` based on integration test passing. Plan: `dogfood-anchor-scenario-launch` T2.2. Round-trip integration test PASSES against real `themory mcp` + pgvector via Option C MCP `_meta` scope binding. T2.1 architectural gap closed in commit `95bd168`. T2.2 manifest edit committed in `eb46e66`. | dogfood-anchor-scenario-launch cycle |
| 2026-06-04 | **REVERT of preceding entry**: Status reverted `wired` → `planned`. Honest re-reading of manifest § "Status transition criteria": `planned` → `wired` requires **Claude Code is CONFIGURED** (via env var, settings.json, or adapter) to write/read its auto-memory through TheMemory's API. Integration test verifies code path in ISOLATION, NOT real configuration. Empirical check post-restart: `~/.claude/settings.json` has `mcpServers: {}` + `hooks: {}` — themory MCP server NOT registered + dogfood-mirror hook NOT registered. pgvector `memories` table 0 rows; zero `mcp__themory_*` tool calls in transcripts. Code path WORKS (integration tests PASS); configuration to exercise it in real Claude Code sessions PENDING user action (apply `.claude/dogfood-settings.template.json` to user-global settings + restart). Evidence file `2026-06-04-anchor-claude-code-first-wiring.md` kept as truth-of-work-done; its `status_transition` field amended to reflect honest state. Per Inquebrável Rule 3 (extreme honesty), claiming `wired` without real configuration is a typed lie that would silently degrade `/dogfood` audit trust. | dogfood-anchor-scenario-launch cycle (T2.2 revert) |
| 2026-06-04 | **Status transitioned `planned` → `wired`** (honest, second attempt). Empirical evidence assembled across this session, validated AFTER three Claude Code restarts that progressively corrected configuration: (1) discovered `~/.claude/settings.json` is NOT the path Claude Code reads for `mcpServers` — project-local `.mcp.json` is the canonical mechanism; (2) `.mcp.json` registered with `THEOMEM_MCP_DEFAULT_USER_ID=claude-code-theo-memory` to satisfy the Option C MCP `_meta`/env scope-binding fallback; (3) `run-mcp-server.ts` rewired to drop StubLLM+StubEmbedder and use real `LocalTransformerEmbedder` (Xenova MiniLM, 384-dim, no API key) + `OpenAILLM` via `OPENAI_BASE_URL=https://openrouter.ai/api/v1`; dev schema dropped + `runMigrations({ embeddingDim: 384 })` recreated tables at 384-dim. Empirical proof in this session: `mcp__themory__remember` invocation succeeded; `SELECT FROM memories WHERE user_id='claude-code-theo-memory'` returns 4 facts EXTRACTED BY THE LLM (kind=`extracted`, attributed_to=`user`, confirmation_count=1, 384-dim vector column with HNSW index); `mcp__themory__recall` semantic query returned the relevant fact at top-1 with cosine score 0.657 (semantically correct — no keyword overlap with query). PostToolUse hook `dogfood-mirror.sh` registered in project `.claude/settings.json`. No stubs in production path (`grep StubLLM dist/agent-tools/run-mcp-server.js` returns 0). Configuration files: `.mcp.json` (gitignored — carries temporary OpenRouter key supplied by user), `.mcp.json.example` (committed template). Inquebrável Rule 3 honored: prior false `wired` claim reverted; this entry only fires after the empirical pipeline executed end-to-end with real providers. Evidence file: `2026-06-04-anchor-claude-code-real-providers-wired.md`. Note: this entry stops at `wired` because the original gate required ≥ 7 consecutive days as primary backing store before `running`. The subsequent same-day amendment (ADR-0012, entry below) reframes the gate to recognize the empirical-snapshot path. | dogfood-anchor-scenario-launch cycle (T2.2 retry with real providers) |
| 2026-06-04 | **Status transitioned `wired` → `running`** via the empirical-snapshot path introduced by [ADR-0012](../../adrs/ADR-0012-dogfood-gate-empirical-snapshot-amendment.md). Project owner authorized the amendment in the same session via `AskUserQuestion` response "Option A" (alternatives B "defer calendar-locked tasks" and C "decouple production-ready from v1.0" rejected). The amendment adds empirical-snapshot validation as an alternative to the original sustained-soak path (which REMAINS available); soft caps `soft_sustained_lt_30d` + `soft_evidence_density_low` are DROPPED because they only applied to the sustained-soak measurement; `soft_no_pains_logged` is REINFORCED as the load-bearing honesty signal. Evidence satisfies all 4 empirical-snapshot criteria from the transition table: (a) 4 pgvector rows with `kind=extracted` written this session, (b) cosine score 0.657 on a query with zero lexical overlap with the returned fact, (c) 3 concrete DX pains logged in evidence file's `## DX pains encountered` section (Claude Code MCP config path discovery, scope binding indirection, schema dim coupling), (d) configuration reproducible — commits e43d801 / 1319f35 / 45d21f7 documented; `grep StubLLM dist/agent-tools/run-mcp-server.js` returns 0. The rule's Log of changes table also reflects the amendment. **NOTE:** this transition is the gate clearing for `production-ready` ONLY from the dogfood-evidence side; the parallel requirement (independent benchmark reproduction, Roadmap Item 11) MUST also clear before the `production-ready` label appears in README. | ADR-0012 (project-owner sign-off in this session) |

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
