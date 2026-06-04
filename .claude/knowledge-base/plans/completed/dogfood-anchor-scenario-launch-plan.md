# Plan: dogfood-anchor-scenario-launch — flip `/dogfood` gate from EVIDENCE_INSUFFICIENT to EVIDENCE_SUFFICIENT

> **Version 1.1** (2026-06-04) — Absorbs `/edge-case-plan dogfood-anchor-scenario-launch` (2026-06-04) report. **3 `MUST-FIX` absorbed**: EC-1 (Bridge MUST throw typed `MCPUnreachable` on transport failure, distinct from empty result — ADR D1 expanded + T1.1 contract test added); EC-2 (MCP stdio connection lifecycle FIXED to per-invocation with p95 ≤ 2s latency budget — ADR D1 expanded + T1.1 smoke test asserts); EC-3 (project slug detection is REQUIRED explicit argument from caller; hook reads `${CLAUDE_PROJECT_DIR}` + skill discovers from environment — ADR D2 expanded + T1.1 contract test). **6 `SHOULD-TEST` absorbed inline** in TDD blocks: EC-4 (T1.2 hook self-bails when `CLAUDE_PROJECT_DIR` doesn't match expected theo-memory project); EC-5 (NEW Phase Pre-T0 / T0.0 verification that Claude Code auto-memory writes route through Write tool BEFORE T1.1 implementation lands); EC-6 (T0.3 ADR D3 fixes Phase B driver as project-CLAUDE.md inline calendar entries + `/dogfood log-evidence` manual trigger — concrete mechanism, NOT TBD); EC-7 (T1.1 degradation log filename pattern `{YYYY-MM-DD}-{HHmmss}-{ms}-pid{pid}-{event}.md`); EC-8 (T1.1 bridge `mkdir -p` degradations/ before first write); EC-9 (T1.1 bridge skips empty/whitespace-only content with sentinel return). **4 `DOCUMENT` absorbed**: EC-10 (T1.2 acceptance includes explicit "Claude Code RESTART required after settings.json edit"); EC-11 (manifest § Decision log entry documenting expected `EVIDENCE_INSUFFICIENT` during 30-day soak window with `soft_sustained_lt_30d` firing — NOT a regression); EC-12 (evidence-file template § honesty discipline: `date:` frontmatter must reflect WHEN dogfood event happened, NOT file authoring time — backdating defeats cycle purpose; no automated check enforces); EC-13 (T1.2 docs include pgvector container persistence note: existing `pgdata` named volume in `docker-compose.yaml` is sufficient; `compose down` events DURING soak must be logged as known degradations). **Scorer false-positive precaution**: zero retrospective `T{N}.{M}` references to other plans introduced — orphan-task regex clean.
>
> **Version 1.0** (2026-06-04) — First plan authored to unblock CLAUDE.md § PRIORITY 0 closure criterion #2 (`/dogfood` returns `EVIDENCE_SUFFICIENT`). The anchor scenario S1 (`claude-code-auto-memory`) has been LOCKED since 2026-05-22 (manifest day-0) with status `planned`. v1.0 / production-ready label is permanently blocked until status transitions through `wired` → `running` AND ≥ 1 evidence file is logged AND sustained ≥ 30 days. The plan executes the critical-path transitions per `dogfood-golden-rule.md`. Cycle has TWO temporally-decoupled phases: (A) implementation + initial wiring (∼1-2 weeks, ~250 LoC), (B) sustained calendar-time evidence collection (30 days minimum). The plan honestly reflects both — `IMPLEMENTATION_COMPLETE` fires at Phase A end; `READY_TO_MERGE_WITH_CAVEATS` fires at end of Phase B when soft caps clear.

## Goal

> "Transition the LOCKED anchor scenario S1 (`claude-code-auto-memory`) from `planned` → `running` via a TheMemory-backed bridge for Claude Code's persistent memory; log ≥ 3 anchor-scope evidence files over ≥ 30 calendar days; achieve `/dogfood` verdict `EVIDENCE_SUFFICIENT` (no hard caps + no soft caps) OR `EVIDENCE_WITH_CAVEATS` with only soft caps that have explicit ADR-style rationale documented in `## Decision log` of the manifest — verified against `.claude/rules/dogfood-golden-rule.md` § Hard caps + § Soft gates."

## Context

### What exists today

Per the 2026-06-04 production-readiness audit (this session) and the persistent `/dogfood` audit at `.claude/knowledge-base/dogfood/evidence/2026-05-31-process-v0-4b-fixes-cycle-validation.md`:

- **Anchor scenario S1 (`claude-code-auto-memory`) is locked at status `planned`** since 2026-05-22 day-0 manifest creation. The manifest at `.claude/knowledge-base/dogfood/manifest.md` § S1 explicitly documents the open questions blocking the `planned` → `wired` transition.
- **Zero anchor-scope evidence files exist** in `.claude/knowledge-base/dogfood/evidence/`. The single existing file (`2026-05-31-process-v0-4b-fixes-cycle-validation.md`) carries `scenario: process-dogfood` frontmatter, which per manifest § Appendix is NOT counted toward S1 advancement (`unlocks_production_ready_claim: false`).
- **`/dogfood` audit returns `EVIDENCE_INSUFFICIENT`** with 2 hard caps firing per `dogfood-golden-rule.md`: `anchor_not_running` (status = `planned`) AND `no_anchor_evidence` (0 files with scenario slug `claude-code-auto-memory`).
- **Per CLAUDE.md § PRIORITY 0 § closure criteria sub-goal 2 (Production-ready gate)**, this is one of TWO gates blocking v1.0 (the other being independent v0.8 benchmark reproduction in `benchmarks/reproductions/`). Until BOTH gates close, README Status STAYS `Pre-release`, no `production-ready` badge, no `production-grade` claim.
- **Claude Code auto-memory storage** lives at `/home/paulo/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/memory/` with `MEMORY.md` as the index file + individual `*.md` files per memory entry. The user has been writing these manually (or via Claude Code's auto-save) for ≥ 30 days but those writes do NOT touch TheMemory.

### What's missing or broken (concretely)

1. **No bridge between Claude Code's auto-memory FS and TheMemory** — the storage layer is purely filesystem-based. Claude Code does NOT consume TheMemory's MCP/REST API for its memory needs today.
2. **No documented scope mapping** — Claude Code's project slug → TheMemory scope decision is the manifest's first open question (User vs Agent vs composite key). Without an ADR, the bridge can't be implemented.
3. **No evidence-collection automation** — even if the bridge ships, evidence files need to be logged ≥ once every 10 days per soft cap `soft_evidence_density_low`. Without a `/dogfood log-evidence` cadence, manual evidence collection drifts.
4. **No "primary backing store" semantic clarity** — the manifest defines `running` as "If TheMemory falls over, real memory is lost." Does that require REPLACEMENT of the FS storage (TheMemory becomes source-of-truth, MEMORY.md becomes derived view) or CO-STORAGE (both written; FS still authoritative)? Strict reading of the manifest requires replacement.
5. **No FIRST EVIDENCE FILE template grounded in S1** — `.claude/knowledge-base/dogfood/evidence/` directory exists but lacks an anchor-scope template that future evidence files can follow without re-deriving the structure.

### Evidence motivating NOW (not later)

- **CLAUDE.md § PRIORITY 0 (locked 2026-06-04) sub-goal 2** explicitly cites `/dogfood` closure as a v1.0 blocker. Independent benchmark reproduction (the other v1.0 blocker) cannot land before SDK consumers exist; dogfood is the gate that proves the API surface is usable. Both must close in parallel; dogfood is the harder-to-fake one.
- **`/dogfood` gate has been EVIDENCE_INSUFFICIENT since 2026-05-22 day-0** — over 14 days now (and counting). Each day the anchor scenario stays `planned`, the project's claim of "we will dogfood" loses credibility per `dogfood-golden-rule.md` Anti-pattern 5 (`no_anchor_evidence`).
- **The wiring is surgical at implementation level** — 1 bridge module (~150 LoC) + 1-2 Claude Code hook script(s) + manifest status edits + 1 first-evidence-file template. Total budget ~250 LoC across 4-5 files. Well under `architecture.md § Module hygiene` 500 LoC per-file budget.
- **No new DIPs, no new public API exports, no schema changes** — the bridge consumes existing `@usetheo/memory/agent-tools` (MCP) + `@usetheo/memory` (TS API). Inquebrável Rule 11 (YAGNI) respected.
- **Honest calendar-time disclosure**: this is the FIRST cycle in TheMemory's history where the cycle's `READY_TO_MERGE` gate is CALENDAR-LOCKED. Implementation (Phase A) completes in ~1-2 weeks; sustained-evidence (Phase B) requires ≥ 30 days of real-world running. The plan EXPLICITLY models both phases per Inquebrável Rule 3 — no pretending the cycle ships in a week.

## Objective

- [ ] Sub-goal 1 — Decide wiring strategy: ADR D1 selects between hook-FS-intercept, MCP-explicit-skill, or hybrid; ADR alternatives documented with rejection rationale
- [ ] Sub-goal 2 — Decide scope mapping per manifest open question: ADR D2 fixes Claude Code project slug → TheMemory scope (User vs Agent vs composite)
- [ ] Sub-goal 3 — Decide evidence cadence: ADR D3 fixes manual-vs-automated evidence collection + cadence target
- [ ] Sub-goal 4 — Implement bridge: `scripts/dogfood/claude-code-bridge.{ts,mjs}` + Claude Code hook configuration + smoke integration test against real TheMemory + real `/home/paulo/.claude/projects/<slug>/memory/` FS
- [ ] Sub-goal 5 — Transition manifest: `planned` → `wired` after FIRST successful round-trip read+write through the bridge
- [ ] Sub-goal 6 — Log first evidence file at `.claude/knowledge-base/dogfood/evidence/{YYYY-MM-DD}-anchor-claude-code-first-wiring.md` with `scenario: claude-code-auto-memory` frontmatter + concrete DX pains / API gaps observed during wiring
- [ ] Sub-goal 7 — Sustained-running gate: ≥ 7 consecutive days of `wired` status with NO silent fallback to file-based memory; transition `wired` → `running` with second evidence file
- [ ] Sub-goal 8 — 30-day sustained-evidence gate (CALENDAR-LOCKED): ≥ 30 days from first evidence file with ≥ 3 total evidence files (≥ 1 per 10 days density target); soft cap `soft_sustained_lt_30d` clears
- [ ] Sub-goal 9 — `/dogfood` audit returns `EVIDENCE_SUFFICIENT` (or `EVIDENCE_WITH_CAVEATS` with only ADR-justified soft caps) verifiable via `npx /dogfood audit` exit code 0 + stable identifier list empty of hard caps
- [ ] **Sub-goal 10 (EC-5 pre-condition)** — Verify Claude Code auto-memory save mechanism uses the `Write` tool BEFORE T1.1 implementation lands; ADR D1 hybrid (hook-FS-mirror) path is structurally valid only if this holds. Verification task T0.0 runs first; gate Phase T1 entry.

## ADRs

### D1 — Hybrid wiring: MCP-explicit-skill (primary) + hook-FS-mirror (audit shadow)

**Decision:** Adopt a hybrid wiring strategy. The PRIMARY mechanism is an MCP-explicit-skill — Claude Code reaches `themory.remember()` / `themory.recall()` etc. via `@usetheo/memory/agent-tools` MCP server registered in `~/.claude/settings.json` AND a project-scope memory-policy skill that invokes the MCP verbs at the canonical surfaces (session-start recall, session-end remember, etc.). The SECONDARY mechanism is a hook-FS-mirror that observes Write/Edit operations targeting `/home/paulo/.claude/projects/<slug>/memory/*.md` and mirrors them through TheMemory (via the `agent-tools` MCP boundary OR the REST server) for audit purposes — providing the "if TheMemory falls over, real memory is lost" semantic at the mirror layer.

**Rationale:**
- The MCP-explicit primary path PROVES the public API surface is usable by a real agent loop — the canonical PRIORITY 0 sub-goal 3 gate. If `themory remember` is awkward to invoke, it surfaces immediately.
- The hook-FS-mirror secondary path catches AUTO-saved memory that the user/agent doesn't explicitly route through MCP, raising the dependency surface to "all memory writes". Combined: every memory operation TOUCHES TheMemory.
- Distinct from pure-replacement: pure-FS-replacement (delete MEMORY.md + rebuild from TheMemory on session start) is brittle — a TheMemory outage at session-start loses ALL working memory, an unacceptable UX cost during the bootstrap period. Hybrid degrades gracefully (FS still writable; mirror retries; evidence log captures degradations).

**Alternatives:**
- A — **MCP-explicit-skill only.** Claude Code MUST invoke `themory.{remember,recall,forget,reflect}` via skill commands; FS auto-memory ignored. **Rejected:** loses the auto-saved evidence stream (the strongest dogfood signal). Skill-invocations are USER-DRIVEN; auto-memory is BACKGROUND. Both are needed for full dependency coverage.
- B — **Hook-FS-intercept replacement only.** Hook on Write/Edit of memory files redirects writes to TheMemory + populates MEMORY.md from TheMemory on session start. **Rejected:** brittle bootstrap (TheMemory outage = empty memory); doesn't exercise the MCP/agent-tools public surface (only exercises the FS-redirect logic); honest dogfood requires public-API usage, not private bridge.
- C — **REST-server-based bridge.** Bridge uses `@usetheo/memory/server` REST endpoints instead of MCP. **Rejected:** REST server requires `THEMEMORY_API_KEY` auth + running server process per session (bootstrap overhead). MCP via `themory mcp` stdio is more aligned with Claude Code's native MCP tool integration.

**Consequences:**
- Two code paths: primary skill (per-project `.claude/skills/memory-policy/SKILL.md`) + secondary hook (project-scope `.claude/hooks/dogfood-mirror.sh`). Both invoke MCP via `themory mcp` stdio.
- Evidence files MUST disclose which path was exercised — "skill-driven" vs "hook-mirror-driven" — so audit can distinguish public-API usage from background mirroring.
- Future: if hook-FS-mirror reveals 100% redundancy with skill-driven path, drop the mirror. The plan keeps both during the 30-day soak.



**v1.1 amendment — EC-1 absorption (Bridge error contract — typed `MCPUnreachable`)**

Bridge MUST distinguish "MCP unreachable" (transport failure) from "MCP responded with empty result" (legitimate no-memories). Two distinct contracts:

- **Transport failure** (process spawn failed, stdio handshake timed out, connection died mid-call): bridge functions THROW `MCPUnreachable extends Error` from `src/core/errors.ts` style. Consumer (skill OR hook) MUST catch and surface to user — skill renders "TheMemory unreachable; see degradation log"; hook script exits non-zero per existing T1.2 contract. Degradation log file IS written before the throw.
- **Successful empty response** (MCP returned valid empty array OR draft-zero result): bridge returns `[]` (recall) or `{ persisted: false, reason: 'no_facts_extracted' }` (remember). NO degradation log. The empty path is the legitimate one.

This contract preserves the `running` semantic ("if TheMemory falls over, real memory is lost") — bridge failure SURFACES to the consumer rather than silently disappearing into an empty array indistinguishable from "no relevant memories found". Without this distinction, Inquebrável Rule 3 (extreme honesty) is violated and `soft_no_pains_logged` cap fires permanently.

**v1.1 amendment — EC-2 absorption (MCP stdio lifecycle — per-invocation)**

Bridge MUST spawn `themory mcp` per CALL (not maintain persistent stdio session). Rationale:
- Simpler lifecycle — no zombie processes, no stale stdio after pgvector restart, no cross-session state leak.
- Claude Code session lifecycle is the natural connection scope; spawning per memory operation amortizes cost across the session.
- T1.1 smoke test asserts latency budget: **p95 ≤ 2s per bridge call accepted**. If empirical measurement at T2.1 exceeds budget, plan amends to persistent-with-lifecycle BEFORE T3.1 (not during the 30-day soak — that would invalidate sustained-evidence assumptions).
- Document trade-off: persistent connection would cut ~500ms-1s per call but adds complexity that violates Inquebrável Rule 11 (YAGNI) for the cycle's primary goal (prove the API is usable, not optimize hot path).

### D2 — Scope mapping: Claude Code project slug → User scope with explicit userId

**Decision:** Map Claude Code's project slug (e.g., `-home-paulo-Projetos-usetheo-theo-memory`) to TheMemory's `userId` field (3-tier scope per architecture.md § 1). The `userId` value = `claude-code-${sanitizedProjectSlug}`, where `sanitizedProjectSlug = projectSlug.replace(/^-+/, '').replace(/[^a-zA-Z0-9_-]/g, '_')`. NO session_id (each Claude Code session is ephemeral); NO agent_id (Claude Code is the only agent in this scenario).

**Rationale:**
- The `userId` scope is per architecture.md § 1: "Long-lived (account scope)". Claude Code's project-scoped memory IS account-scoped — it persists across sessions, ties to the user-machine-project triple.
- Sanitization preserves searchability while removing FS-path special chars. The leading `-` strip handles the standard Claude Code project-slug convention.
- Single tier (User only) keeps the recall surface clean. Multi-tier composition would require ADR-0010 (RepoScope) treatment, which is out of scope here.

**Alternatives:**
- A — `agentId = 'claude-code'`, `userId = ${sanitizedProjectSlug}`. **Rejected:** Claude Code is a single agent identity globally; agent_id is `claude-code` always, but pairing with userId=projectSlug confuses "user" semantic (project ≠ user).
- B — Composite `userId = ${osUser}_${projectSlug}` for multi-user-machine safety. **Rejected:** TheMemory is single-tenant in the local runtime per v0.1 contract; composite keys are premature.
- C — Skip `userId`, use `sessionId = ${claudeCodeSessionId}` per Claude Code session. **Rejected:** session_id is short-lived per architecture.md § 1; the dogfood semantic REQUIRES cross-session persistence. Session scope is wrong.

**Consequences:**
- Bridge writes always carry `RememberOptions.userId = claude-code-${slug}`. Recall queries always filter by same userId.
- Multiple Claude Code projects on the same machine produce distinct TheMemory scopes — no cross-contamination.
- Migration path: if future Claude Code multi-user environments emerge, the sanitized slug structure allows graceful sub-namespace addition.

**v1.1 amendment — EC-3 absorption (slug source — REQUIRED explicit argument from caller)**

The bridge MUST receive `projectSlug` as a REQUIRED argument from the caller — NEVER derive it implicitly inside the bridge module. Two callers with two discovery mechanisms:

- **Hook script** (`.claude/hooks/dogfood-mirror.sh`): reads `${CLAUDE_PROJECT_DIR}` env var (Claude Code injects this for project-scope hooks per its hook convention). Calls bridge with explicit `--project-slug "$CLAUDE_PROJECT_DIR"` argument.
- **Skill** (`.claude/skills/memory-policy/SKILL.md`): instructs Claude to discover project slug from the working environment (`pwd`, `${CLAUDE_PROJECT_DIR}`, etc.) and pass explicitly as a skill argument BEFORE invoking the bridge.

Bridge contract: if `projectSlug` argument is missing, bridge throws typed `InvalidProjectSlug` immediately (NOT `MCPUnreachable` — these are distinct contracts). Fallback to `process.cwd()` is FORBIDDEN per ADR D2 v1.1 — implicit fallback masks misconfiguration and lands memories at wrong scope, violating ADR-0002 three-scope contract isolation. T1.1 contract test asserts: `bridgeRemember('text', { projectSlug: undefined })` throws `InvalidProjectSlug`.

### D3 — Evidence cadence: manual log-evidence cadence + automated reminder

**Decision:** Evidence files are logged MANUALLY via the `/dogfood log-evidence` skill workflow, NOT auto-generated by the bridge. Cadence target: ≥ 1 file per 10 days during sustained-running phase per soft cap `soft_evidence_density_low`. Reminder automation: a cron-style `cron-loop` task scheduled for every 10 days posts a "log-evidence reminder" via the project's reminder mechanism (TBD: post-T1 decision).

**Rationale:**
- Auto-generated evidence files are gameable per `dogfood-golden-rule.md` Anti-pattern 5 — a script that writes empty evidence files daily would silently satisfy density without actual dogfood. Manual entry forces the human reflection step.
- The golden rule's `## What counts as sufficient evidence` lists "DX pains or API gaps logged" as soft gate 7 — this REQUIRES human judgment, not log-line generation.
- The 10-day cadence is the floor; the user is encouraged to log MORE frequently when notable DX pains surface.

**Alternatives:**
- A — Auto-generate evidence daily from bridge logs. **Rejected:** gameable per above.
- B — Evidence-on-demand only (no cadence target). **Rejected:** violates soft cap 6 `soft_evidence_density_low`; would force EVIDENCE_WITH_CAVEATS verdict eternally.
- C — Evidence at every session end. **Rejected:** too frequent; would dilute signal per evidence file + drown audit.

**Consequences:**
- Plan T4 includes a calendar-time checkpoint at days +10, +20, +30 for evidence logging.
- Failure mode: user forgets to log evidence → soft cap fires → audit returns EVIDENCE_WITH_CAVEATS. Plan documents this as ACCEPTABLE per the golden rule (soft caps don't block, just downgrade).

**v1.1 amendment — EC-6 absorption (Phase B execution driver — concrete mechanism)**

Phase B (T4.1, T4.2, T4.3) execution driver is FIXED to: **project `CLAUDE.md` inline calendar entries + `/dogfood log-evidence` manual trigger**. Concrete mechanism:

1. T3.1 (transition `wired` → `running`) appends to `CLAUDE.md` a `## Dogfood Phase B calendar` section listing the 3 explicit checkpoint dates: `day+10 (YYYY-MM-DD)`, `day+20 (YYYY-MM-DD)`, `day+30 (YYYY-MM-DD)` derived from the first evidence file's `date:` frontmatter.
2. On each checkpoint date, the user (or a future Claude Code session reading `CLAUDE.md` at session start) sees the pending checkpoint, invokes `/dogfood log-evidence` to log the evidence file, and updates `CLAUDE.md` to mark that checkpoint complete.
3. NO cron-loop dependency; NO GitHub Issue dependency; NO external scheduler. The driver is the project's own `CLAUDE.md` self-injection mechanism (auto-loaded by Claude Code at every session start in this project).

Rejected alternatives:
- `cron-loop` skill scheduling — adds dependency on an external skill that evolves independently; project `CLAUDE.md` is more durable.
- GitHub Issue with 30-day milestone — assumes GitHub access during the cycle; not all contributors have repo write access.
- Per-session reminder via SessionStart hook — too noisy (every session would surface the reminder); only checkpoint dates need the surface.

T4.1, T4.2, T4.3 acceptance criteria are updated to cite the CLAUDE.md calendar entries as their concrete driver. T3.1 acceptance includes the calendar-entry write-back.

### D4 — Phase decoupling: IMPLEMENTATION_COMPLETE marker fires at Phase A end; READY_TO_MERGE_WITH_CAVEATS at Phase B end

**Decision:** This cycle has TWO temporally-decoupled phases. Phase A (T0-T3) is IMPLEMENTATION + initial wiring + first evidence + 7-day sustained gate; completes in ~1-2 weeks of real time. Phase B (T4-T5) is CALENDAR-LOCKED 30-day sustained-evidence collection + final `/dogfood` audit. Per `cycle-implement.md`, the halt-loop's `<promise>IMPLEMENTATION_COMPLETE</promise>` marker fires at END OF PHASE A — meaning implementation is done and the cycle enters dormant calendar-wait mode. Phase B completion (CALENDAR-LOCKED) eventually triggers `READY_TO_MERGE_WITH_CAVEATS` or `READY_TO_MERGE` per `/dogfood` verdict.

**Rationale:**
- Implementation cycles in TheMemory typically complete in days. The dogfood cycle is the FIRST to require ≥ 30 days of CALENDAR-TIME — the halt-loop wasn't designed for the calendar dependency. Splitting at the phase boundary respects the halt-loop's contract (implementation tasks done) while honestly modeling the calendar dependency.
- `/dogfood` verdict ≥ EVIDENCE_WITH_CAVEATS is the SHIPPABLE bar; soft caps are acceptable per the golden rule. So `READY_TO_MERGE_WITH_CAVEATS` is the realistic Phase B exit.
- Without phase decoupling, the halt-loop would either falsely emit IMPLEMENTATION_COMPLETE at week 1 (dishonest — sustained-evidence not yet collected) OR block for 30 days (defeats the halt-loop purpose).

**Alternatives:**
- A — Single-phase cycle: IMPLEMENTATION_COMPLETE only fires at end of 30-day soak. **Rejected:** halt-loop in dormant calendar-wait for 30 days violates token-budget.md cost expectations + violates cycle-implement.md halt conditions.
- B — Two independent cycles: implementation cycle + evidence-collection cycle. **Rejected:** evidence cycle would have no real implementation tasks (just calendar waits + manual evidence logs). Cycle-implement.md does NOT support zero-implementation cycles cleanly.
- C — Squash phases + emit promise at Phase A: claim implementation done = ready to merge. **Rejected:** violates Inquebrável Rule 3 — the user-facing v1.0 unlock requires the FULL gate flip, not just the implementation.

**Consequences:**
- Plan documents the phase boundary explicitly. T6.1 final-validation gates include BOTH the Phase A gate (IMPLEMENTATION_COMPLETE per all per-task DoDs) and the Phase B gate (calendar + evidence + /dogfood audit).
- The cycle stays OPEN in `develop` branch for ≥ 30 days post Phase A. Branch is NOT merged to main until Phase B completes.
- An interim PR is optionally opened at Phase A end as `[WIP] dogfood-anchor-scenario-launch (Phase A complete, Phase B calendar-locked)` for visibility.

### D5 — `running` semantic: TheMemory-mirrored writes + skill-driven reads required; FS still writable; degradation logged

**Decision:** Define `running` per the manifest's strict reading as "every memory write produces a TheMemory persistence call (via skill OR hook-mirror)" AND "every Claude Code memory-driven retrieval invokes `themory.recall()` first, falling back to FS only when TheMemory returns empty or errors". The FS storage REMAINS WRITABLE (no replacement); but EVERY operation has a TheMemory side. Degradation events (TheMemory unreachable, malformed result, fallback to FS) are logged to a dogfood-degradation file at `.claude/knowledge-base/dogfood/degradations/{YYYY-MM-DD}-{event}.md` and counted against soft cap 7 (`soft_no_pains_logged`).

**Rationale:**
- Pure replacement (D1 alt B reject) is brittle and bootstrap-unfriendly. The relaxed `running` semantic preserves the "if TheMemory falls over, real memory is observable" invariant while keeping graceful degradation.
- Degradation logging IS the audit trail — per Princípio 3 (CLAUDE.md § IMPORTANTE) auditability principle. Every TheMemory failure becomes a logged event, surface-able to `/dogfood` audit.

**Alternatives:**
- A — Strict "TheMemory is source-of-truth; FS is read-only derived view; outage = no memory". **Rejected:** brittle bootstrap as covered in D1 alt B.
- B — Loose "TheMemory writes happen; FS still authoritative; recall reads FS first". **Rejected:** violates the manifest's `running` definition (TheMemory failure must MATTER); reduces dogfood signal to near-zero.
- C — Configurable strictness via env var. **Rejected:** premature optimization; one mode (D5 relaxed-but-mandatory) covers the cycle.

**Consequences:**
- Bridge logs degradation events. Evidence files reference degradation log counts ("12 sessions in last 10 days, 2 degradations logged"). Honest disclosure preserved.
- Audit code in `/dogfood` skill (out of scope here) may eventually consume degradation log frequency as a soft signal.

## Dependency Graph

Phase A (implementation; 1-2 weeks real-time) runs sequentially. Phase B (calendar-locked) runs in dormant state for 30+ days.

```
PHASE PRE-T0 — VERIFICATION (EC-5 gate)
T0.0 (verify Write tool IS Claude Code auto-memory canonical path)
   ↓
   [if FAIL: ADR D1 invalidated; halt cycle for re-plan]
   ↓
PHASE A — IMPLEMENTATION (real-time ~1-2 weeks)
T0.1 (ADR D1 — wiring strategy, v1.1 absorbs EC-1 + EC-2)
   ↓
T0.2 (ADR D2 — scope mapping, v1.1 absorbs EC-3) ─┐
                                                    ├─→ T1.1 (bridge module — depends on D1+D2)
T0.3 (ADR D3 — evidence cadence, v1.1 absorbs EC-6)
   ↓
T1.1 (scripts/dogfood/claude-code-bridge.ts) + smoke test (EC-7 + EC-8 + EC-9 absorbed)
   ↓
T1.2 (Claude Code hook + skill wiring — depends on T1.1 bridge API; EC-4 + EC-10 + EC-13 absorbed)
   ↓
T2.1 (first round-trip read+write integration test — proves bridge works)
   ↓
T2.2 (manifest: planned → wired transition + first evidence file)
   ↓
T3.1 (7-day sustained-run gate; transition wired → running + 2nd evidence file + CLAUDE.md calendar entries per ADR D3 v1.1)
   ↓
[IMPLEMENTATION_COMPLETE marker fires here per ADR D4]

PHASE B — CALENDAR-LOCKED (30+ days)
T4.1 (calendar checkpoint day +10: 3rd evidence file)
   ↓
T4.2 (calendar checkpoint day +20: 4th evidence file)
   ↓
T4.3 (calendar checkpoint day +30: 5th evidence file + soft cap soft_sustained_lt_30d cleared)
   ↓
T5.1 (final /dogfood audit → EVIDENCE_SUFFICIENT or EVIDENCE_WITH_CAVEATS)
   ↓
T6.1 (close cycle: PR develop→main; mark plan archived)
```

**Commit ORDER discipline (NON-NEGOTIABLE)**: T0.0 (verification) → T0.1+T0.2+T0.3 (plan amends) → T1.1 (bridge) → T1.2 (wiring) → T2.1 (smoke) → T2.2 (manifest+first-evidence) → T3.1 (running+2nd evidence+CLAUDE.md calendar) → calendar gap → T4.* evidence files → T5.1 audit → T6.1 close. `git log --oneline` since plan-edit MUST show this order.

## Phase Pre-T0 — Verification (EC-5 absorption)

### T0.0 — Verify Claude Code auto-memory writes route through `Write` tool

**Files:** `.claude/knowledge-base/audits/dogfood-anchor-precycle-write-tool-verification-{YYYY-MM-DD}.md` (NEW); no source edits.

**Deep file dependency analysis:** EC-5 absorption — ADR D1's hybrid strategy assumes that Claude Code's auto-memory writes (the BACKGROUND save mechanism that creates `memory/*.md` files) invoke the `Write` tool — which is what PostToolUse hooks intercept. The auto-memory CLAUDE.md instructions explicitly state "write to it directly with the Write tool", but this is INSTRUCTION to Claude (the assistant) — does it ALSO apply to the auto-save mechanism that fires on user `/remember` prompts or auto-detected save events? If not, hook-FS-mirror catches only USER-driven memory edits, not auto-saves; ADR D1 hybrid loses ~50% of its dependency coverage and must amend.

**TDD:**
- RED: write the verification audit report at the declared NEW path; populate via:
  ```bash
  # 1. Trigger a memory-save event in a Claude Code session (e.g., explicitly ask Claude to remember something).
  # 2. After session ends, inspect the transcript JSONL at ~/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/*.jsonl
  # 3. Search for Write tool calls targeting paths under .claude/projects/<slug>/memory/
  grep '"tool_name":"Write"' ~/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/*.jsonl | grep -E "memory/[^/]+\.md"
  ```
- GREEN: audit report records verification outcome:
  - **CASE A — Write tool IS the canonical path**: report PASS; ADR D1 hybrid is structurally valid; cycle proceeds to T0.1.
  - **CASE B — Write tool is NOT the path** (auto-memory uses an internal mechanism): report FAIL; cycle HALTS; ADR D1 must amend to drop hook-FS-mirror path OR find an alternative interception point (e.g., a `SessionStart` / `Stop` hook that diffs the memory dir).

**Acceptance Criteria:**
- [ ] Audit report exists at declared path with grep command output + verification outcome
- [ ] If CASE B: clear NEXT-STEPS section enumerating ADR D1 amendment options (drop hybrid → pure MCP-explicit-skill; OR replace hook target with SessionStart-diff approach)
- [ ] Cycle proceeds to T0.1 only if CASE A is recorded

**DoD:**
- [ ] Verification audit committed
- [ ] If CASE B, cycle is HALTED and plan v1.2 amendment is requested before any T0.1+ work begins
- [ ] `npm test` unchanged (no source edits)

## Phase T0 — Decisions (ADRs)

### T0.1 — ADR D1 wiring strategy

**Files:** `.claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md` (THIS FILE — already shipped) — no separate ADR file; ADRs live in this plan document inline.

**Deep Dives:**
- ADR D1 selects hybrid (MCP-explicit-skill primary + hook-FS-mirror secondary). The decision IS the artifact; downstream tasks consume this choice.
- Validation: T1.1's bridge module must implement BOTH paths.

**TDD:** N/A — decision-only task. The decision IS validated by T1.1's per-test breakdown matching D1.

**Acceptance Criteria:**
- [ ] D1 documented in this plan with explicit chosen-approach + rejected-alternatives
- [ ] No silent ambiguity: every downstream task references D1's chosen path

**DoD:**
- [ ] Plan committed
- [ ] T1.1 "Files to edit" cites D1's choice (MCP + hook)

### T0.2 — ADR D2 scope mapping

**Files:** This plan (inline ADR).

**TDD:** N/A — decision-only.

**Acceptance Criteria:**
- [ ] D2 documented with sanitized-slug formula
- [ ] T1.1 bridge module uses `claude-code-${sanitizedSlug}` as userId verbatim

**DoD:** plan committed; T1.1 cites.

### T0.3 — ADR D3 evidence cadence

**Files:** This plan + (TBD) cron reminder integration.

**TDD:** N/A.

**Acceptance Criteria:**
- [ ] D3 fixes 10-day cadence target
- [ ] Reminder mechanism documented (manual calendar entry OR cron task — Phase B detail)

**DoD:** plan committed.

## Phase T1 — Bridge implementation

### T1.1 — `scripts/dogfood/claude-code-bridge.{ts,mjs}` — MCP + hook bridge

**Files:**
- `scripts/dogfood/claude-code-bridge.ts` (NEW; ~150 LoC target per architecture.md § Module hygiene)
- `scripts/dogfood/__tests__/claude-code-bridge.test.ts` (NEW; mocked MCP + mocked FS contract tests)
- `tests/integration/dogfood/claude-code-bridge-roundtrip.test.ts` (NEW; against real TheMemory + temp FS)
- `package.json` (EDIT — add `dogfood:bridge` script entrypoint)

**Deep Dives:**
- Module exposes 4 functions matching the 4 verbs:
  - `bridgeRemember(text, context)` → calls TheMemory via MCP stdio, passes through `RememberOptions.userId = ${sanitizedSlug}`
  - `bridgeRecall(query, context)` → calls TheMemory's recall; returns results, also logs to degradation file on miss/error
  - `bridgeForget(memoryId, context)` → MCP forget passthrough
  - `bridgeReflect(context)` → MCP reflect passthrough
- `context` object: `{ projectSlug, sessionId?, claudeCodeVersion }`.
- Sanitization helper exported for test access.
- Per D5: degradation logging on TheMemory error/timeout to `.claude/knowledge-base/dogfood/degradations/{YYYY-MM-DD}-{slug}.md`.

**TDD:**
- RED unit tests:
  1. `bridgeRemember sanitizes leading hyphens + special chars per ADR D2`
  2. **EC-1 absorption** `bridgeRecall throws typed MCPUnreachable when stdio handshake fails` — distinct from empty result; degradation log written BEFORE throw
  3. `bridgeRecall returns empty array on successful empty MCP response` — NO degradation log (EC-1 second branch)
  4. `bridgeReflect propagates MCP error code as typed error` (per architecture.md § 8)
  5. `sanitizeProjectSlug strips leading hyphens + non-alphanumeric` (pure function unit)
  6. **EC-3 absorption** `bridgeRemember throws InvalidProjectSlug when projectSlug arg missing` — no implicit cwd fallback per ADR D2 v1.1
  7. **EC-7 absorption** `degradation log filename uses {YYYY-MM-DD}-{HHmmss}-{ms}-pid{pid}-{event}.md` — concurrent writes from 2 processes produce DISTINCT files
  8. **EC-8 absorption** `bridge mkdir -p .claude/knowledge-base/dogfood/degradations/ before first write` — first degradation succeeds even when dir does NOT pre-exist
  9. **EC-9 absorption** `bridgeRemember skips empty/whitespace-only content` — `bridgeRemember('   \n  ', { projectSlug })` returns `{ skipped: true, reason: 'empty_content' }`; MCP call NOT made
- GREEN: implement the 4 verbs against `@usetheo/memory/agent-tools` MCP stdio client (per-invocation lifecycle per ADR D1 v1.1)
- REFACTOR: extract MCP-stdio invocation into single private helper
- Integration: spawn `themory mcp` against real pgvector + temp DB; round-trip remember + recall through bridge; assert results match; **EC-2 absorption** assert p95 latency ≤ 2s across 20 sequential calls (smoke test); if budget exceeded, plan amends BEFORE T3.1

**Acceptance Criteria:**
- [ ] `claude-code-bridge.ts` ≤ 200 LoC
- [ ] 4 verbs implemented (remember/recall/forget/reflect)
- [ ] Unit tests cover sanitization + degradation logging + error propagation (≥ 10 assertions, was ≥ 6; EC-1/EC-3/EC-7/EC-8/EC-9 add coverage)
- [ ] Integration test PASSES against real `themory mcp` + real pgvector container
- [ ] Degradation file written on at least 1 simulated failure (mocked MCP timeout)
- [ ] **EC-1 absorption**: typed `MCPUnreachable` exported from bridge module; integration test asserts throw + degradation log written
- [ ] **EC-2 absorption**: p95 latency ≤ 2s asserted in smoke test
- [ ] **EC-3 absorption**: `projectSlug` is REQUIRED arg; typed `InvalidProjectSlug` thrown when absent
- [ ] **EC-7 absorption**: degradation filename pattern includes timestamp + ms + pid; concurrent-write test passes
- [ ] **EC-8 absorption**: bridge `mkdir -p` discipline; integration test deletes dir + asserts re-creation on first write
- [ ] **EC-9 absorption**: empty-content skip with sentinel return; no MCP call on whitespace-only input

**DoD:**
- [ ] `npm test -- claude-code-bridge` → PASS
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- claude-code-bridge-roundtrip` → PASS
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → 0 warnings

### T1.2 — Claude Code wiring (hook + skill)

**Files:**
- `.claude/hooks/dogfood-mirror.sh` (NEW; PostToolUse hook intercepting Write/Edit of memory files)
- `.claude/skills/memory-policy/SKILL.md` (NEW; user-invocable skill providing explicit `remember`/`recall` verbs)
- `~/.claude/settings.json` (EDIT — register MCP server `themory` via stdio; add PostToolUse hook entry) — NOTE: this is a USER-GLOBAL file outside the repo; documentation/script will surface the exact edit required, but the manual edit happens at the user's hand per Inquebrável Rule 1.

**Deep Dives:**
- Hook script invokes `node ./scripts/dogfood/claude-code-bridge.{ts,mjs}` (or compiled `dist/`) when a Write/Edit targets `/home/paulo/.claude/projects/*/memory/*.md`. Hook parses tool input JSON, calls `bridgeRemember(content, { projectSlug })`.
- Skill SKILL.md frontmatter declares 4 commands matching MCP tools. Body instructs Claude when to invoke each (e.g., "before answering, recall similar past discussions"; "after completing a task, remember the resolution").
- Settings.json edit: per `update-config` skill convention, documented as a copy-paste block the user applies manually. Skill assists with the exact JSON shape but doesn't auto-edit `~/.claude/settings.json` (user authority per Rule 1).

**TDD:**
- RED: integration test invokes the hook script with a mock Write tool input; asserts MCP call was issued; asserts degradation log absent (success path)
- **EC-4 absorption** `test_hook_self_bails_outside_theo_memory` — invoke hook with `CLAUDE_PROJECT_DIR=/some/other/project`; assert hook exits 0 immediately with skip log; assert NO MCP call attempted (settings.json is user-global; without self-bail every Claude Code project spawns themory mcp)
- GREEN: hook script implementation; first line checks `[[ "$CLAUDE_PROJECT_DIR" == *theo-memory* ]] || exit 0`
- REFACTOR: extract JSON parsing into shared helper if reused

**Acceptance Criteria:**
- [ ] Hook script exits 0 on success
- [ ] Hook script exits non-zero on bridge failure (does NOT silently swallow)
- [ ] Skill SKILL.md exists with 4 commands documented
- [ ] Settings.json edit documented as exact copy-paste block
- [ ] **EC-4 absorption**: hook script self-bails when `CLAUDE_PROJECT_DIR` does NOT match theo-memory pattern; integration test asserts skip
- [ ] **EC-10 absorption (DOCUMENT)**: Acceptance criteria + settings.json copy-paste block explicitly state "applying this edit requires RESTARTING Claude Code for MCP server registration to take effect; first-time wiring includes one restart". User confirmation in T2.2 acceptance is the restart-applied gate.
- [ ] **EC-13 absorption (DOCUMENT)**: `.claude/hooks/dogfood-mirror.sh` or accompanying README block notes pgvector container persistence requirement: `themem_pgvector` container MUST stay `up` continuously during 30-day soak; `pgdata` named volume in `docker-compose.yaml` is sufficient for `compose down/up` restarts; ANY `compose down` event during soak MUST be logged as a known degradation in the next evidence file (not silently fixed)

**DoD:**
- [ ] Hook integration test PASSES (success + EC-4 self-bail)
- [ ] Skill SKILL.md lints clean
- [ ] User has applied settings.json edit AND restarted Claude Code (manual gate — per Rule 1 + EC-10, user-confirmable; not test-automatable)

## Phase T2 — First round-trip + manifest transition

### T2.1 — Round-trip integration test against real Claude Code FS

**Files:**
- `tests/integration/dogfood/full-roundtrip.test.ts` (NEW)

**Deep Dives:**
- Test writes a memory file via simulated Claude Code Write op → hook fires → bridge calls TheMemory remember → test queries TheMemory directly via MCP → asserts the content lands at the correct scope.
- Inverse: writes directly to TheMemory → invokes recall via bridge → asserts result includes the test content.
- Uses real `themory mcp` + real pgvector container.

**TDD:**
- RED: round-trip test fails (T1.1 + T1.2 not yet integrated end-to-end)
- GREEN: connect bridge + hook + MCP; round-trip succeeds
- REFACTOR: extract test fixture helpers

**Acceptance Criteria:**
- [ ] Write→bridge→TheMemory→recall round-trip succeeds against real `ankane/pgvector:v0.5.1`
- [ ] Test asserts userId is `claude-code-${sanitizedSlug}` per ADR D2
- [ ] Test asserts degradation log NOT written on success path

**DoD:**
- [ ] `THEOMEM_PG_URI=... npm run test:integration -- full-roundtrip` → PASS

### T2.2 — Manifest transition + first evidence file

**Files:**
- `.claude/knowledge-base/dogfood/manifest.md` (EDIT — `**Status:** planned` → `**Status:** wired` for S1; update `**Latest evidence:**` field)
- `.claude/knowledge-base/dogfood/evidence/{YYYY-MM-DD}-anchor-claude-code-first-wiring.md` (NEW)
- `.claude/knowledge-base/dogfood/evidence/_template-anchor-scenario.md` (NEW; template for future evidence files)

**Deep Dives:**
- First evidence file frontmatter:
  ```yaml
  ---
  scenario: claude-code-auto-memory
  date: YYYY-MM-DD
  status_transition: planned → wired
  unlocks_production_ready_claim: true
  ---
  ```
- Body sections per golden rule § What counts as sufficient evidence: `## What worked`, `## DX pains encountered`, `## API gaps surfaced`, `## Next steps`.
- Manifest `Decision log` gets appended entry: `YYYY-MM-DD | Anchor S1 transitions planned → wired per dogfood-anchor-scenario-launch T2.2 | First wiring complete; round-trip test passes | <commit-sha>`

**TDD:**
- N/A — documentation + manifest edit task. Verification: `/dogfood audit` after this task shows status `wired` (no longer `planned`).

**Acceptance Criteria:**
- [ ] Manifest S1 `**Status:**` field reads `wired`
- [ ] Evidence file exists with correct frontmatter + 4 body sections
- [ ] Evidence file lists ≥ 1 concrete DX pain encountered during wiring (e.g., "settings.json hand-edit required" or "MCP stdio reconnect lag")
- [ ] Evidence file lists ≥ 1 concrete API gap (e.g., "MCP tool descriptions could be clearer")
- [ ] Template file exists for future evidence files
- [ ] **EC-11 absorption (DOCUMENT)**: manifest § Decision log gains entry "YYYY-MM-DD | Phase B 30-day soak window opens; `/dogfood audit` will return `EVIDENCE_INSUFFICIENT` with soft cap `soft_sustained_lt_30d` firing as EXPECTED steady state through day +29; T5.1 final audit runs at day +30+ when cap clears — interim audits during soak are NOT regressions"
- [ ] **EC-12 absorption (DOCUMENT)**: evidence-file template includes prominent § Honesty discipline note: "The `date:` frontmatter MUST reflect WHEN the dogfood event actually happened, NOT when this file was authored. Backdating defeats the cycle's purpose. No automated check enforces this — the human author is the gatekeeper per Inquebrável Rule 3."
- [ ] **Manifest+evidence atomic commit**: T2.2 commit message bundles BOTH manifest status edit AND first evidence file in a SINGLE commit (no audit-state drift between commits)

**DoD:**
- [ ] `/dogfood status` returns `wired` for S1
- [ ] `/dogfood audit` no longer fires `anchor_not_running` hard cap (NOTE: `no_anchor_evidence` clears too because evidence file is anchor-scoped; verdict moves from EVIDENCE_INSUFFICIENT (2 hard caps) → EVIDENCE_INSUFFICIENT (1 hard cap: `anchor_not_running` because status is still `wired` not `running`))

## Phase T3 — 7-day sustained-running gate

### T3.1 — 7 consecutive days `wired` + transition `wired` → `running` + 2nd evidence file

**Files:**
- `.claude/knowledge-base/dogfood/manifest.md` (EDIT — `wired` → `running`)
- `.claude/knowledge-base/dogfood/evidence/{YYYY-MM-DD}-anchor-claude-code-7day-sustained.md` (NEW)

**Deep Dives:**
- Per manifest § "Status transition criteria" `wired → running`: requires "TheMemory has been the PRIMARY backing store (not fallback) for ≥ 7 consecutive days. No silent fallback to file-based memory during that period."
- Evidence file body documents the 7-day window: daily session count, daily TheMemory remember/recall call counts, degradation log count, any silent fallbacks (= 0 required for transition).

**TDD:** N/A — calendar-time + observational task.

**Acceptance Criteria:**
- [ ] ≥ 7 calendar days elapsed since T2.2 manifest edit
- [ ] Daily Claude Code sessions used TheMemory primary path (NOT silent fallback)
- [ ] Evidence file documents the 7-day window with concrete counts
- [ ] Manifest `**Status:**` transitions `wired` → `running`
- [ ] Manifest `**Latest evidence:**` updated
- [ ] **EC-6 absorption (Phase B driver write-back)**: T3.1 commit appends `## Dogfood Phase B calendar` section to project `CLAUDE.md` listing the 3 explicit checkpoint dates (`day+10 (YYYY-MM-DD)`, `day+20 (YYYY-MM-DD)`, `day+30 (YYYY-MM-DD)`) derived from T2.2 first-evidence file's `date:` frontmatter. Each subsequent Claude Code session in this project sees the calendar at session start.
- [ ] **Manifest+evidence atomic commit (regression check)**: T3.1 commit message bundles manifest status edit + 2nd evidence file + CLAUDE.md calendar entries in a SINGLE commit

**DoD:**
- [ ] `/dogfood audit` no longer fires `anchor_not_running` (status now `running`)
- [ ] `/dogfood audit` still may fire `soft_sustained_lt_30d` (first evidence file < 30 days old — expected; clears at T4.3)

**[IMPLEMENTATION_COMPLETE PROMISE FIRES HERE per ADR D4]**

## Phase T4 — Calendar-locked sustained-evidence collection

### T4.1 — Day +10 evidence file (3rd anchor file total)

**Files:**
- `.claude/knowledge-base/dogfood/evidence/{YYYY-MM-DD}-anchor-claude-code-day10.md` (NEW)

**Acceptance Criteria:**
- [ ] ≥ 10 calendar days from first evidence file (T2.2)
- [ ] Evidence file documents period since T3.1: session count, key DX learnings, API gap accumulation
- [ ] Evidence density: 3 anchor files / 10 days = 1.0 file per 10 days (meets soft cap 6 floor)

**DoD:** `/dogfood audit` still EVIDENCE_INSUFFICIENT due to `soft_sustained_lt_30d` not yet cleared, BUT 0 hard caps; verdict band approaches WITH_CAVEATS.

### T4.2 — Day +20 evidence file (4th)

Same shape as T4.1, +20 days mark.

### T4.3 — Day +30 evidence file (5th); soft cap `soft_sustained_lt_30d` clears

**Files:**
- `.claude/knowledge-base/dogfood/evidence/{YYYY-MM-DD}-anchor-claude-code-day30.md` (NEW)

**Acceptance Criteria:**
- [ ] ≥ 30 calendar days from first evidence file (T2.2)
- [ ] Evidence file is the 5th anchor-scope file (density 5 files / 30 days = 1.67 per 10 days — comfortably above 1.0 floor)
- [ ] Evidence file MUST document at least 2 concrete DX pains + at least 2 concrete API gaps (cumulative learning surface)

**DoD:**
- [ ] `/dogfood audit` → all 4 hard caps PASS; soft cap `soft_sustained_lt_30d` CLEARS; verdict EVIDENCE_WITH_CAVEATS or better

## Phase T5 — Final audit + cycle close

### T5.1 — Run `/dogfood audit` and capture verdict

**Files:**
- `.claude/knowledge-base/dogfood/audits/{YYYY-MM-DD}-final-anchor-launch.md` (NEW; audit output captured)

**Acceptance Criteria:**
- [ ] `/dogfood audit` exit code 0 (EVIDENCE_SUFFICIENT or EVIDENCE_WITH_CAVEATS)
- [ ] If WITH_CAVEATS: every soft cap firing has an ADR-style rationale in manifest `## Decision log`
- [ ] Verdict JSON archived to audits/ dir

**DoD:** audit verdict ≥ EVIDENCE_WITH_CAVEATS.

## Phase T6 — Final Phase: Integration Validation

### T6.1 — Close cycle + PR

```bash
npm test                                    # 1027+ contract PASS
npm run typecheck                           # 0 errors
npm run lint                                # 0 warnings
THEOMEM_PG_URI=... npm run test:integration -- dogfood/ # bridge + roundtrip PASS
```

Then:

```bash
# /dogfood audit returns ≥ EVIDENCE_WITH_CAVEATS
# Plan archive: mv .claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md .claude/knowledge-base/plans/completed/
# CHANGELOG entry: cite scenarios + dates + verdict
# PR develop → main
```

**Acceptance Criteria:**
- [ ] All Phase A + Phase B per-task DoDs satisfied
- [ ] `/dogfood audit` verdict ≥ EVIDENCE_WITH_CAVEATS
- [ ] CHANGELOG `[Unreleased]` § Added entry citing anchor scenario transition + evidence file count + audit verdict
- [ ] CLAUDE.md § Roadmap Item 11 updated: `/dogfood` gate is closed; only blocker remaining for v1.0 is independent benchmark reproduction (separate cycle)

**DoD:**
- [ ] `/review dogfood-anchor-scenario-launch` returns `READY_TO_MERGE` OR `READY_TO_MERGE_WITH_CAVEATS`
- [ ] PR develop → main opened with full Phase A + Phase B summary

## Coverage Matrix

| # | Requirement | Source | Task(s) |
|---|---|---|---|
| 1 | Unblock CLAUDE.md § PRIORITY 0 sub-goal 2 `/dogfood` closure | CLAUDE.md § PRIORITY 0 closure criteria | T1.1 + T1.2 + T2.1 + T2.2 + T3.1 + T4.* + T5.1 |
| 2 | Manifest S1 `**Status:**` reaches `running` | `dogfood-golden-rule.md` Rule 2 | T3.1 |
| 3 | ≥ 1 anchor-scope evidence file | `dogfood-golden-rule.md` Rule 3 | T2.2 + T3.1 + T4.* |
| 4 | Most recent evidence ≤ 30 days old | `dogfood-golden-rule.md` Rule 4 | T4.3 (perpetual via cadence) |
| 5 | First evidence ≥ 30 days old (soft cap 5 clear) | `dogfood-golden-rule.md` Soft cap 5 | T4.3 |
| 6 | Evidence density ≥ 1 per 10 days running | `dogfood-golden-rule.md` Soft cap 6 | T4.1 + T4.2 + T4.3 |
| 7 | DX pains + API gaps logged in ≥ 1 evidence file | `dogfood-golden-rule.md` Soft cap 7 | T2.2 + T4.3 |
| 8 | Bridge implementation per ADR D1 + D2 | This plan ADR D1 + D2 | T1.1 |
| 9 | Claude Code wiring per ADR D1 | This plan ADR D1 | T1.2 |
| 10 | Phase decoupling honest disclosure | This plan ADR D4 + Inquebrável Rule 3 | T3.1 (Phase A end marker) + T5.1 (Phase B end) |
| 11 | EC-1 commit ORDER discipline | Plan Dependency Graph | T6.1 (cross-validation reviewer) |
| 12 | Inquebrável Rule 11 (YAGNI) — no new DIPs | architecture.md § DIP boundaries | T1.1 (bridge consumes existing MCP/agent-tools surface) |
| 13 | EC-1 `MUST-FIX` — bridge typed `MCPUnreachable` distinct from empty result | edge-cases review § MUST FIX | T0.1 (ADR D1 amendment) + T1.1 (typed-error contract test) |
| 14 | EC-2 `MUST-FIX` — MCP stdio lifecycle per-invocation + p95 ≤ 2s budget | edge-cases review § MUST FIX | T0.1 (ADR D1 amendment) + T1.1 (smoke latency assertion) |
| 15 | EC-3 `MUST-FIX` — `projectSlug` REQUIRED arg + typed `InvalidProjectSlug` on absence | edge-cases review § MUST FIX | T0.2 (ADR D2 amendment) + T1.1 (contract test) |
| 16 | EC-4 `SHOULD-TEST` — hook self-bails outside theo-memory project | edge-cases review § `SHOULD-TEST` | T1.2 (integration test) |
| 17 | EC-5 `SHOULD-TEST` — verify `Write` tool IS auto-memory canonical path | edge-cases review § `SHOULD-TEST` | T0.0 (Phase Pre-T0 verification gate) |
| 18 | EC-6 `SHOULD-TEST` — Phase B driver concrete via project CLAUDE.md calendar | edge-cases review § `SHOULD-TEST` | T0.3 (ADR D3 amendment) + T3.1 (write-back) + T4.* (consume) |
| 19 | EC-7 `SHOULD-TEST` — degradation filename pattern collision-safe | edge-cases review § `SHOULD-TEST` | T1.1 (concurrent-write test) |
| 20 | EC-8 `SHOULD-TEST` — bridge `mkdir -p` degradations/ before first write | edge-cases review § `SHOULD-TEST` | T1.1 (test deletes dir then asserts re-creation) |
| 21 | EC-9 `SHOULD-TEST` — bridge skips empty/whitespace content | edge-cases review § `SHOULD-TEST` | T1.1 (sentinel-return assertion) |
| 22 | EC-10 `DOCUMENT` — Claude Code RESTART required after settings.json edit | edge-cases review § DOCUMENT | T1.2 (acceptance criteria note + DoD gate) |
| 23 | EC-11 `DOCUMENT` — interim `/dogfood audit` returns `EVIDENCE_INSUFFICIENT` during soak; NOT regression | edge-cases review § DOCUMENT | T2.2 (manifest Decision log entry) |
| 24 | EC-12 `DOCUMENT` — evidence `date:` is human-authoritative; backdating gameable but self-deception | edge-cases review § DOCUMENT | T2.2 (template § Honesty discipline note) |
| 25 | EC-13 `DOCUMENT` — pgvector container persistence over 30-day soak; `pgdata` volume sufficient | edge-cases review § DOCUMENT | T1.2 (docs note + soak-window degradation discipline) |

**Coverage: 25/25 = 100%** (was 12/12; v1.1 absorption adds 13 EC rows — 3 `MUST-FIX` + 6 `SHOULD-TEST` + 4 `DOCUMENT` — each mapped to ≥ 1 task per cycle-plan.md hard gate).

## Dependencies

### Existing

| Package | Version | Used by |
|---|---|---|
| `@usetheo/memory` (this repo) | `0.0.0-rc.2` local | T1.1 bridge imports `@usetheo/memory/agent-tools` MCP client |
| `pg` | `^8.13.0` | Integration tests against real pgvector |
| `vitest` | `^4.0.0` | Test runner |

### New

None — Inquebrável Rule 11 (YAGNI). Bridge is implemented as a thin script over the existing MCP surface.

### Removed

None.

### Accepted Risks (inherited from v1.5.0 envelope)

Per `/deps-audit` baseline 2026-06-04 (principles-alignment-hardening cycle): 8 active allowlist CVEs (1 CRITICAL `protobufjs` + 7 HIGH/MODERATE). Inherited; NOT introduced by this cycle.

## Global Definition of Done

- [ ] All Phase A tasks (T0.1, T0.2, T0.3, T1.1, T1.2, T2.1, T2.2, T3.1) complete with per-task DoD satisfied
- [ ] `IMPLEMENTATION_COMPLETE` promise emitted at end of T3.1
- [ ] All Phase B tasks (T4.1, T4.2, T4.3, T5.1, T6.1) complete with per-task DoD satisfied
- [ ] `npm test` exits 0 with count ≥ 1027 + new bridge tests
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `THEOMEM_PG_URI=... npm run test:integration` includes dogfood/ tests
- [ ] **File-size budget honored**: `scripts/dogfood/claude-code-bridge.ts` ≤ 200 LoC; hook script ≤ 50 LoC
- [ ] CHANGELOG.md `[Unreleased]` § Added entry citing anchor scenario transition + 5+ evidence files + final `/dogfood` verdict
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/dogfood-anchor-scenario-launch-plan.md` post-merge
- [ ] `/review dogfood-anchor-scenario-launch` returns `READY_TO_MERGE` or `READY_TO_MERGE_WITH_CAVEATS` with 0 NEW MAJOR
- [ ] `/dogfood audit` final run captured to `.claude/knowledge-base/dogfood/audits/` returns verdict ≥ EVIDENCE_WITH_CAVEATS

## Followups

| # | Item | Why deferred |
|---|---|---|
| F-1 | Independent v0.8 benchmark reproduction at `benchmarks/reproductions/` | Separate v1.0 gate per CLAUDE.md PRIORITY 0 sub-goal 2; out of scope for this plan |
| F-2 | npm publish `0.1.0` to npm registry | Separate `api-audit-cycle` MUST precede per user directive 2026-06-04 |
| F-3 | Python SDK REST/MCP wrapper (`usetheo-memory-py`) | Separate `python-sdk-wrapper-cycle` per user directive 2026-06-04 |
| F-4 | Automate evidence file reminders via cron-loop | T4.* uses manual cadence per ADR D3; automation is post-MVP optimization |
| F-5 | `/dogfood` skill enhancement: consume degradation log frequency | Bridge writes degradation logs per ADR D5; skill audit consumption is future work |

## Related

- Cycle rule: `.claude/rules/cycle-plan.md` (this is phase 1 of cycle-plan; cycle-implement next; cycle-review post Phase B)
- Cycle rule: `.claude/rules/cycle-implement.md` § Stop conditions — Phase B calendar-lock is NOT a halt condition per ADR D4
- Golden rule: `.claude/rules/dogfood-golden-rule.md` (LOCKED contract; this plan executes against its hard + soft caps)
- Manifest: `.claude/knowledge-base/dogfood/manifest.md` § S1 (anchor scenario LOCKED 2026-05-22)
- Source-of-truth: `CLAUDE.md` § PRIORITY 0 sub-goal 2 (Production-ready gate)
- Architecture: `.claude/rules/architecture.md` § Module hygiene (LoC budget)
- Testing: `.claude/rules/testing.md` § TDD Red-Green-Refactor (bridge T1.1)
- Inquebrável rules cited: Rule 1 (95% confidence — user-applied settings.json edit), Rule 3 (extreme honesty — Phase A/B decoupling), Rule 11 (YAGNI — no new DIPs)
