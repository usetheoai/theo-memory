# Chat-with-Memory E2E — {date}

**Branch:** `{branch}`
**Commit:** `{commit}`
**Backend asserted:** pgvector
**Server log:** `/tmp/themory-demo.log` (preserved post-run)

## Verdict

**{verdict}** — _READY / READY_WITH_CAVEATS / NEEDS_FIXES / BLOCKED_

| Bucket | Count |
|---|---:|
| PASS | {passed} |
| FAIL | {failed} |
| SKIP_WITH_REASON | {skipped} |
| Total scenarios | 30 |

Verdict mapping rule:

| Result | Verdict |
|---|---|
| All 30 PASS (skips OK) | `READY` |
| 1-2 FAIL on G group (edge cases) only | `READY_WITH_CAVEATS` |
| Any FAIL on A / B / C / D / F group | `NEEDS_FIXES` |
| Pre-flight refused | `BLOCKED` |

## Pre-flight

- `THEOMEM_PG_URI` present: _ok / missing_
- `OPENAI_API_KEY` present: _ok / missing_
- `THEOKIT_API_KEY` present: _ok / missing_
- pgvector container up (port 5432): _ok / missing_
- Port 3000 free: _ok / busy_
- `examples/chat-with-memory/node_modules/`: _ok / missing_
- DB truncate before run: _ok / failed_
- Dev server reachable on `/api/info` within 60s: _ok / timed-out_
- `/api/info.backend == "pgvector"`: _ok / mismatch_

## Scenarios

> Each scenario records: setup, action, expected outcome, observed evidence, result. Evidence is one of: network response excerpt, snapshot text excerpt, `evaluate_script` return value, or console message.

### Group A — Infrastructure (3)

#### A1 — Backend badge reads "pgvector"

- **Setup:** Fresh page at `http://localhost:3000`.
- **Action:** Wait for sidebar header to render.
- **Expected:** Badge container text equals `pgvector` AND sits inside an element with the emerald class signature.
- **Observed:** _{snapshot excerpt of the badge area}_
- **Network:** _GET /api/info returned: {status, json}_
- **Result:** _PASS / FAIL_

#### A2 — Reflection stat starts at "—"

- **Setup:** Fresh page, no chat turns yet.
- **Action:** Inspect StatTile with label `Reflection`.
- **Expected:** Tile value equals `—`.
- **Observed:** _{tile excerpt}_
- **Result:** _PASS / FAIL_

#### A3 — New Session button mutates sessionId

- **Setup:** Note the `<code>` element following the `session:` label.
- **Action:** Click "New session" button in header.
- **Expected:** A different session id appears in the `<code>` element, starting with `session-`.
- **Observed:** _before={...}, after={...}_
- **Result:** _PASS / FAIL_

### Group B — User scope (5)

#### B1 — First message produces a User-tab fact

- **Setup:** DB truncated; on User tab.
- **Action:** Type `Hi, I'm Paulo. I'm building TheMemory.`; click Send; wait for `event: done` on SSE.
- **Expected:** `POST /api/chat` 200; subsequent `GET /api/memory/recall?userId=...` returns ≥1 item; User tab Cards list contains ≥1 entry whose text mentions `Paulo` OR `TheMemory`.
- **Observed:** _{network + snapshot excerpts}_
- **Result:** _PASS / FAIL_

#### B2 — Refresh persists facts

- **Setup:** After B1 success.
- **Action:** `navigate_page("http://localhost:3000")` (full reload).
- **Expected:** After reload + waiting on `/api/memory/recall`, User tab still lists the same fact id.
- **Observed:** _{evaluate_script return value}_
- **Result:** _PASS / FAIL_

#### B3 — Search filter recalls semantically

- **Setup:** Facts exist.
- **Action:** Fill "Search facts…" input with `name`; press Enter.
- **Expected:** `GET /api/memory/recall?...&q=name` issued; visible items include a fact whose text contains `Paulo`.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### B4 — Forget removes the fact

- **Setup:** B3.
- **Action:** Click trash icon on the first card.
- **Expected:** `POST /api/memory/forget` 200; that id no longer present in next recall snapshot.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### B5 — Manual reflect produces consolidation feedback

- **Setup:** ≥3 user facts present (send additional messages if needed).
- **Action:** Click "Run reflection (v0.4a)".
- **Expected:** `POST /api/memory/reflect` 200; UI text matches `Consolidated into \d+ higher-order fact` OR `No consolidation`.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

### Group C — Session scope (4)

#### C1 — Session tab populates in parallel with User

- **Setup:** DB truncated; on Session tab; send same B1 message.
- **Action:** Click Session tab.
- **Expected:** `GET /api/memory/session?sessionId=...` returns ≥1; ≥1 Card visible.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### C2 — New Session zeroes the Session tab

- **Setup:** After C1.
- **Action:** Click "New session"; click Session tab.
- **Expected:** Snapshot shows the empty-state `No session memories yet` border-dashed card.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### C3 — Session tab search filter works

- **Setup:** Populate session; switch tab.
- **Action:** Type in "Filter session facts…" input.
- **Expected:** `GET /api/memory/session?sessionId=...&q=...` observed.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### C4 — User-tab facts survive New Session

- **Setup:** After B1, then "New session".
- **Action:** Click User tab.
- **Expected:** Pre-existing User fact still present.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

### Group D — Skills / RepoScope (6)

#### D1 — Add skill produces a card

- **Setup:** Skills tab; `repoId=repo-demo-e2e`.
- **Action:** Fill description `retry fetch with backoff (D1)`, code `export const r = () => {}`; select language `typescript`; click Add.
- **Expected:** `POST /api/skills` 200; new card visible.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### D2 — Recall finds the skill semantically

- **Setup:** D1 PASS.
- **Action:** Fill recall input with `fetch retry helper`.
- **Expected:** `GET /api/skills?repoId=...&q=fetch retry helper` 200; D1 card at top.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### D3 — Duplicate description returns 409

- **Setup:** D1 PASS.
- **Action:** Re-fill exact D1 description with different code; click Add.
- **Expected:** `POST /api/skills` 409; UI shows red error matching `/already exists/i`.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### D4 — Consolidate produces a derived skill

- **Setup:** D1 PASS; add a 2nd similar skill `axios-based retry with backoff (D4)` to the same repo.
- **Action:** Click Consolidate.
- **Expected:** `POST /api/skills/consolidate` 200; UI feedback shows `\d+ derived skill\(s\) produced from \d+ source cluster\(s\)`; reload shows ≥1 card with `derived_from:` orange block.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### D5 — Forget removes the card

- **Setup:** Any visible skill card.
- **Action:** Click trash icon.
- **Expected:** `POST /api/skills/forget` 200; reload — card no longer present.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### D6 — Cross-repo forget returns 404

- **Setup:** Note an existing skill id from `repo-demo-e2e`; change repoId input to `repo-demo-foreign`.
- **Action:** Via `evaluate_script`, issue `fetch('/api/skills/forget', {method:'POST', headers, body: JSON.stringify({repoId:'repo-demo-foreign', skillId: <known-id-from-other-repo>})})`.
- **Expected:** response status 404 with not-found message.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

### Group E — History audit (3)

#### E1 — History icon jumps to History tab pre-filled

- **Setup:** A User fact exists; on User tab.
- **Action:** Click history icon on a card.
- **Expected:** History tab becomes active; input pre-filled with that fact's id.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### E2 — Empty-state guidance when no HistoryManager wired

- **Setup:** E1.
- **Action:** Inspect History tab content.
- **Expected:** Empty-state card with the `No history entries` text (the demo does not wire a HistoryManager by default — wiring `DrizzleHistoryManager` would change this; in that case mark `SKIP_WITH_REASON: demo grew a HistoryManager — update E2 expectation`).
- **Observed:** _{...}_
- **Result:** _PASS / FAIL / SKIP_WITH_REASON_

#### E3 — Manual id entry triggers re-fetch

- **Setup:** History tab.
- **Action:** Fill input with `00000000-0000-0000-0000-000000000000`.
- **Expected:** `GET /api/memory/history?memoryId=000...` observed in network.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

### Group F — Chat round-trip + reflection (4)

#### F1 — SSE streams visible deltas

- **Setup:** Fresh session.
- **Action:** Send `Tell me a 2-sentence joke about pgvector.`; poll `take_snapshot` up to 3× while streaming.
- **Expected:** Snapshot shows incremental text in assistant ChatMessage; final `event: done` arrives.
- **Observed:** _{snapshot deltas}_
- **Result:** _PASS / FAIL_

#### F2 — Messages StatTile increments per turn

- **Setup:** Note `Messages` value.
- **Action:** Send any message; wait `done`.
- **Expected:** `Messages` +2 (user + assistant); `Turns` +1.
- **Observed:** _{before/after}_
- **Result:** _PASS / FAIL_

#### F3 — Threshold cross fires reflect banner

- **Setup:** Skill spawned `npm run dev` with `THEOMEM_REFLECTION_THRESHOLD=2`; send 2 short messages.
- **Action:** Wait for 2nd `done`.
- **Expected:** Blue `✨ reflect() fired` banner appears; `Reflection` tile shows `fired`.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### F4 — Memory context recall — agent remembers

- **Setup:** Fresh session; send `Remember: my favorite number is 47, signal phrase tilapia.`; wait `done`.
- **Action:** Send `What's my favorite number and the signal phrase?`.
- **Expected:** Assistant reply text contains both `47` AND `tilapia` (case-insensitive).
- **Observed:** _{reply excerpt}_
- **Result:** _PASS / FAIL_

### Group G — Edge cases (5)

#### G1 — Empty message: Send button stays disabled

- **Setup:** Fresh composer.
- **Action:** `evaluate_script` returns `document.querySelector('button[type=submit]').disabled`.
- **Expected:** `true`.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### G2 — Skill with whitespace-only description rejected

- **Setup:** Skills tab.
- **Action:** Fill description `   `, fill code, click Add.
- **Expected:** `POST /api/skills` 400; red error matching `/description/i`.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### G3 — Skill without code rejected

- **Setup:** Skills tab.
- **Action:** Fill description `valid (G3)`, leave code blank, click Add.
- **Expected:** HTML `required` validation OR `POST /api/skills` 400; no new card.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### G4 — Foreign skill forget — silent same-class error

- **Setup:** Known-bad id (random UUID).
- **Action:** `fetch('/api/skills/forget', POST, {repoId:'repo-demo-e2e', skillId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'})`.
- **Expected:** 404 with same generic not-found message shape (information-leak prevention per v0.6.1 T4.1 EC-2).
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

#### G5 — Refresh mid-stream does not corrupt state

- **Setup:** Send a long message; while streaming, call `navigate_page("http://localhost:3000")`.
- **Action:** Inspect post-reload state.
- **Expected:** Chat thread empty; User tab still lists prior facts; `list_console_messages` reports no uncaught exception.
- **Observed:** _{...}_
- **Result:** _PASS / FAIL_

## Network requests summary

| Endpoint | Hits | Status distribution |
|---|---:|---|
| `POST /api/chat` | _N_ | _200:N, 4xx:N, 5xx:N_ |
| `GET /api/memory/recall` | _N_ | _..._ |
| `POST /api/memory/forget` | _N_ | _..._ |
| `POST /api/memory/reflect` | _N_ | _..._ |
| `GET /api/memory/session` | _N_ | _..._ |
| `GET /api/memory/history` | _N_ | _..._ |
| `GET /api/skills` | _N_ | _..._ |
| `POST /api/skills` | _N_ | _200:N, 409:N, 400:N_ |
| `POST /api/skills/consolidate` | _N_ | _..._ |
| `POST /api/skills/forget` | _N_ | _200:N, 404:N_ |
| `GET /api/info` | _N_ | _..._ |

## Console messages

> Any non-empty entry is automatically a FAIL for the scenario it occurred in, regardless of the primary assertion.

```
{console_log_excerpt_or_(none)}
```

## Server log tail

```
{server_log_tail}
```

## Cleanup

- Background dev-server pid killed: _ok / failed_
- `/tmp/themory-demo.pid` removed: _ok / not-present_
- DB final TRUNCATE: _ok / failed_
- Chrome page closed: _ok / failed_

## Handoff

- _If READY_ — demo state is healthy; safe to ship changes to `examples/chat-with-memory/*`.
- _If READY_WITH_CAVEATS_ — only G-group FAILs; review each, fix or document as accepted-risk in `CHANGELOG.md`.
- _If NEEDS_FIXES_ — loop back to the demo source; root-cause the failure; re-run `/test-chat-with-memory`.
- _If BLOCKED_ — fix pre-flight failure; re-run.

---

_Generated by `/test-chat-with-memory`. Not committed automatically — user reviews and commits._
