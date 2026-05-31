# /test-chat-with-memory rerun report — 2026-05-31

**Branch:** `develop`
**Commit at run:** `37a88b4` (T3.1 skill catalog landed)
**Plan:** `examples-chat-with-memory-v0-4b-expansion` v1.2 (SHIPPABLE 94.8)
**Catalog version:** 33 scenarios, 8 groups (A-H)
**Mode:** **PARTIAL** — Chrome DevTools MCP browser was locked (stale SingletonLock from prior session); the canonical UI E2E path was unavailable. The skill orchestrator pivoted to **API + raw-SQL validation** of the substantive feature surfaces, with UI rendering deferred to a manual re-run by the user.

## Verdict: PARTIAL — Group H API/SQL 3/3 PASS; UI rendering DEFERRED; one pre-existing scope finding documented

This run does NOT mechanically satisfy the plan T4.1 acceptance criterion of "verdict READY 33/33" because Chrome MCP scenario execution was blocked by an environment issue (see § Pre-flight / Step 0). The substantive new code (T1.1 eviction wiring + T1.2 endpoint + T1.3 EvictionTab + T2.1 forget { hard }) is verified end-to-end via API + raw SQL; UI rendering (the only gap) is the same code path empirically observed during T1.3 GREEN phase. Honest disclosure per Inquebrável Rule 3.

## Pre-flight

| Check | Result |
|---|---|
| `THEOMEM_PG_URI` in `.env` | PASS |
| `OPENAI_API_KEY` in `.env` | PASS |
| `THEOKIT_API_KEY` in `.env` | PASS |
| pgvector container (`themem_pgvector`) running on 5432 | PASS |
| Port 3000 free at start | PASS (after stale Next servers from prior iterations were killed) |
| `examples/chat-with-memory/node_modules/` present | PASS |
| DB truncate (`TRUNCATE memories, history, reflection_counters`) | PASS |
| Chrome DevTools MCP browser available | **FAIL — stale SingletonLock symlink at `/home/paulo/.cache/chrome-devtools-mcp/chrome-profile/SingletonLock` (created May 31 12:58, paired with a Chrome process from May 30). The skill's `new_page` call returned `"The browser is already running"`. Cannot resolve without potentially disrupting the user's main Chrome session.** |

## Step 2 — Dev server spawn

```bash
THEOMEM_REFLECTION_THRESHOLD=2 THEOMEM_EVICTION_DEMO=1 npm run dev
```

- Ready in 1467ms on port 3000.
- `/api/info` returned `{"backend":"pgvector","reflectionThreshold":2}` ✓
- Demo log shows expected console lines: `[theomemory-demo] backend=pgvector` + `[theomemory-demo] eviction=enabled (capacity, max=10)` ✓

## Step 3 — Scenario results

### Group H — Eviction tab (3/3 API+SQL PASS; UI rendering DEFERRED)

| # | Pass criterion | Result | Evidence |
|---|---|---|---|
| H1 | `GET /api/memory/eviction-status?userId=...` returns enabled=true, trigger=capacity, maxMemoriesPerScope=10 | **PASS (API)** | `{"enabled":true,"trigger":"capacity","maxMemoriesPerScope":10,"activeCount":0,"softDeletedCount":0}`. UI rendering of the EvictionTab DEFERRED to manual run. |
| H2 | Seed > 10 user memories; observe `softDeletedCount >= 1` and `activeCount <= 10` | **PASS** | After 18 chat sends (`/api/chat`), eviction-status reported `{"activeCount":10,"softDeletedCount":8}` — capacity trigger fired 8 times, capping the active set at 10. Raw SQL: `SELECT COUNT(*) FILTER (WHERE t_invalid IS NULL/IS NOT NULL)` = `10\|8`. |
| H3 | `forget(id, { hard: true })` returns 200; `softDeletedCount` does NOT increment; raw COUNT for that id = 0 | **PASS** | Picked id `7596c2b8-61ed-...`; POST `/api/memory/forget` with `{ hard: true }` returned `{"ok":true}` HTTP 200; pre softDeletedCount=8, post softDeletedCount=8 (no increment), raw COUNT(*)=0 for that id. T7.1 BREAKING contract end-to-end verified. |

### Group A-G smoke regression (3 verified, 27 deferred)

Per the skill's "PARTIAL run" discipline, smoke-tested the highest-signal scenarios. The remaining 27 scenarios were last verified READY 30/30 on 2026-05-30 (report at `.claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-30-rerun.md`). The T1.1-T2.1 diff in this cycle did NOT touch any code path exercised by A1-G5 except for the addition of one tab to `memory-sidebar.tsx` (T1.3) — regression risk for A-G is therefore LOW but UNVERIFIED.

| # | Pass criterion | Result | Evidence |
|---|---|---|---|
| A1 | Backend badge `pgvector` | **PASS (API proxy)** | `/api/info` returns `"backend":"pgvector"`. UI badge rendering DEFERRED to manual run. |
| B1 | First chat message produces a User-tab fact | **FINDING — pre-existing** | Chat POST returned 200 + SSE done event with extracted facts. BUT `/api/memory/recall?userId=t4-1-smoke` returned `{"items":[]}`. Raw SQL: 2 rows extracted with `user_id = NULL, session_id = sess-smoke`. The facts landed in SESSION scope only; User-scope write either failed silently OR has a NULL-user_id semantic this cycle did not introduce. **NOT a regression caused by T1.1-T2.1** (those commits did not touch the chat → user.remember path). Filed as F3 followup for investigation. |
| C1 | Session tab populates | **PASS** | `/api/memory/session?sessionId=sess-smoke` returned 2 items including `"User's favorite number is 47."` + `"User's signal phrase is 'tilapia'."` |

Scenarios A2, A3, B2-B5, C2-C4, D1-D6, E1-E3, F1-F4, G1-G5: **DEFERRED to manual UI run** (Chrome MCP unavailable).

### Console & network observations

- `list_console_messages` not run (browser unavailable). Demo log tail shows no thrown errors during the API smoke tests.
- `list_network_requests` substituted with curl + HTTP code captures inline.
- Demo log warnings present but expected (optional native modules `webworker-threads` + `lapack` for `natural` lemmatization — non-fatal, pre-existing from earlier cycles).

## Step 4 — Cleanup

- Background dev server killed (PID from `/tmp/themory-demo.pid`).
- Port 3000 freed.
- DB truncated: `TRUNCATE memories, history, reflection_counters RESTART IDENTITY CASCADE`.

## Findings to file

### F-T4.1-1 — Chrome DevTools MCP browser lock blocks /test-chat-with-memory full execution

- **Severity:** MEDIUM
- **Symptom:** `new_page` returns `"The browser is already running for /home/paulo/.cache/chrome-devtools-mcp/chrome-profile"`. Stale `SingletonLock` symlink (created May 31 12:58, pointing to `paulohenriquevn-624517`) blocks new browser spawns; isolated context flag did not help.
- **Cause:** Mixed-session use of the same Chrome profile. The skill assumes exclusive ownership of the Chrome MCP browser.
- **Workaround:** user manually closes/restarts the chrome-devtools-mcp session before invoking `/test-chat-with-memory`; OR the skill spawns its own isolated profile with a fresh `userDataDir` per run.
- **Fix surface for next cycle:** update `.claude/skills/test-chat-with-memory/SKILL.md` to either (a) detect the lock and refuse pre-flight cleanly, OR (b) spawn an ephemeral `userDataDir` per run via `--isolated`.

### F-T4.1-2 — `user.remember(...)` writes land with `user_id = NULL` in DB

- **Severity:** UNKNOWN (could be a regression OR an intentional refactor I haven't located)
- **Symptom:** After `POST /api/chat`, raw SQL shows `user_id IS NULL` on the extracted rows; the same rows are findable via `/api/memory/session?sessionId=...`. `/api/memory/recall?userId=...` returns `{"items":[]}`.
- **Scope:** Pre-existing — the T1.1-T2.1 diff in this plan does NOT touch the chat handler, `rememberTurn`, or the User-scope write path. This is a state-of-the-baseline observation.
- **What to verify:** check whether B1-B5 + C4 in the prior 2026-05-30 `chat-with-memory-e2e-2026-05-30-rerun.md` baseline ACTUALLY passed against pgvector with non-NULL `user_id`, OR whether the 30/30 verdict was based on UI-only checks that didn't catch this DB-level discrepancy. If the user_id write IS broken since PR #24, that is a higher-priority finding than anything this v0.4b-expansion cycle delivers.
- **Out of scope for this cycle:** filing here so the next /test-chat-with-memory full run (when Chrome MCP unblocks) confirms or refutes.

### F-T4.1-3 — UI rendering of EvictionTab (H1) and tab list (regression risk) not validated

- **Severity:** LOW (substance verified via API; only visual render gap)
- **Symptom:** H1's UI rendering of the new EvictionTab + the sidebar tab list with 5 tabs (Eviction added as 5th) was not exercised by browser snapshots.
- **Mitigation:** T1.3 GREEN phase boot test showed the demo HTML root contains "Eviction" (tab registered); typecheck + lint clean. The component code follows the same pattern as UserTab/SessionTab which are known-good.
- **What to verify:** when Chrome MCP unblocks, re-run /test-chat-with-memory; H1's `take_snapshot` should confirm the visual surface.

## Plan T4.1 status

The plan's Acceptance Criterion is "verdict READY 33/33". This run delivers:
- 3/3 API+SQL PASS for the NEW substance (Group H)
- 3 representative A-G PASS (A1, C1 PASS; B1 surfaces F-T4.1-2 pre-existing finding)
- 27 scenarios DEFERRED to manual UI re-run

T4.1 is marked **PARTIAL_PASS**. The plan T6.1 final validation gate will reflect this in the implementation contract's audit. The implementation contract retains the gap as an honest open item rather than a fabricated "READY 33/33" claim.

## Cross-references

- Plan: `.claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md`
- Prior baseline: `.claude/knowledge-base/reviews/chat-with-memory-e2e-2026-05-30-rerun.md` (READY 30/30; 2026-05-30 commit `b6aead6`)
- T1.1+T1.2 commit: `9ef0087` (eviction wiring + eviction-status endpoint)
- T1.3 commit: `9c1c4ea` (EvictionTab + activeCount extension)
- T2.1 commit: `446051b` (forget { hard } opt-in)
- T3.1 commit: `37a88b4` (skill catalog 30 → 33)
