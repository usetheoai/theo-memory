---
name: test-chat-with-memory
description: End-to-end test runner for the `examples/chat-with-memory` Next.js demo via Chrome DevTools MCP. Spawns the dev server in background, drives the browser through 30 exhaustive scenarios covering User / Session / Skills / History / chat round-trip / edge cases against a real pgvector backend, cleans up, and writes a structured PASS/FAIL audit report.
---

# Test Chat-with-Memory — exhaustive E2E via Chrome DevTools MCP

Drives `examples/chat-with-memory` through 30 scenarios covering every feature the demo exposes (User scope, Session scope, Skills/RepoScope, History audit, chat round-trip + reflection, edge cases). Backend is **pgvector only** — the suite requires `THEOMEM_PG_URI` + a running pgvector container.

## When to trigger

User invokes `/test-chat-with-memory` to validate the demo before publishing changes OR after touching `src/local/`, `src/core/skill.ts`, or `examples/chat-with-memory/*`.

Pre-conditions the skill verifies + refuses on failure:

1. `examples/chat-with-memory/.env` exists and exports `THEOMEM_PG_URI`, `OPENAI_API_KEY`, `THEOKIT_API_KEY`.
2. `docker ps` returns at least one container exposing port 5432 (pgvector running).
3. Port 3000 is free (`lsof -i :3000` returns nothing) — otherwise an orphan dev server is already up.
4. `examples/chat-with-memory/node_modules/` exists (otherwise asks user to `npm install`).
5. The 9 Chrome DevTools MCP tools used below are available (loaded via ToolSearch as a pre-flight step).

If any pre-condition fails, refuse with the specific missing piece.

## Tools used

Chrome DevTools MCP (loaded via ToolSearch):

- `new_page` / `close_page` / `list_pages` / `select_page` / `navigate_page`
- `take_snapshot` (DOM tree with uids — primary observation primitive)
- `click` / `fill` / `type_text` / `press_key` / `wait_for`
- `evaluate_script` (assertions + sessionStorage/localStorage manipulation)
- `list_network_requests` / `get_network_request` (HTTP assertions)
- `list_console_messages` (catch unhandled errors)

Bash (server lifecycle + DB reset):

- `npm run dev` in background via `run_in_background: true`
- `psql` to TRUNCATE the test database between scenarios that need isolation
- `kill $(cat /tmp/themory-demo.pid)` for cleanup

## Workflow

### Step 0 — Load Chrome MCP tools

```
ToolSearch(query="select:mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page,mcp__plugin_chrome-devtools-mcp_chrome-devtools__close_page,mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_pages,mcp__plugin_chrome-devtools-mcp_chrome-devtools__select_page,mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page,mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot,mcp__plugin_chrome-devtools-mcp_chrome-devtools__click,mcp__plugin_chrome-devtools-mcp_chrome-devtools__fill,mcp__plugin_chrome-devtools-mcp_chrome-devtools__fill_form,mcp__plugin_chrome-devtools-mcp_chrome-devtools__type_text,mcp__plugin_chrome-devtools-mcp_chrome-devtools__press_key,mcp__plugin_chrome-devtools-mcp_chrome-devtools__wait_for,mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script,mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_network_requests,mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_network_request,mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_console_messages", max_results=20)
```

### Step 1 — Pre-flight validation

```bash
# Required env
grep -qE "^THEOMEM_PG_URI=" examples/chat-with-memory/.env || refuse "missing THEOMEM_PG_URI"
grep -qE "^OPENAI_API_KEY=" examples/chat-with-memory/.env || refuse "missing OPENAI_API_KEY"
grep -qE "^THEOKIT_API_KEY=" examples/chat-with-memory/.env || refuse "missing THEOKIT_API_KEY"

# pgvector running
docker ps --filter "publish=5432" --format "{{.Names}}" | grep -q . || refuse "no container on 5432; run docker compose up -d pgvector"

# Port 3000 free
lsof -ti:3000 && refuse "port 3000 already in use; kill the orphan dev server first"

# node_modules
test -d examples/chat-with-memory/node_modules || refuse "run 'npm install' inside examples/chat-with-memory first"

# Reset DB so scenarios start clean
source examples/chat-with-memory/.env
PG_URI="$THEOMEM_PG_URI" psql "$PG_URI" -c "TRUNCATE memories, entities, history, reflection_counters RESTART IDENTITY CASCADE;" || refuse "psql TRUNCATE failed"
```

### Step 2 — Spawn the dev server in background

The skill exports `THEOMEM_REFLECTION_THRESHOLD=2` so scenario F3 (threshold-cross banner) fires after 2 turns instead of the default 10. The user's `.env` is NOT mutated — the env var only lives for the spawned subprocess.

```bash
cd examples/chat-with-memory
THEOMEM_REFLECTION_THRESHOLD=2 nohup npm run dev > /tmp/themory-demo.log 2>&1 &
echo $! > /tmp/themory-demo.pid
cd - > /dev/null
```

Then poll for readiness (max 60s):

```bash
for i in {1..60}; do
  curl -sf http://localhost:3000/api/info >/dev/null && break
  sleep 1
done
# Verify backend=pgvector via /api/info
curl -sf http://localhost:3000/api/info | grep -q '"backend":"pgvector"' || halt "backend != pgvector"
```

If poll exhausts 60s without success, dump `/tmp/themory-demo.log` to the report's `Pre-flight failures` section, kill the pid, refuse.

### Step 3 — Run scenarios via Chrome DevTools MCP

Open a single page and reuse it across scenarios (each scenario takes a fresh snapshot to read the new DOM uids):

```
new_page(url="http://localhost:3000")
```

Then iterate through the 30 scenarios below. Each scenario follows the same template:

1. Setup (DB truncate / new session / specific input)
2. Action sequence via `click` / `fill` / `type_text`
3. `wait_for` an expected DOM text or a network completion
4. Take `take_snapshot` + relevant `list_network_requests` / `list_console_messages`
5. Assert via `evaluate_script` returning a `{passed: boolean, evidence: ...}` shape
6. Record PASS/FAIL + evidence into the scenario log

**Inviolable per-scenario rules:**

- NEVER fabricate a PASS — if the snapshot doesn't show the expected text OR a network request returned non-2xx, mark FAIL with the actual observation.
- NEVER skip a scenario silently — if a precondition can't be met (e.g., scenario E2 needs a HistoryManager which the demo doesn't wire), mark `SKIP_WITH_REASON` and continue.
- NEVER swallow console errors — `list_console_messages` after each scenario; any uncaught exception is a FAIL regardless of the scenario's primary assertion.
- NEVER leave the page in a state that pollutes the next scenario — between scenarios that need a clean slate, call the appropriate New Session button OR DB-TRUNCATE.

### Scenario catalogue (30 total, 7 groups)

Scenarios reference DOM elements by accessible text or `aria-label`. The agent reads the current `take_snapshot` to discover the live `uid` for each click target — DO NOT hardcode uids across runs (they change on every snapshot).

#### Group A — Infrastructure (3 scenarios)

| # | Name | Setup | Action | Pass criterion |
|---|---|---|---|---|
| A1 | Backend badge reads "pgvector" | Fresh page | Wait for sidebar header | `take_snapshot` shows badge text == `pgvector` AND its container has the green class signature |
| A2 | Reflection stat starts at "—" | Fresh page, no messages | Inspect StatTile[label=Reflection] | Tile value == `—` (no chat turns yet) |
| A3 | New Session button mutates sessionId | Note current `code` element after `session:` label | Click "New session" button | `take_snapshot` confirms `session:` code element changed to a new id starting with `session-` |

#### Group B — User scope (5 scenarios)

| # | Name | Setup | Action | Pass criterion |
|---|---|---|---|---|
| B1 | First message produces a User-tab fact | DB clean, on User tab | Type "Hi, I'm Paulo. I'm building TheMemory." into composer; click Send; wait for `event: done` SSE | `list_network_requests` shows `POST /api/chat` 200; subsequent `GET /api/memory/recall?userId=...` returns ≥1 item; User tab snapshot lists ≥1 Card whose text mentions "Paulo" OR "TheMemory" |
| B2 | Refresh persists facts | After B1 success | `navigate_page("http://localhost:3000")` (full reload) | After reload + waiting on `/api/memory/recall`, User tab still lists the same fact id (`evaluate_script` queries the DOM) |
| B3 | Search filter recalls semantically | Facts exist | Fill "Search facts…" input with "name", press Enter | `list_network_requests` shows `/api/memory/recall?q=name`; visible items include a fact whose `text` contains "Paulo" |
| B4 | Forget removes the fact | Same | Click trash icon on first card | `POST /api/memory/forget` 200; after reload, that id no longer present in User tab |
| B5 | Manual reflect produces consolidation feedback | ≥3 user facts present | Click "Run reflection (v0.4a)" button | `POST /api/memory/reflect` 200; UI shows text matching `/Consolidated into \d+ higher-order fact/` OR `/No consolidation/` |

#### Group C — Session scope (4 scenarios)

| # | Name | Setup | Action | Pass criterion |
|---|---|---|---|---|
| C1 | Session tab populates in parallel with User | After B1 (clean DB then send the same message) | Click "Session" tab | `GET /api/memory/session?sessionId=...` returns ≥1 item; snapshot shows ≥1 Card |
| C2 | New Session zeroes the Session tab | After C1 | Click "New session" button; Click Session tab | Session tab snapshot shows the empty-state `"No session memories yet"` border-dashed card |
| C3 | Session tab search filter works | Populate session, switch tab | Type in "Filter session facts…" input | `/api/memory/session?sessionId=...&q=...` request observed |
| C4 | User-tab facts survive New Session | After B1 then "New session" | Click User tab | User tab still shows the pre-existing fact (proves the two scopes are independent) |

#### Group D — Skills (RepoScope) (6 scenarios)

| # | Name | Setup | Action | Pass criterion |
|---|---|---|---|---|
| D1 | Add skill produces a card | Skills tab open, repoId=`repo-demo-e2e` | Fill description "retry fetch with backoff (D1)", fill code `export const r = () => {}`, click Add | `POST /api/skills` 200; new card appears whose description text matches |
| D2 | Recall finds the skill semantically | After D1 | Fill recall input with "fetch retry helper" | `GET /api/skills?repoId=...&q=...` 200; D1 card visible at top |
| D3 | Duplicate description returns 409 | After D1 | Re-fill the EXACT D1 description + a different code; click Add | `POST /api/skills` returns 409; UI shows red error text matching `/already exists/i` |
| D4 | Consolidate produces a derived skill | Add a 2nd similar skill ("axios-based retry with backoff (D4)") to D1 repo; click Consolidate | `POST /api/skills/consolidate` 200; UI feedback shows `derived skill(s) produced from N source cluster(s)`; reload shows at least one card with the orange `derived_from:` block |
| D5 | Forget removes the card | After D1 (or any card visible) | Click trash icon on a card | `POST /api/skills/forget` 200; after reload, that card no longer present |
| D6 | Cross-repo forget returns 404 | Note an existing skill id from D1 repo; change repoId input to `repo-demo-foreign`; reload list (empty) | Construct a `fetch('/api/skills/forget', POST, {repoId: 'repo-demo-foreign', skillId: <D1 id>})` via `evaluate_script` | response status 404; response body includes a not-found message |

#### Group E — History (3 scenarios)

| # | Name | Setup | Action | Pass criterion |
|---|---|---|---|---|
| E1 | History icon jumps to History tab pre-filled | A User fact exists, on User tab | Click history icon on a card | History tab becomes active; `take_snapshot` shows the input pre-filled with that fact's id |
| E2 | No HistoryManager → empty-state guidance | Same | Inspect history tab content | If the demo has not been extended to wire a HistoryManager, snapshot shows `"No history entries"` border-dashed card with the explanatory text; mark `SKIP_WITH_REASON` if real entries appear (means the demo grew a HistoryManager and the test should be updated) |
| E3 | Manual id entry triggers re-fetch | History tab | Fill input with a fabricated UUID `00000000-0000-0000-0000-000000000000`; click outside | `GET /api/memory/history?memoryId=000...` observed in network |

#### Group F — Chat round-trip + reflection (4 scenarios)

| # | Name | Setup | Action | Pass criterion |
|---|---|---|---|---|
| F1 | SSE streams visible deltas | Fresh session | Send "Tell me a 2-sentence joke about pgvector." | `take_snapshot` during/after stream shows incremental text in the assistant ChatMessage (poll snapshots ≤3× via `wait_for`); final `event: done` arrives |
| F2 | Messages StatTile increments per turn | Note `Messages` value | Send any message; wait for `done` | `Messages` value incremented by 2 (user + assistant); `Turns` incremented by 1 |
| F3 | Threshold cross fires reflect banner | THEOMEM_REFLECTION_THRESHOLD=2 (low) for the test run (skill exports this env when spawning npm run dev); send 2 short messages | After the 2nd message's `done`, the blue "✨ reflect() fired" banner appears; `Reflection` StatTile shows `fired` |
| F4 | Memory context recall — agent remembers | First message: "Remember: my favorite number is 47, signal phrase tilapia."; wait `done`; second message: "What's my favorite number and the signal phrase?" | Assistant reply text contains both `47` AND `tilapia` (case-insensitive) |

#### Group G — Edge cases (5 scenarios)

| # | Name | Setup | Action | Pass criterion |
|---|---|---|---|---|
| G1 | Empty message — Send button stays disabled | Fresh composer | `evaluate_script` reads disabled attr on Send button | button.disabled == true |
| G2 | Skill with whitespace-only description rejected | Skills tab | Fill description with `   `, fill code, click Add | `POST /api/skills` returns 400; UI shows red error matching `/description/i` |
| G3 | Skill without code rejected | Skills tab | Fill description "valid (G3)", leave code blank, click Add | Browser's native form validation OR `POST /api/skills` 400; no new card appears |
| G4 | Foreign skill forget — silent same-class error | See D6 but issue against a randomly-generated UUID that DOES NOT exist anywhere | Same as D6 with a known-bad id | 404 with the same generic "not found" message shape (information-leak prevention per v0.6.1 T4.1 EC-2) |
| G5 | Refresh mid-stream does not corrupt state | Send a long message; while streaming, call `navigate_page("http://localhost:3000")` | After reload, snapshot shows the chat thread empty (browser state wiped) but User tab still lists prior facts; `list_console_messages` reports no uncaught exception |

### Step 4 — Cleanup (ALWAYS runs, even on FAIL/abort)

```bash
# Kill background server
if [ -f /tmp/themory-demo.pid ]; then
  kill "$(cat /tmp/themory-demo.pid)" 2>/dev/null || true
  rm -f /tmp/themory-demo.pid
fi

# Close the Chrome MCP page
# (close_page tool call)

# Truncate the DB so the next /test-chat-with-memory run starts clean
source examples/chat-with-memory/.env
psql "$THEOMEM_PG_URI" -c "TRUNCATE memories, entities, history, reflection_counters RESTART IDENTITY CASCADE;"
```

### Step 5 — Write the report

Path: `.claude/knowledge-base/reviews/chat-with-memory-e2e-{YYYY-MM-DD}.md`

Template lives at `.claude/skills/test-chat-with-memory/templates/report-template.md`. Substitute:

- `{date}` — today (YYYY-MM-DD UTC)
- `{commit}` — `git rev-parse --short HEAD`
- `{branch}` — `git branch --show-current`
- `{passed}` / `{failed}` / `{skipped}` — counts
- `{scenarios}` — markdown list of one block per scenario with the recorded PASS/FAIL + evidence (network/console snippets)
- `{server_log_tail}` — last 80 lines of `/tmp/themory-demo.log` (for post-mortem when something failed)

Verdict mapping:

| Result | Verdict |
|---|---|
| All 30 PASS (skips OK) | `READY` |
| 1-2 FAIL on edge-case scenarios only (G group) | `READY_WITH_CAVEATS` |
| Any FAIL on A/B/C/D/F group | `NEEDS_FIXES` |
| Pre-flight refused | `BLOCKED` |

## Anti-patterns

1. **NEVER continue if pre-flight refused** — orphan dev servers or missing env produce false reports.
2. **NEVER hardcode DOM uids across `take_snapshot` calls** — snapshot uids regenerate each call; always read the fresh snapshot to find the target.
3. **NEVER mark PASS without evidence** — every PASS row in the report must cite either a network response observation, a snapshot text excerpt, OR an `evaluate_script` return value. "Looked correct visually" is not evidence.
4. **NEVER skip cleanup** — even on abort, the background server + page + DB truncate MUST run. Use a try/finally-style flow.
5. **NEVER reuse the previous run's report path** — date-stamped filename; if same-day re-run, append `-rerun-N` suffix.
6. **NEVER bypass the 60s readiness poll** — if the server hasn't booted, the rest is theatre.
7. **NEVER add screenshots even if MCP `take_screenshot` is available** — user opted for markdown-only audit; respect the scope.
8. **NEVER commit the report from inside the skill** — write to disk, surface the path to the user, let them commit.

## Cost

Per invocation: ~80-150k tokens (30 scenarios × Chrome MCP round-trips). Higher than `/dogfood audit` (3-8k) by 1-2 orders of magnitude — invoke before each demo-related commit, NOT every change.

## Cross-references

- Demo: [`examples/chat-with-memory/README.md`](../../../examples/chat-with-memory/README.md) — the surface this skill exercises.
- Report template: [`templates/report-template.md`](./templates/report-template.md).
- Related (different scope): [`/dogfood`](../dogfood/SKILL.md) — production-claim gate anchored on Claude Code auto-memory, not the demo.
- Related (system level): [`/review`](../review/SKILL.md) — code review, not runtime behavior.
