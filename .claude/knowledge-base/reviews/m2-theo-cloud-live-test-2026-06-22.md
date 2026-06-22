# Live-test — Theo-Cloud as a real user (M2 first-class-episodes)

**Date:** 2026-06-22
**Stack:** theo-cloud dev (`make dev-up`) — gateway `:13002`, dashboard `:5173`, themory REST `:18081`, kratos `:14433`, pg-themory `:15432`. **REAL OpenAI** (`OPENAI_BASE_URL=https://api.openai.com/v1`, `THEOMEM_EMBEDDER=openai`, `gpt-4o-mini` extraction + `text-embedding-3-small`), NOT the dev mock.
**themory image:** rebuilt from HEAD (commit `3344f2d`) — episodes route present (17 OpenAPI paths incl. `/v1/scopes/{type}/{id}/episodes`).

## Blockers found + fixed to enable the live-test (real defects the dogfood surfaced)

1. **`isolated-vm@7` (M1) incompatible with the Node 22 runtime.** `isolated-vm@7.0.0` declares `engines: node>=26`; the project runs Node 22 (Docker base + `distroless/nodejs22`). pnpm correctly OMITS the optional dep on Node 22 (unmet engines), so the image could not build from HEAD since M1 AND M1 skill-execution could never run on the Node 22 distroless runtime. **Fixed:** pinned `^6.1.2` (declares `node>=22`, API-identical for the M1 surface). Regression gate: M1 GOAL 8/8 + M2 9/9 + contract 1083 green. Commit `3344f2d`.
2. **Dockerfile builder lacked the node-gyp toolchain.** `builder` + `production-deps` (slim base) had no `python3`/`make`/`g++`, so the native `isolated-vm`/`onnxruntime-node` builds were skipped. **Fixed:** added the toolchain to both stages. Commit `22c3ad8`.

Both are genuine M1↔Docker hardening gaps that were never exercised because the previously-running stack image predated M1. Recommend a `/review` pass on the dep change (follow-up).

## Half A — REST (M2 episodes feature, real LLM, HTTP client) — PASS

Direct against the Theo-Cloud-deployed themory (`:18081`), bearer auth. `remember` via real `gpt-4o-mini` extraction (proof: mixed PT/EN output "user trabalha como engenheiro de backend…" — impossible from the deterministic mock; the coffee statement extracted 0 facts = real-LLM judgment):

| Behavior | Result |
|---|---|
| Temporal order (desc default) | newest-first ✓ |
| Cursor pagination (after) | page 1 → nextCursor → page 2, no gap/overlap ✓ |
| Same-`created_at` id tie-break | the two 16:07:23.558Z rows paginate deterministically ✓ |
| `order=asc` chronological replay | reverse of desc, consistent ✓ |
| `queryText=Lisbon` literal filter | only "user moved to Lisbon" ✓ |
| `asOf` bi-temporal replay | forgot the oldest row → default list excludes it (count 3) BUT `?asOf=<before-forget>` includes it (count 4, contains the forgotten id) ✓ |

All 5 GOAL behaviors + queryText exercised live against real pgvector + real OpenAI.

## Half B — UI (dashboard as a real user) — PASS

Browser (chrome-devtools) → dashboard `:5173` → gateway `:13002` → themory (real OpenAI):
- Registered a new account via Kratos (`livetest+m2@usetheo.dev`).
- **Playground → Remember** "I'm planning a trip to Japan next spring and I love ramen and trains" → real LLM extracted **3 facts** ("Stored 3 memory(ies)").
- **Playground → Recall** "What are my travel plans?" → real-embedding semantic ranking: "User is planning a trip to Japan next spring." (0.488) + "User loves trains." (0.215).
- **Memories tab** lists the 3 facts in temporal order (newest-first) with per-row Forget controls.
- Console: **0 errors / 0 warnings**.
- Evidence: `evidence/m2-live-test-playground-2026-06-22.png`, `evidence/m2-live-test-memories-list-2026-06-22.png`.

## Honest caveats
- The **gateway has no `episodes` proxy yet** — the dashboard does not surface the M2 episodes endpoint (it uses the existing memories/recall surfaces). The M2 episodes feature was validated via direct REST against the deployed themory (Half A). Gateway+dashboard episodes wiring is the documented cross-repo follow-up (`episodes-rest-real-pg-integration` / gateway proxy).
- Real OpenAI calls were made (cost) with the user-provided key (env-only, never written to a repo file). The key remains on the **rotate-as-compromised** list.

## Verdict
**LIVE-TEST PASS.** M2 episodes works end-to-end with real LLM through the Theo-Cloud-deployed themory; the general product (register → remember → recall → list) works as a real user through the full gateway/dashboard path with real LLM and zero console errors. Two real M1↔Docker hardening defects were found and fixed to get here.
