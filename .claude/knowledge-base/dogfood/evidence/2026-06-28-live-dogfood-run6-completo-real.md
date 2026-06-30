---
scenario: dashboard-memory-journey
date: 2026-06-28
status: running
operator: claude-code
outcome: pass
summary: "COMPLETO real (no mock) across all 5 modalities — browser/http/mcp/cli/sdk + isolation. 71 rows PASS incl. 100% of [CRIT] security/isolation rows (#77 SEC-77-PA now 403, KEY-ESC, MCP-OM-DEL IDOR, XISO cross-tenant). 2 MCP native-stdio rows correctly fail-closed (anti-spoof); MCP data round-trip proven via OpenMemory SSE. Not literally all 91 catalog rows (Episodes/Exports/Webhooks/api-keys UX, MCP streamable/auth, some RBAC mutations not driven)."
build_under_test: "themory image b42b65078cd0 (#77) via make memory-up → themory-host on REAL OpenAI (text-embedding-3-small + OpenAILLM); edge :8090; data plane :18081; pg-themory :15432"
---

# 2026-06-28 — Live dogfood run 6 (COMPLETO, real, no mock)

Full multi-modal catalog run on the **canonical real** stack (`make up` + `make memory-up`,
`themory-host`, REAL OpenAI, no mock container), each row driven in its **declared modality**.
Supersedes run 5 (which halted at the SEC-77-PA finding now fixed via
usetheodev/theo-workspace#5).

## Verdict: PASS

71 rows PASS across all five modalities + cross-cutting isolation. **100% of `[CRIT]`
security/isolation rows green.** Zero genuine product failures. Two MCP native-stdio rows
correctly fail-closed (documented below — that is the security contract, not a defect).

Honest scope note: this run drove a **representative + all-[CRIT]** slice, not literally all
91 catalog rows. Not driven this run: UX Episodes/Exports/Webhooks/api-keys tabs, MCP
streamable-http (`MCP-HTTP`) + transport-auth (`MCP-AUTH`), and a few admin RBAC mutations
(`API-MEM-ADD/ROLE/DEL`). Every modality was exercised for real; every security/isolation
contract row passed.

## §A — UX (browser · Chrome DevTools MCP) — the human path

| id | result | evidence |
|---|---|---|
| UX-AUTH-1 | PASS | authenticated dashboard renders; `GET /sessions/whoami` 200 |
| UX-AUTH-3 | PASS | "Verify your email" banner present + browseable (Kratos dev) |
| UX-OVW-1 | PASS | Memory Overview KPIs real (2 memories, 1 retrieval, 2 add events, 3 entities); `GET /v1/dashboard/memory/metrics` 200 |
| UX-MEM-1 | PASS | Memories tab lists real rows w/ timestamps + per-row forget (the 2 canaries at top) |
| UX-PLG-1 `[CRIT]` | PASS | Playground Remember → toast **"Stored 2 memory(ies)"** (real GPT extraction); `POST …/remember` **201** |
| UX-PLG-2 `[CRIT]` | PASS | Recall "which database… deployment code" → real scores **Postgres 0.537 / BROWSER-CANARY-4242 0.490** (older facts ranked below); `POST …/recall` **200** |
| UX-PLG-3 | PASS | Run reflection → `POST …/reflect` **202** |
| UX-ENT-1 | PASS | Entities tab real aggregation (USER/SESSION/AGENT/REPO tabs; BROWSER-CANARY-4242, Postgres, …) |
| UX-GRF-1 | PASS | Graph renders force-directed view: **5 entities · 4 relations** |
| UX-SKL-1 | PASS | Skills tab renders (empty-state correct — HTTP-created skills live in the data-key workspace, not the browser session's → workspace isolation) |

Screenshot: `2026-06-28-playground-recall-real.png`. Network proof (all via dashboard BFF →
edge → broker → themory-host): remember 201, recall 200, reflect 202, metrics 200, whoami 200.

## §B — REST API (http · 35 rows) — PASS 35/35

Health/meta (HLT-1/2, WK-1, OAS-1); data verbs (REM-1 201, REC-1 200 real semantic, RFL-1 202,
FGT-1 204); scope GETs (SCM/SEP/SMT/SEN/SGR all 200); skills (SKL/SKP/SKA/SKD); negatives
(REM-NEG/REC-NEG/SFG-2 all 422); admin lifecycle (KEY-MINT/LIST/ROT/LIN/REV/MINT-WS).

Security `[CRIT]` — all green:

| row | got | want |
|---|---|---|
| API-SEC-77-W (read-only → remember) | 403 | 403 |
| **API-SEC-77-PA (platform-admin → remember)** | **403** | 403 (the #5 fix) |
| API-SEC-77-R (read-only → recall) | 200 | ≠403 |
| API-KEY-ESC (mint platform-admin w/o holding) | 403 | 403 |
| API-AUTH-NEG (no bearer) | 401 | 401 |
| API-MEM-NEG (member role → /members) | 403 | 403 |
| EDGE-NOAUTH (no auth at edge) | 401 | 401 |

## §C — MCP (real MCP client · stdio + OpenMemory SSE) — 7 PASS

| row | result | note |
|---|---|---|
| MCP-LIST | PASS | native toolset: remember/recall/forget/reflect/episodes (+ skill tools) |
| MCP-SCOPE `[CRIT]` | PASS | recall with spoofed scope arg → typed reject "Scope not bound… ctx.session (ADR D3)" — anti-spoof holds |
| MCP-OM-LIST | PASS | exactly add_memories/search_memory/list_memories/delete_memories |
| MCP-OM-ADD | PASS | stored via real OpenAI extraction (SSE, user bound from URL path) |
| MCP-OM-SRC | PASS | search found the canary (real semantic) |
| MCP-OM-LST | PASS | lists own memories |
| MCP-OM-DEL `[CRIT]` | PASS | bob's cross-user delete of alice's id → typed-deny (IDOR closed, per-user isolation) |

`MCP-REM` / `MCP-REC` over **native stdio** correctly **fail-closed** ("Scope not bound — caller
must invoke memoryFromCtx with ctx.session"): the server binds scope from a trusted session,
never from spoofable tool args. This IS the security contract (the same property `MCP-SCOPE`
asserts). The happy-path MCP data round-trip is proven on the OpenMemory SSE path where the
user is bound from the URL. Not a product failure.

Not driven this run: `MCP-HTTP` (streamable-http) and `MCP-AUTH` (transport bearer).

## §D — CLI (`themory` subprocess · 6 rows) — PASS 6/6

CLI-HLP (boots env-free, exit 0, lists verbs); CLI-HLT (`health --deep` ok); CLI-REM; CLI-REM-NOINFER
(#79 `--no-infer` verbatim); CLI-REC (`recall --json` → 2 real items via OpenAI embedder); CLI-NEG
(missing arg → nonzero + clean stderr, no stack trace).

Correction (Rule 3) — two DX claims in an earlier draft of this file were WRONG; verified false
against the source after the run:
- **`recall --json` stdout is clean JSON.** The migration/log preamble I first saw went to
  **stderr**; my harness had merged `2>&1`. Re-run with stderr discarded: stdout parses as a clean
  JSON array. No `--json` pollution bug.
- **The `remember`/`recall` verbs use the REAL OpenAI LLM**, not a stub. They build Memory via
  `createAgentToolsMemory()` → `new OpenAILLM()` + `OpenAIEmbedder` with no silent fallback (fails
  loud, Rule 8). The `StubLLM` I saw is used ONLY by `themory health --deep` (a deliberate pure
  connectivity smoke, `run-health.ts`). So CLI `remember` with inference DOES extract via real GPT.

## §E — SDK (8 subpath imports + round-trip · 9 rows) — PASS 9/9

All 8 `@usetheo/memory` subpaths import (barrel 105 exports, contract 65, theokit 2, cache-pg 8,
embedders 6, llms 2, adaptive-local 1, reranker-local 1). SDK-CORE round-trip: `createLocalMemory`
(await — it returns a Promise) with `PgvectorStore` + `OpenAIEmbedder` + `DeterministicStubLLM` →
remember→recall returned the stored canary (real OpenAI embedder + pgvector).

## §F — Cross-cutting isolation (4 rows · all `[CRIT]`) — PASS 4/4

Two distinct workspaces via the Model B mint (`workspace_id` field): tenant-A reads its own canary
(≥1); **tenant-B reads tenant-A's canary → 0 (cross-tenant isolation holds)**; tenant-B cross-tenant
scoped-forget of A's mem → **404** (no leak); A's row **survives** B's delete attempt.

(An earlier harness pass used `workspaceId` camelCase — silently ignored, so both keys landed in
one workspace and "saw" each other; corrected to `workspace_id` and isolation is clean. Harness
bug, not a product leak.)

## Regression vs baseline

`API-SEC-77-PA` flips `fail → pass` vs run-5 (the #5 provisioning fix landed + verified). No
journey regressed pass→fail. Baseline updated for the rows re-asserted real this run.

## Repro

1. `cd theo-workspace && make up && make memory-up` (OPENAI_API_KEY from skill `.env`).
2. browser: dashboard → Memory → Playground (Chrome MCP).
3. http/cli/sdk/mcp/iso harnesses: see the run's scratch scripts (data plane :18081, pg :15432,
   real OpenAI, `OPENAI_BASE_URL` unset).

_No secrets (keys/tokens/cookies) were printed in this evidence; key values were never echoed._
