# Dogfood journey catalog

Machine-readable Source of Truth for the unified `/dogfood` runner+gate (ADR-0019). One row
per journey; `run_journey_audit.py` joins these rows against `knowledge-base/dogfood/evidence/`.
**Per Q1 (owner directive 2026-07-11) EVERY journey is `anchor: true`** — `EVIDENCE_SUFFICIENT`
requires every journey below to have fresh (`outcome: pass` + non-empty `oracle_result`) evidence.

Columns: `id | surface | title | anchor | oracle`. The `oracle` is the machine-observable proof
recorded in each evidence file's `oracle_result:` (suite exit code / HTTP status+shape / Chrome
`evaluate_script` return). Per-journey human steps + the exact oracle live in the surface driver
(`.claude/skills/dogfood/drivers/{sdk,api,mcp,ui}.md`); this file is the index + anchor flags.

## SDK surface

| id | surface | title | anchor | oracle |
|---|---|---|---|---|
| J-SDK-1 | SDK | remember → recall round-trip (user scope) | true | integration suite `tests/integration/*remember*` exit 0 + recalled item in top-k |
| J-SDK-2 | SDK | 3-tier scope isolation (user/session/agent) | true | recall in one tier does not return another tier's rows |
| J-SDK-3 | SDK | forget (soft) + hard (GDPR) | true | soft sets `t_invalid`; hard removes row + entity FK |
| J-SDK-4 | SDK | reflect (consolidation) | true | `tests/integration/reflection` exit 0 + ≥1 derived row with provenance |
| J-SDK-5 | SDK | skills repo-scope add/recall/consolidate/forget | true | 2 equivalent skills → consolidate → 1 derived with both source ids |
| J-SDK-6 | SDK | entities + graph traversal (+asOf) | true | `tests/integration/entities` exit 0; graph hop-2 honors `t_invalid`/asOf |
| J-SDK-7 | SDK | episodes | true | episode written + listed under the scope |
| J-SDK-8 | SDK | bi-temporal asOf recall | true | `recall({asOf})` returns the state valid at the instant |
| J-SDK-9 | SDK | attributedTo multi-peer | true | recall filters by `attributedTo` peer id |
| J-SDK-10 | SDK | eviction + long-tail forgetting | true | `tests/integration/{eviction,forgetting}` exit 0; rare-isolated survives ≥5 LRU |
| J-SDK-11 | SDK | distillation episodic→semantic | true | `tests/integration/distillation` exit 0; conflict resolved |
| J-SDK-12 | SDK | recall cache | true | 2nd near-duplicate query served from cache (hit metric > 0) |

### Steps (SDK)

Each J-SDK journey runs its named integration suite against real `ankane/pgvector:v0.5.1`
(`THEOMEM_PG_URI` set) and records the suite's exit code + the key assertion value as
`oracle_result`. Where no suite exists (J-SDK-7/8/9), the driver runs a real SDK snippet and
records the returned row/flag. Details: `drivers/sdk.md`.

## API surface (includes the `themory` CLI verbs — Q2)

| id | surface | title | anchor | oracle |
|---|---|---|---|---|
| J-API-1 | API | REST remember/recall/forget/reflect round-trip (bearer) | true | HTTP 200 + body shape per verb |
| J-API-2 | API | scopes memories/entities/graph/episodes/metrics listing | true | GET 200 + non-empty projection for a seeded scope |
| J-API-3 | API | auth — api-key (theo_live_*) + OIDC + fail-closed 401 | true | theo_live_* → 200; missing → 401; non-theo_live → OIDC path |
| J-API-4 | API | admin key lifecycle (create/list/rotate/revoke) + members RBAC | true | mint → list → rotate → revoke each 2xx; RBAC 403 on under-scope |
| J-API-5 | API | health/health-db warmup 503 → 200 | true | `/v1/health` 503 while warming then 200 |
| J-API-6 | API | graph includeSuperseded (M1) + entities summary (M2) via REST | true | default hides superseded; `?includeSuperseded=true` surfaces it with active flag; entity summary non-empty |
| J-CLI-1 | API | `themory {remember,recall,forget,reflect,keys,health}` verbs | true | each verb exit 0 + expected stdout shape |

### Steps (API)

Real `curl` against the `themory server` (`:18081`) as a human, with a minted `theo_live_*` key;
each journey asserts HTTP status + body shape and records them as `oracle_result` (key prefixes
only — EC-2 redaction). CLI verbs run against the built `themory` bin. Details: `drivers/api.md`.

## MCP surface

| id | surface | title | anchor | oracle |
|---|---|---|---|---|
| J-MCP-1 | MCP | native tools remember/recall/forget/reflect (stdio) | true | real MCP client stdio round-trip returns the 4 tools + a recall hit |
| J-MCP-2 | MCP | native streamable-http + bearer | true | tools/list over http with bearer succeeds |
| J-MCP-3 | MCP | OpenMemory compat SSE (add/search/list/delete) | true | `tests/integration/openmemory` exit 0; 4 OpenMemory tool names |
| J-MCP-4 | MCP | per-user isolation (IDOR closed) | true | user A cannot read/delete user B's memory (404/empty, no leak) |

### Steps (MCP)

Real `@modelcontextprotocol/sdk` client drives the `themory mcp` server (native + `--compat
openmemory`); records the tool list + round-trip result as `oracle_result`. Details: `drivers/mcp.md`.

## UI surface (theo-cloud dashboard, cross-repo)

| id | surface | title | anchor | oracle |
|---|---|---|---|---|
| J-UI-1 | UI | login (Kratos) | true | `/sessions/whoami` returns identity.id |
| J-UI-2 | UI | Memory Overview counters | true | `evaluate_script` reads total/add/entities counts > 0 |
| J-UI-3 | UI | Memories tab (list/browse) | true | table renders ≥1 seeded memory row |
| J-UI-4 | UI | Episodes tab | true | episodes list renders |
| J-UI-5 | UI | Playground remember + recall live | true | live remember then recall returns the fact |
| J-UI-6 | UI | Entities tab — M2 summary column | true | `evaluate_script` SUMMARY cell contains the evolving summary text |
| J-UI-7 | UI | Graph tab — M1 superseded toggle | true | relations count increments when "Include superseded edges" toggled |
| J-UI-8 | UI | Skills tab (browse + curate) | true | skills list renders; delete-skill curation works |
| J-UI-9 | UI | Exports / Webhooks | true | tab renders without error |

### Steps (UI)

Bring up the theo-cloud dev-stack (`make dev-up` + the recipe gotchas), log in as the seeded
`dev@theo.local`, seed the user's workspace with real OpenRouter facts, then drive real Chrome via
chrome-devtools MCP per tab; each journey records a `evaluate_script` observation + a screenshot
path as `oracle_result`. Details: `drivers/ui.md`.

## Legacy anchor mapping (EC-1 — no silent swap)

The pre-existing anchor scenario `claude-code-auto-memory` is preserved as an anchor journey:
its existing evidence files (frontmatter `scenario: claude-code-auto-memory`) are matched via the
`aliases:` field so the audit still honors them.

```yaml
aliases:
  J-SDK-1: [claude-code-auto-memory]   # the legacy Claude-Code-auto-memory anchor maps here
```
