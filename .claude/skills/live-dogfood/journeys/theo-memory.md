# Journey catalog — theo-memory (100% surface)

The authoritative, multi-modal map of every theo-memory surface the `/live-dogfood`
harness validates. One row per journey. The harness reads this file, drives each row in
its **modality**, asserts, captures evidence, and keys the regression baseline off the row
`id`. To reach 100%, every surface point below has ≥ 1 row; security-critical rows carry
both lenses (edge + negative).

## Legend

**Modality** (which driver runs it):
- `browser` — Chrome DevTools MCP, the real dashboard UI (the human path).
- `http` — direct REST call against the data plane / edge.
- `mcp` — a real MCP client over stdio / SSE / streamable-http against `themory mcp`.
- `cli` — `themory <verb>` subprocess, assert stdout/exit.
- `sdk` — `node -e` import + round-trip against a published subpath.

**Lens** (`rules/testing.md` § 4.1): `journey` (happy), `edge` (extreme of valid),
`negative` (invalid → typed error), `isolation` (cross-tenant), `security` (authz/#77).

**Surface coverage target:** REST 32 routes · MCP 9 tools × 3 transports · CLI ~10 verbs ·
SDK 8 subpaths · UX 9 memory tabs + auth. A row marked `[CRIT]` makes the run `FAIL` (not
`partial`) if it fails.

---

## § A — UX (browser / Chrome DevTools MCP) — the human path

| id | lens | tab / page | steps → assertion |
|---|---|---|---|
| `UX-AUTH-1` | journey | /register → /login | register ephemeral identity → active session → dashboard renders; `/sessions/whoami` 200 |
| `UX-AUTH-2` | negative | /login | wrong password → inline error, no session, no enumeration leak |
| `UX-AUTH-3` | journey | /memory verify banner | "Verify your email" present but browseable (dev) |
| `UX-OVW-1` | journey | /memory (Overview) | KPIs render; `GET …/memory/metrics` 200 |
| `UX-MEM-1` | journey | /memory/memories | list renders the user's memories; pagination works |
| `UX-MEM-2` | edge | /memory/memories | empty state (new user) renders without error |
| `UX-EPI-1` | journey | /memory/episodes | episodic log renders (cursor pagination) |
| `UX-PLG-1` | journey | /memory/playground | Remember a unique canary → toast "Stored…"; `POST …/remember` 201 `[CRIT]` |
| `UX-PLG-2` | journey | /memory/playground | Recall loosely-related query → returns the canary with a score; `POST …/recall` 200 `[CRIT]` |
| `UX-PLG-3` | journey | /memory/playground | Run reflection → completes, no UI error |
| `UX-PLG-4` | edge | /memory/playground | Recall empty/whitespace query → graceful (no 500) |
| `UX-PLG-5` | edge | /memory/playground | Remember very long + unicode text → stored + recallable |
| `UX-PLG-6` | journey | /memory/playground | Recall with `asOf` (bi-temporal) → time-scoped result |
| `UX-ENT-1` | journey | /memory/entities | entities aggregation renders (real counts) |
| `UX-GRF-1` | journey | /memory/graph | `{nodes,edges}` graph renders |
| `UX-SKL-1` | journey | /memory/skills | Repo-tier skills listing renders |
| `UX-SKL-2` | journey | /memory/skills | delete (curate) a skill → gone on refresh |
| `UX-EXP-1` | journey | /memory/exports | exports surface renders / triggers an export |
| `UX-WHK-1` | journey | /memory/webhooks | webhooks surface renders / CRUD a webhook |
| `UX-KEY-1` | journey | /api-keys | create an API key → `theo_live_*` shown once; list updates |

## § B — REST API (http) — all 32 routes

### Data verbs + scopes (read/write/delete)
| id | lens | route | assertion |
|---|---|---|---|
| `API-REM-1` | journey | POST /v1/remember | 201, returns stored item |
| `API-REC-1` | journey | POST /v1/recall | 200, semantic match returned |
| `API-FGT-1` | journey | POST /v1/forget | 2xx, memory gone |
| `API-RFL-1` | journey | POST /v1/reflect | 2xx, reflection job |
| `API-SCM-1` | journey | GET /v1/scopes/:type/:id/memories | 200 list |
| `API-SEP-1` | journey | GET /v1/scopes/:type/:id/episodes | 200 `{items,nextCursor?}` |
| `API-SMT-1` | journey | GET /v1/scopes/:type/:id/metrics | 200 real counters |
| `API-SEN-1` | journey | GET /v1/scopes/:type/:id/entities | 200 entities |
| `API-SGR-1` | journey | GET /v1/scopes/:type/:id/graph | 200 `{nodes,edges}` |
| `API-SKL-1` | journey | GET /v1/scopes/skill/:repoId/skills | 200 skills listing |
| `API-SKA-1` | journey | GET /v1/scopes/skill/:subject/all | 200 cross-repo flat list |
| `API-SKP-1` | journey | POST /v1/scopes/skill/:repoId/skills | 201 skill created |
| `API-SKD-1` | journey | DELETE /v1/scopes/skill/:repoId/skills/:skillId | 204 |
| `API-SKX-1` | journey | POST /v1/scopes/skill/:repoId/skills/:skillId/execute | 200 or 501 (gated) |
| `API-SFG-1` | journey | DELETE /v1/scopes/:type/:id/memories/:memId | 204 (own); 404 (cross-scope, no leak) |
| `API-SFG-2` | negative | DELETE /v1/scopes/:type/:id/memories/:memId | bad id → 422 typed error |
| `API-REM-NEG` | negative | POST /v1/remember | malformed body → 422 typed code (never 500) |
| `API-REC-NEG` | negative | POST /v1/recall | bad threshold/limit → 422 |
| `API-AUTH-NEG` | negative | POST /v1/remember (no bearer) | 401 + `WWW-Authenticate: Bearer` |
| `API-SEC-77-W` | security | POST /v1/remember w/ **read-only** key | 403 INSUFFICIENT_SCOPE `[CRIT]` |
| `API-SEC-77-PA` | security | POST /v1/remember w/ **platform-admin** key | 403 (platform-admin ⊅ data) `[CRIT]` |
| `API-SEC-77-R` | security | POST /v1/recall w/ read-only key | NOT 403 (per-verb) `[CRIT]` |

### Admin key lifecycle (gated `memory:admin`)
| id | lens | route | assertion |
|---|---|---|---|
| `API-KEY-MINT` | journey | POST /v1/admin/keys | 200 mints `theo_live_*` |
| `API-KEY-MINT-WS` | journey | POST /v1/admin/keys (target workspace_id, platform-admin) | 200 + workspace auto-provisioned |
| `API-KEY-ESC` | security | POST /v1/admin/keys mint platform-admin w/o holding it | 403 INSUFFICIENT_SCOPE_FOR_MINT `[CRIT]` |
| `API-KEY-LIST` | journey | GET /v1/admin/keys/list | 200 |
| `API-KEY-ROT` | journey | POST /v1/admin/keys/:id/rotate | 2xx; old key invalid after |
| `API-KEY-REV` | journey | DELETE /v1/admin/keys/:id | 2xx; key denied after |
| `API-KEY-LIN` | journey | GET /v1/admin/keys/:id/lineage | 200 lineage |

### RBAC members (gated `requireRole('admin')`)
| id | lens | route | assertion |
|---|---|---|---|
| `API-MEM-LIST` | journey | GET /v1/members | 200 (admin/owner) |
| `API-MEM-ADD` | journey | POST /v1/members | 2xx adds member |
| `API-MEM-ROLE` | journey | PATCH /v1/members/:userId | 2xx role change |
| `API-MEM-DEL` | journey | DELETE /v1/members/:userId | 2xx; last-owner → 409 |
| `API-MEM-NEG` | security | GET /v1/members as `member` | 403 INSUFFICIENT_ROLE `[CRIT]` |

### Health / meta
| id | lens | route | assertion |
|---|---|---|---|
| `API-HLT-1` | journey | GET /v1/health | 200 (auth-exempt) |
| `API-HLT-2` | journey | GET /v1/health/db | 200 / 503 warming |
| `API-WK-1` | journey | GET /.well-known/oauth-protected-resource | 200 (or 404 if no oidc) |
| `API-OAS-1` | journey | GET /v1/openapi.json | 200 valid OpenAPI 3.1 |

## § C — MCP (mcp client: stdio / SSE / streamable-http)

| id | lens | transport · tool | assertion |
|---|---|---|---|
| `MCP-LIST` | journey | stdio · tools/list | exactly the native toolset (remember/recall/forget/reflect/episodes) |
| `MCP-REM` | journey | stdio · remember | tool call ok; memory stored |
| `MCP-REC` | journey | stdio · recall | returns the stored memory (structuredContent) |
| `MCP-FGT` | journey | stdio · forget | removes it |
| `MCP-RFL` | journey | stdio · reflect | reflection runs |
| `MCP-EPI` | journey | stdio · episodes | cursor-paginated episodic list |
| `MCP-SCOPE` | security | stdio · recall (no scope arg) | scope is bound from ctx, not spoofable from args `[CRIT]` |
| `MCP-OM-LIST` | journey | SSE · tools/list (`--compat openmemory`) | exactly add_memories/search_memory/list_memories/delete_memories |
| `MCP-OM-ADD` | journey | SSE · add_memories | stores |
| `MCP-OM-SRC` | journey | SSE · search_memory | finds |
| `MCP-OM-LST` | journey | SSE · list_memories | lists own |
| `MCP-OM-DEL` | security | SSE · delete_memories (cross-user id) | denied — per-user isolation (IDOR closed) `[CRIT]` |
| `MCP-HTTP` | journey | streamable-http · remember+recall | round-trip over HTTP transport |
| `MCP-AUTH` | security | streamable-http (`--auth=api-keys`) no/bad token | rejected; non-localhost without TLS guarded `[CRIT]` |

## § D — DX · CLI (subprocess `themory`)

| id | lens | command | assertion |
|---|---|---|---|
| `CLI-HLP` | journey | `themory --help` | boots env-free; lists verbs |
| `CLI-REM` | journey | `themory remember <text> --user u` | 0; stored |
| `CLI-REC` | journey | `themory recall <q> --user u --top-k 3 --json` | 0; JSON results |
| `CLI-FGT` | journey | `themory forget <id> --hard` | 0; removed |
| `CLI-RFL` | journey | `themory reflect --user u` | 0 |
| `CLI-FLAGS` | edge | `--session` / `--agent` / `--threshold` / `--diversify` / `--text` | each honored |
| `CLI-KEY-C` | journey | `themory keys create --scopes …` | 0; prints `theo_live_*` once |
| `CLI-KEY-L` | journey | `themory keys list` | 0; lists (redacted) |
| `CLI-KEY-RT` | journey | `themory keys rotate <id>` | 0 |
| `CLI-KEY-RV` | journey | `themory keys revoke <id>` | 0 |
| `CLI-MIG` | journey | `themory migrate` | applies pending migrations |
| `CLI-HLT` | journey | `themory health --deep` | embedder+LLM smoke |
| `CLI-NEG` | negative | `themory recall` (missing required) | non-zero + clear stderr (not a stack trace) |

## § E — DX · SDK (import smoke + round-trip)

| id | lens | subpath | assertion |
|---|---|---|---|
| `SDK-CORE` | journey | `@usetheo/memory` (barrel) | import + `remember→recall` round-trip top-3 |
| `SDK-CONTRACT` | journey | `@usetheo/memory/contract` | types/DIP interfaces resolve |
| `SDK-THEOKIT` | journey | `@usetheo/memory/theokit` | `memoryFromCtx` auto-scopes |
| `SDK-CACHE` | journey | `@usetheo/memory/cache-pg` | bundle-isolated import (no barrel pull) |
| `SDK-EMB` | journey | `@usetheo/memory/embedders` | local transformer dim probe |
| `SDK-LLM` | journey | `@usetheo/memory/llms` | provider import |
| `SDK-ADPT` | journey | `@usetheo/memory/adaptive-local` | import |
| `SDK-RRK` | journey | `@usetheo/memory/reranker-local` | import |

## § F — Cross-cutting

| id | lens | what | assertion |
|---|---|---|---|
| `XISO-1` | isolation | two tenants via the real edge | tenant-A cannot read tenant-B (and B reads own) `[CRIT]` |
| `XISO-2` | isolation | cross-tenant scoped-forget | 404, victim row survives (IDOR closed) `[CRIT]` |
| `XREG-1` | regression | baseline diff | no journey flipped pass→fail |
| `XDX-1` | DX-pain | honest observations | log anything that worked but felt wrong (the dogfood signal) |

---

## Coverage ledger (keep at 100%)

| Surface | Total | Rows here | Status |
|---|---|---|---|
| REST routes | 32 | 36 (incl. negatives/security) | ✅ every route ≥ 1 row |
| MCP tools | 9 (5 native + 4 OpenMemory) | 14 (× 3 transports + auth) | ✅ |
| CLI verbs | ~10 | 13 | ✅ |
| SDK subpaths | 8 | 8 | ✅ |
| UX memory tabs + auth | 9 + auth | 20 | ✅ |

When a new surface ships (route / tool / tab / subpath), add its row here in the SAME PR —
the ledger is the contract; a surface without a row is an untested surface.
