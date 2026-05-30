# Chat-with-Memory E2E — 2026-05-30 RE-RUN

**Branch:** `feat/v0-6-voyager-skill-library`
**Commits at run time:** baseline `b6aead6` + demo expansion `22f148b` + audit `069a257`/`fc7ed9b` + gitignore `95d260a` + **T0.1 `59853b7`** + **T1.1+T1.2 `29f45a4`** + **T2.1 `8d5accb`** (this re-run validates them)
**Backend asserted:** `pgvector` (via `/api/info` 200 `{"backend":"pgvector","reflectionThreshold":2}`)
**Browser:** Chrome DevTools MCP (`http://localhost:3000`)
**OpenAI model:** `gpt-4o-mini` (extraction) + `text-embedding-3-small` (embed) + `gpt-4o` (chat)

## Verdict

**READY** — 30/30 PASS, 0 FAIL, 0 SKIP_WITH_REASON. **Both 2026-05-30 baseline FAILs now PASS:**

- **D4 (formerly FAIL):** `POST /api/skills/consolidate` with `clusterThreshold: 0.6` (T1.1+T1.2 fix) produces `sourceClustersCount: 1`, `derivedSkillsCount: 1`, `supersededIds: [1c8fae38, b1c2ede4]`, derived skill `ca59669b` cites BOTH source ids in `derivedFrom`. Cosine of the 2 retry-helper fixtures cleared the 0.6 threshold (baseline 0.85 was too strict for OpenAI text-embedding-3-small natural-language vectors).
- **F3 (formerly FAIL):** After 2 messages with `THEOMEM_REFLECTION_THRESHOLD=2`, Reflection StatTile shows `fired` AND the blue "✨ reflect() fired" banner is visible. The T0.1 globalThis-lifted `writeCounts` survives Next.js HMR module reloads.

| Bucket | Count |
|---|---:|
| **PASS** | 30 |
| **FAIL** | 0 |
| **SKIP_WITH_REASON** | 0 |
| **Total** | 30 |

| Result | Verdict | Triggered? |
|---|---|---|
| **All 30 PASS** | **READY** | **YES ✓** |
| 1-2 FAIL on G only | READY_WITH_CAVEATS | no |
| Any FAIL on A/B/C/D/F | NEEDS_FIXES | no |
| Pre-flight refused | BLOCKED | no |

## Pre-flight

- `.env` present + `THEOMEM_PG_URI`/`OPENAI_API_KEY`/`THEOKIT_API_KEY` exported into subprocess: ok
- pgvector container (port 5432): ok — `themem_pgvector  Up About an hour (healthy)`
- Port 3000 free: ok (after EC-2 absorption purge)
- `node_modules/`: ok
- Node 22.22.2: ok (via nvm PATH override)
- **EC-2 absorption — `.next/` cache purged + `next dev` zombies killed BEFORE invoking the skill:** ok (matched plan T3.1 § Tasks Step 1.5)
- DB truncate before run: ok
- Dev server reachable on `/api/info` within 1s: ok
- `/api/info.backend == "pgvector"`: ok

## Scenarios

### Group A — Infrastructure (3/3 PASS)

| # | Name | Result | Evidence |
|---|---|---|---|
| **A1** | Backend badge "pgvector" | **PASS** | Snapshot `uid=21_2 StaticText "pgvector"`; `/api/info` returns `{"backend":"pgvector","reflectionThreshold":2}` |
| **A2** | Reflection stat starts "—" | **PASS** | Snapshot `uid=20_15 StaticText "—"` before any chat turn |
| **A3** | New Session mutates sessionId | **PASS** | Pre-click: `session-7m2nbom3`; post-click: `session-ub9kw55l` |

### Group B — User scope (5/5 PASS)

| # | Name | Result | Evidence |
|---|---|---|---|
| **B1** | First message → User-tab fact | **PASS** | POST /api/chat 200; recall returns 2 items (`User is building TheMemory.` + `User's signal phrase is tilapia.`); cards visible at uid=21_3 / 21_7 |
| **B2** | Refresh persists facts | **PASS** | Post-reload: same userId; tilapia fact survives in User scope |
| **B3** | Search filter (semantic recall) | **PASS** | GET /api/memory/recall?q=building 200; 1 match with score 0.2038 |
| **B4** | Forget removes the fact | **PASS** | POST /api/memory/forget 200; removed verified absent in next recall (count drops from 2 to 1) |
| **B5** | Manual reflect feedback | **PASS** | POST /api/memory/reflect 200; body `{"derivedMemoriesCreated":0,"reason":"no-consolidation"}` matches `/Consolidated into N\|No consolidation/` |

### Group C — Session scope (4/4 PASS)

| # | Name | Result | Evidence |
|---|---|---|---|
| **C1** | Session populates parallel to User | **PASS** | GET /api/memory/session 200; 4 facts (Paulo / TheMemory project / 47 / tilapia) — full extraction kept richer detail than User scope |
| **C2** | New Session zeroes Session tab | **PASS** | Fresh sessionId returns 0 items |
| **C3** | Session filter (q=tilapia) | **PASS** | GET /api/memory/session?sessionId=...&q=tilapia 200; 1 match with score 0.3260 |
| **C4** | User scope survives New Session | **PASS** | User recall after new session: tilapia fact still present |

### Group D — Skills / RepoScope (6/6 PASS — was 5/6)

| # | Name | Result | Evidence |
|---|---|---|---|
| **D1** | Add skill produces card | **PASS** | POST /api/skills 200; id `1c8fae38...` |
| **D2** | Recall finds skill semantically | **PASS** | GET /api/skills?q=http retry helper 200; D1 at index 0 with score 0.5403 |
| **D3** | Duplicate description 409 | **PASS** | POST /api/skills 409; body `{"error":"A skill with this description already exists (hash collision)..."}` |
| **D4** ⭐ | **Consolidate produces derived skill** | **PASS** ⭐ | After adding 2nd similar skill `axios-based retry...`; POST /api/skills/consolidate `{clusterThreshold: 0.6}` returned status **200**, `sourceClustersCount: 1`, `derivedSkillsCount: 1`, `supersededIds: ["1c8fae38","b1c2ede4"]`, derived skill `ca59669b` with `derivedFromCount: 2`, description `"Both implementations demonstrate the use of a retry mechanism..."`. **Was 0/0/0 at baseline; now 1/1/2.** |
| **D5** | Forget removes card | **PASS** | POST /api/skills/forget 200 `{ok:true}`; target absent in subsequent list |
| **D6** | Cross-repo forget 404 | **PASS** | POST /api/skills/forget with `repo-demo-foreign-rerun` 404 `"Memory not found: skillId ... not found in repo 'repo-demo-foreign-rerun' (cross-scope or non-skill)"` |

### Group E — History audit (3/3 PASS)

| # | Name | Result | Evidence |
|---|---|---|---|
| **E1** | History icon → tab pre-filled | **PASS** | Click on `[aria-label="Inspect history"]` switched active tab; input pre-filled with `1d705762...` |
| **E2** | "No history entries" empty-state | **PASS** | Body contains `"No history entries"` (demo doesn't wire DrizzleHistoryManager) |
| **E3** | Manual UUID triggers fetch | **PASS** | GET /api/memory/history?memoryId=00000000-... returned 200 `{entries: []}` |

### Group F — Chat round-trip + reflection (4/4 PASS — was 3/4)

| # | Name | Result | Evidence |
|---|---|---|---|
| **F1** | SSE streams visible deltas | **PASS** | Both assistant messages rendered incrementally in chat log; final `done` event arrived |
| **F2** | Messages StatTile increments | **PASS** | Pre-message: Turns=0/Messages=0. After msg 1: Turns=1/Messages=2. After msg 2: Turns=2/Messages=4 |
| **F3** ⭐ | **Threshold cross fires reflect banner** | **PASS** ⭐ | After 2 messages with `THEOMEM_REFLECTION_THRESHOLD=2`: Reflection tile = `"fired\nReflection"`, banner `"reflect() fired"` visible in body. **Was FAIL at baseline (tile stuck at 1/2 due to HMR Map reset); now fires correctly with globalThis pattern.** |
| **F4** | Memory context recall | **PASS** | Assistant reply: `"Your favorite number is 47, and your signal phrase is \"tilapia.\""` — both 47 AND tilapia present |

### Group G — Edge cases (5/5 PASS)

| # | Name | Result | Evidence |
|---|---|---|---|
| **G1** | Empty Send button disabled | **PASS** | `document.querySelector('button[type="submit"]').disabled === true` on fresh composer |
| **G2** | Whitespace description 400 | **PASS** | POST /api/skills with `description: "   "` returned 400 `{"error":"description required"}` |
| **G3** | No-code 400 | **PASS** | POST /api/skills with `code: ""` returned 400 `{"error":"code required"}` |
| **G4** | Foreign skill forget 404 | **PASS** | POST /api/skills/forget with random UUID `aaaaaaaa-...` returned 404 `"Memory not found: skillId aaaaaaaa-... not found in repo 'repo-demo-e2e-rerun' (cross-scope or non-skill)"` — same error class as D6 (info-leak prevention v0.6.1 T4.1 EC-2) |
| **G5** | Refresh mid-stream state | **PASS** | Post-reload: chat thread empty (placeholder `"Say hi."` visible); User scope tilapia survives; no uncaught JS exceptions in `list_console_messages` |

## Network requests summary

| Endpoint | Status distribution |
|---|---|
| GET /api/info | 200 |
| POST /api/chat | 200 ×2 (B1 + F4) |
| GET /api/memory/recall | 200 ×many |
| GET /api/memory/session | 200 ×many |
| POST /api/memory/forget | 200 (B4) |
| POST /api/memory/reflect | 200 (B5) |
| GET /api/memory/history | 200 (E3) |
| GET /api/skills | 200 ×many |
| POST /api/skills | 200 ×2 (D1, D4_add2) · **409** (D3) · **400** ×2 (G2, G3) |
| **POST /api/skills/consolidate** | **200 → 1 cluster / 1 derived (D4 ⭐)** |
| POST /api/skills/forget | 200 (D5) · **404** ×2 (D6, G4) |

## Console messages

```
(zero errors)
```

Zero uncaught exceptions during the entire re-run. Note: the 4xx tests in this re-run were fired via `evaluate_script(fetch(...))` rather than the UI's natural error flow, so the browser's "Failed to load resource" console-error noise from the baseline run didn't surface. The HTTP status codes are still observed correctly via the script-level response bodies (D3 409, D6/G4 404, G2/G3 400).

## Server log tail

```
GET /api/memory/session 200
GET /api/memory/recall  200
GET /api/skills         200
POST /api/skills        200
POST /api/skills/consolidate 200 in 2207ms
POST /api/skills/forget 200
```

No errors, no stack traces, no unhandled rejections.

## Cleanup

- Background dev-server killed: ok (port 3000 freed)
- `/tmp/themory-demo.pid` removed: ok
- DB final TRUNCATE: ok (`TRUNCATE TABLE` confirmed)
- Chrome MCP page: last remaining `about:blank` shell preserved per MCP "last open page cannot be closed" policy

## Handoff

**READY** — both demo-environment FAILs from the 2026-05-30 baseline are closed. The full system surface (User + Session + Skills RepoScope + History + chat round-trip + reflection threshold + edge cases) demonstrates correctly end-to-end against real `pgvector` + real OpenAI embeddings.

The implementation of the `chat-with-memory-e2e-fixes` plan v1.1 is complete. Next step: T3.1 commit (which amends the CHANGELOG.md placeholders with this report's path + verdict `READY`).
