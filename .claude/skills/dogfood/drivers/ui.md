# Dogfood driver — UI surface (theo-cloud dashboard, cross-repo)

> Tells Claude Code how to execute each J-UI-* journey from `knowledge-base/dogfood/journeys.md`
> AS A HUMAN — driving the REAL theo-cloud dashboard in real Google Chrome via chrome-devtools MCP.
> Records one evidence file per journey (frontmatter per `dogfood-golden-rule.md § 5`): each
> `oracle_result` is a `evaluate_script` observation + a screenshot path. Secrets redacted to
> `theo_live_`/`sk-or-` + ≤4 chars (EC-2) — never a full key/OpenRouter key in evidence.

## Dev-stack bring-up (cross-repo) — the runbook (session recipe `themory-dashboard-openrouter-uitest-recipe`)

From `theo-cloud/theo-cloud/`: `make dev-up` with `OPENAI_API_KEY=sk-or-… OPENAI_BASE_URL=https://openrouter.ai/api/v1`
exported (real OpenRouter LLM). Gotchas that each cost real debugging — honor them:

1. **Embedder dim MUST match the DB dim** or `remember()` silently returns `{"items":[]}` (fail-soft
   swallows the pgvector dimension-mismatch). Use `THEOMEM_EMBEDDER=local` (384) + `THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE=1` so the 1536→384 migration runs; OpenRouter has chat, NOT `/embeddings`.
2. **`OPENAI_CHAT_MODEL=openai/gpt-4o-mini`** (with the `openai/` prefix) — the bare name 404s → empty extraction.
3. Recreate containers **WITH deps** (`docker compose up -d --wait <svc>`), never `--no-deps --force-recreate` (corrupts the network → `EAI_AGAIN`).
4. Gateway needs a non-empty **`THEMORY_PLATFORM_ADMIN_KEY`** (mint via bootstrap `POST /v1/admin/keys {scopes:["memory:platform-admin"]}`), else Model B fails closed.
5. **register-proxy is broken** in the dev-stack (`APP_PUBLIC_URL=localhost:5173` unreachable from the container) → log the defect + reuse the seeded `dev@theo.local` / `DevPassw0rd!2026` instead of registering (Q4).
6. Seed the logged-in user's workspace: tenant from pg-cloud `SELECT tenant_id FROM tenant_members WHERE user_id='<kratos identity.id>'`; mint a data key for that workspace; `remember(userId=<identity.id>, …)` real OpenRouter facts.
7. **Chrome MCP reconnect (non-destructive):** launch a SEPARATE-profile Chrome (`--user-data-dir=/tmp/… --remote-debugging-port=9222`) — do NOT kill the operator's personal Chrome — then repoint `DevToolsActivePort`.
8. The Step-5 code-quality gate false-positives offline: `CODE_QUALITY_NO_NETWORK=1`.

## On failure (EC-8 — every journey)

Oracle unresolvable / a tab errors → `outcome: fail reason=oracle_unresolvable` (or the real reason),
never a silent skip. A red tab is a finding (e.g. the register-proxy defect above).

## Per-journey protocol (drive Chrome via chrome-devtools MCP)

| Journey | Steps (human) | Oracle (`oracle_result` via `evaluate_script` + screenshot) |
|---|---|---|
| J-UI-1 | open `:5173/login`, log in as `dev@theo.local` | `evaluate_script`: `/sessions/whoami` returns `identity.id` |
| J-UI-2 | open Memory → Overview | `evaluate_script` reads total/add/entities counts > 0 |
| J-UI-3 | Memory → Memories tab | table renders ≥1 seeded memory row |
| J-UI-4 | Memory → Episodes tab | episodes list renders |
| J-UI-5 | Memory → Playground: remember then recall live | live recall returns the just-remembered fact |
| J-UI-6 | Memory → Entities tab | `evaluate_script`: SUMMARY cell contains the evolving summary text (M2) |
| J-UI-7 | Memory → Graph tab; toggle "Include superseded edges" | relations count increments when toggled (M1 superseded surfaces) |
| J-UI-8 | Memory → Skills tab | skills list renders; delete-skill curation works |
| J-UI-9 | Memory → Exports / Webhooks tab | tab renders without error |

## Evidence template

```yaml
---
journey: J-UI-<N>
date: <today>
operator: claude-code
outcome: pass | partial | fail
oracle_result: "<evaluate_script observation>; screenshot=<scratchpad path>"
summary: <one line>
---
```
