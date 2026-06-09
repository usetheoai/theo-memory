<div align="center">

<img src="https://usetheo.dev/logo-128.webp" alt="Theo" width="96" height="96" />

**`@usetheo/memory`** · the **managed memory** auxiliary of the [Theo ecosystem](https://usetheo.dev)

# Memory that lives where your agent lives.

A managed memory layer for AI agents — **three tiers (User, Session, Agent)**, Mem0-shaped retrieval, **native to [TheoKit](../theokit), managed by [TheoCloud](../theo)**. The persistent-state verb of **Chat. Build. Deploy.**

*Vector + hybrid retrieval + LLM fact extraction. Local mode for dev. Cloud runtime for production. Apache-2.0.*

[![License](https://img.shields.io/badge/license-Apache--2.0-7C3AED?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.8%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Status](https://img.shields.io/badge/status-pre--release-orange?style=flat-square)](#status)
[![Runtime](https://img.shields.io/badge/runtime-local%20%2B%20TheoCloud-7C3AED?style=flat-square)](#two-runtimes-one-api)

[Quickstart](#quickstart) · [Three Tiers](#three-tiers) · [Why](#why-usetheomemory) · [Runtimes](#two-runtimes-one-api) · [Architecture](#architecture) · [Status](#status)

</div>

---

## The shift

There is a version of your agent that remembers who its users are.

It does not greet returning customers as strangers. It does not re-ask the dietary restriction it learned last Tuesday. It does not forget — between yesterday's deploy and today's — the playbook it spent an hour figuring out. The session ends. The user, and the agent, do not.

And the place that **deploys** the agent is the same place that **remembers** for it. One account. One dashboard. One platform.

`@usetheo/memory` is the managed memory layer for the [TheoKit](../theokit) + [TheoCloud](../theo) agent stack — three tiers, Mem0-shape architecture, Apache-2.0-licensed SDK, with a local mode for development and a managed runtime in TheoCloud for production.

## Why `@usetheo/memory`

The agentic-memory space is **crowded and well-funded** — Mem0 ($24M, ~56k stars), Letta ($10M, ~23k stars), Zep/Graphiti (YC W24, ~26k stars), Honcho ($5.35M), Cognee, LangMem. Each carries a strong opinion on architecture and a strong opinion on lock-in.

`@usetheo/memory` is not trying to win on benchmarks against players with two years of head start. It is trying to be **the memory line item on your TheoCloud invoice** — the managed memory that ships with the platform you already deploy on.

If [Vercel KV](https://vercel.com/storage/kv) is "the key-value store that ships with the framework", `@usetheo/memory` is **the memory store that ships with the agent platform**. Same idea: deep coupling as a feature, not an apology.

| Capability | `@usetheo/memory` | Mem0 | Letta | Zep / Graphiti | LangMem |
|---|---|---|---|---|---|
| **Frame** | The managed memory of TheoCloud, optimized for TheoKit | Framework-agnostic drop-in SDK | Stateful agent runtime + memory | Bi-temporal knowledge graph | LangGraph memory store |
| Architecture | Mem0-shape: vector + LLM extraction + hybrid retrieval (semantic + BM25 + entity matching) | Same — pioneered the shape | OS-hierarchical (RAM + disk paging) | Temporal knowledge graph | Three-type semantic / episodic / procedural |
| User memory (semantic, cross-session) | ✓ | ✓ | ✓ (core blocks) | ✓ | ✓ |
| Session memory (episodic, scoped) | ✓ | ✓ | Implicit (single thread) | ✓ (episodes) | ✓ |
| Agent memory (procedural, learned skills) | ✓ (Voyager-shaped) | Limited | Limited (core blocks) | Limited | ✓ (prompt rewriting) |
| Local runtime (dev / CI) | ✓ Postgres + pgvector | ✓ self-host | ✓ Postgres + pgvector | Self-host Neo4j etc. | LangGraph `BaseStore` |
| Managed runtime | **TheoCloud — single platform for deploy + memory** | Mem0 Cloud (separate account) | Letta Cloud (separate account) | Zep Cloud (separate account) | LangGraph Platform |
| Framework coupling | **Native to TheoKit by design** | Framework-agnostic | High (Letta owns the agent loop) | Framework-agnostic | High (LangGraph) |
| License | **Apache-2.0** | Apache-2.0 | Apache-2.0 | Apache-2.0 (Graphiti) | MIT |
| Single-vendor consolidation | **Yes** — same dashboard as your deploy | No (Mem0 Cloud is separate) | No | No | No |

Mem0 won drop-in. Letta won the self-editing agent. Zep won bi-temporal auditing. **`@usetheo/memory` is the option you reach for when you have already chosen TheoKit + TheoCloud** — and you want memory on the same invoice, same dashboard, same access control, same support contract.

If you are not on TheoKit, [Mem0](https://mem0.ai) is a great pick.

## Three tiers

Three memory scopes, one API. The taxonomy follows cognitive psychology (episodic, semantic, procedural) mapped onto the surface a real agent needs.

| Tier | Scope | Lifetime | Example |
|---|---|---|---|
| **User memory** | One user, across every session and every agent in the workspace | Durable | "Speaks Portuguese. Lives in São Paulo. Allergic to peanuts." |
| **Session memory** | One conversation thread | Window-bounded | "User asked about pricing tier B in turn 3. We promised a callback." |
| **Agent memory** | One agent, learned procedurally over many runs | Durable | "When the user types `/refund`, check the last 3 invoices before opening a ticket." |

Same `remember` / `recall` / `forget` / `reflect` verbs across all three tiers — the scope is a parameter, not three separate APIs.

## What you'd ship

- **Customer support assistant that knows the user.** Past tickets, dietary restrictions, account tier, prior escalations — recalled without a separate CRM lookup.
- **Healthcare intake bot.** Patient preferences, medication allergies, communication style persist across visits. Session memory bounded by appointment.
- **Productivity copilot.** Adapts to the user's writing voice, project conventions, and recurring workflows. Agent memory accumulates the playbooks that worked.
- **Coding agent with project memory.** Per-repo skill library — fix recipes, file conventions, migration patterns — accumulates across PRs. Voyager-shaped procedural memory tied to a real workspace.
- **Multi-tenant agent SaaS.** Workspace-scoped isolation; user identity, session state, and agent skills never cross tenants. Native to TheoKit's per-request context.
- **Game NPC with continuity.** Player history, in-game decisions, and emergent NPC personality survive session restarts.

---

## How it works

Below this line, full technical vocabulary is in play. Installation, the two runtimes, the planned API contract, the three tiers in code, architecture, and status.

## Foundational principles

Three principles anchor every design decision in TheMemory — schema, API contract, retrieval policy, scoring heuristics. When a technical choice conflicts with a principle, the principle wins.

### Princípio 1 — Nem toda memória tem o mesmo peso.

Relevance is a continuous score, not a boolean. The system composes orthogonal signals:

- **Frequency / confirmation** — `confirmation_count` bumps when the same fact is asserted under the same scope (composite UPSERT per ADR D5; surfaces via `MemoryItem.confirmationCount`).
- **Recency** — `last_accessed_at` + `created_at` feed exponential decay via `half_life_seconds` (v0.4b forgetting pipeline).
- **Confidence** — `llm_importance_score` cached by the LLM extraction (v0.4a).
- **Semantic similarity** — cosine over embeddings (Mem0-shape 9-step search).
- **BM25 + entity boost** — lexical and structural signals composed additively.

The system does NOT treat each `remember()` call as an isolated event. When the same fact arrives from different sources or at different moments, the confirmation signal is reinforced and becomes queryable (`WHERE confirmation_count > N`) for filtering, ranking, and audit.

### Princípio 2 — Priorização e diversidade valem mais que volume.

Recalling 5 right and varied memories is worth more than recalling 50 near-paraphrases. The recall pipeline reflects this by design:

- **Semantic threshold** gates BEFORE additive combination (`score = (semantic + bm25 + entity) / max_possible`) — sub-threshold dropped, not weighted.
- **Top-K cap** bounds the raw result set.
- **MMR diversify (opt-in)** — `RecallOptions.diversify` applies Maximal Marginal Relevance rerank between score-combine and top-K, reducing redundancy without sacrificing relevance (ADR D3 + EC-3 boundary validation: throws on `lambda ∉ [0, 1]`).
- **Triadic eviction (v0.4b)** — when capacity saturates, the eviction policy composes Ebbinghaus + LRU + LLM-importance and protects the long-tail (`rare-isolated` survives ≥ 5 LRU passes).

The contract favors information density over raw coverage. Volume without prioritization is noise.

### Princípio 3 — Memória precisa ser auditável.

Every decision to record, ignore, deduplicate, expire, or substitute a memory is OBSERVABLE and TRACEABLE. IGNORE is never silent:

- **`MEMORY_EVENTS` typed union** (16 literals) — each phase of write / recall / reflect emits a typed OTel event via `emitEvent(tracer, ...)`. Includes `extraction_zero_facts` (LLM produced nothing), `dedup_collision_confirmed` (UPSERT bumped `confirmation_count`), `recall_threshold_filtered` (N sub-threshold candidates dropped) — the 3 IGNORE decisions that used to be silent.
- **`MemoryItem.rejectedAsDuplicate`** — consumer-visible flag: when `remember()` returns the EXISTING row after dedup-collision, the consumer KNOWS.
- **Audit tables** — `history` records remember/forget; `consolidation_history` records reflect with FK `ON DELETE SET NULL` for GDPR survival; `MemoryItem.derivedFrom` carries provenance for derived memories (v0.4a reflection, v0.7 distillation).
- **Bi-temporal `t_valid` + `t_invalid`** — `recall({ asOf })` returns the valid state at any historical instant (v1.1 supersedes the ADR-0006 runtime clause).

Traceability is part of the contract, not optional. Every decision to write / ignore / substitute must be justifiable and reviewable.

## Quickstart (v0.1 local runtime)

> **Pre-release.** Not production-ready. Status: dogfooding via the `/dogfood` gate. The embedding dimension is capped at **1536** at v0.1 (see plan ADR D1.7 in `.claude/knowledge-base/plans/v0-1-local-runtime-plan.md`).

The v0.1 local runtime ships as: TypeScript library + Postgres + pgvector container + your-supplied LLM and Embedder.

### Prerequisites

`npm run db:push` requires the following dev tools on `PATH`:

- **Node.js** 20.x or later (matches `package.json#engines.node`)
- **Docker** + **docker compose** v2 (for the `pgvector` container)
- **psql** — PostgreSQL 14+ client tools. `db:push` invokes `psql` directly to apply trigger-bearing migrations (e.g. `0004_eviction_half_life_trigger.sql`) because Drizzle ORM does not model triggers in its schema language. If `psql` is missing, the script aborts with a clear message pointing back at this section.

### Wiring

```bash
# 1. Boot the local pgvector container
docker compose up -d pgvector
# (port conflict on 5432? POSTGRES_PORT=5433 docker compose up -d pgvector — see .env.example)

# 2. Set the connection env var (matches docker-compose.yaml defaults)
export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem

# 3. Enable pgvector + push schema (dev — uses drizzle-kit push; production should
#    instead run npm run db:generate + apply the SQL migrations via the Drizzle
#    migrator at app boot)
psql $THEOMEM_PG_URI -c "CREATE EXTENSION IF NOT EXISTS vector"
npm run db:push -- --force
```

Minimum usage from TypeScript:

```ts
import { createMemory, PgvectorStore, DrizzleHistoryManager } from '@usetheo/memory'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { OpenAILLM, OpenAIEmbedder } from './your-providers' // consumer-supplied

const pool = new pg.Pool({ connectionString: process.env.THEOMEM_PG_URI! })
const db = drizzle(pool)

const memory = await createMemory({
  vectorStore: new PgvectorStore(pool),
  embedder: new OpenAIEmbedder({ model: 'text-embedding-3-small', dimensions: 1536 }),
  llm: new OpenAILLM({ model: 'gpt-4o-mini' }),
  historyManager: new DrizzleHistoryManager(db),
})

// Write
await memory.user('alice').remember('Paulo likes coffee')

// Read
const results = await memory.user('alice').recall('beverages', { topK: 3 })
// → MemoryItemWithScore[] sorted by combined score (semantic + BM25 + entity boost)
```

**Important constraints at v0.1:**

- Embedder MUST return 1536-dim vectors (`createMemory` probes at startup; mismatched dim throws `EmbeddingMismatch` immediately).
- `forget(unknown_id)` throws `MemoryNotFound` (divergence from Mem0's silent no-op).
- `reset({})` throws `InvalidScope` — explicit scope key required (prevents accidental wipe).
- `recall({ asOf })` throws `BiTemporalNotSupportedLocally` — bi-temporal queries land in the cloud runtime at v0.5.
- `reflect()` throws `ReflectionNotConfigured` — reflection algorithm lands at v0.4a (roadmap Item 5).

For the full Quickstart end-to-end test, see `tests/integration/local-runtime.test.ts`.

## Agent loops via MCP (v0.3 — `@usetheo/memory/agent-tools`)

`@usetheo/memory/agent-tools` exposes `remember/recall/forget/reflect` as an MCP server (Model Context Protocol per [spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)) consumable by any MCP-aware agent loop — Claude Desktop, Claude Code, Cursor, [`@usetheo/sdk`](../theokit-sdk) agents via their existing `mcpServers` config.

**Required environment variables (post-T3.2 — no stubs in production path):**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `THEOMEM_PG_URI` | **YES** | — | Postgres connection string (e.g., `postgresql://themem:themem@localhost:5432/themem`). |
| `OPENAI_API_KEY` | **YES** | — | OpenAI-compatible API key. Works for OpenAI proper AND for OpenRouter (see `OPENAI_BASE_URL` below). Without it the MCP server hard-fails at startup with exit code 2. |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | Set to `https://openrouter.ai/api/v1` to route LLM calls through OpenRouter (one key serves OpenAI + Anthropic + Mistral + others). |
| `OPENAI_CHAT_MODEL` | no | `gpt-4o-mini` | Model identifier for fact extraction. Honored by both direct OpenAI and OpenRouter. |
| `THEOMEM_MCP_DEFAULT_USER_ID` | no | — | Default scope binding for stdio callers that do not pass `_meta.io.usetheo.themory/user_id`. Required for Claude Code direct use. |

**Install as a stdio MCP server for Claude Code** via project-local `.mcp.json` (the canonical Claude Code mechanism).

A copy-and-fill template is committed at [`.mcp.json.example`](.mcp.json.example) — duplicate it as `.mcp.json` (gitignored), populate `OPENAI_API_KEY`, and restart Claude Code. The inline recipe below mirrors that template for reference:

```json
{
  "mcpServers": {
    "themory": {
      "command": "node",
      "args": ["/absolute/path/to/dist/agent-tools/cli.js", "mcp"],
      "env": {
        "THEOMEM_PG_URI": "postgresql://themem:themem@localhost:5432/themem",
        "THEOMEM_MCP_DEFAULT_USER_ID": "claude-code-my-project",
        "OPENAI_BASE_URL": "https://openrouter.ai/api/v1",
        "OPENAI_CHAT_MODEL": "openai/gpt-4o-mini",
        "OPENAI_API_KEY": "sk-or-..."
      }
    }
  }
}
```

After saving `.mcp.json`, RESTART Claude Code. The 4 tools (`mcp__themory__remember/recall/forget/reflect`) appear in the available-tools list once the server boots.

**Install as a stdio MCP server for other agents** (Claude Desktop, Cursor, `@usetheo/sdk`):

```json
{
  "servers": {
    "themory": {
      "command": "npx",
      "args": ["@usetheo/memory/agent-tools"],
      "env": {
        "THEOMEM_PG_URI": "postgresql://...",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

**Or HTTP** (TheoCloud v0.5 alignment; streamable-HTTP secondary transport per ADR D1):

```bash
THEOMEM_PG_URI=postgres://... \
  OPENAI_API_KEY=sk-... \
  THEOMEM_MCP_TRANSPORT=streamable-http \
  THEOMEM_MCP_HTTP_PORT=8080 \
  npx @usetheo/memory/agent-tools
```

**Tools exposed (exactly 4, per CLAUDE.md § Locked names):**

| Tool | Input | Output |
|---|---|---|
| `remember` | `{content, metadata?}` | text content "Memory persisted." |
| `recall` | `{query, topK?, threshold?}` | `structuredContent.results[]` of `{id, text, score, scope, createdAt, metadata}` |
| `forget` | `{id}` xor `{all: true}` | text content with forget status (bulk delete deferred to v0.4) |
| `reflect` | `{}` (strict empty) | text content with reflection count (algorithm lands v0.4a per Roadmap Item 5) |

**Error mechanisms per MCP spec § Error Handling:**

- **Protocol Errors** (JSON-RPC `error{}`): unknown tool → `-32601 Method not found`; malformed args → `-32602 Invalid params`; transport crash → `-32603 Internal error`.
- **Tool Execution Errors** (`result.isError: true`): `MissingScope`, `MemoryStoreError`, `EmbedderError`, `ContentTooLargeError`, and PG transient codes (`ECONNREFUSED`/`ETIMEDOUT`/etc.) — all surface with actionable text so the LLM can self-correct.

**Scope binding** flows through `AsyncLocalStorage` per ADR D3: the server reads request context, binds the active `ScopedContext`, and tool bodies resolve `memoryFromCtx(scope, memory)` from the v0.2 binding. Result: **zero cross-userId overlap** is the anchor metric (`tests/integration/agent-tools/the-goal.test.ts`).

**TLS:** v0.3 ships HTTP plaintext by design; production deployments expect to run behind a reverse proxy (nginx/caddy/Cloudflare) for TLS termination. TheoCloud handles this at the platform layer; do not expose port 8080 directly to public internet without TLS.

### Uniform Bearer auth across REST + MCP HTTP (FAANG-DX)

When `THEMEMORY_API_KEY` env is present and neither `--transport` flag nor `THEOMEM_MCP_TRANSPORT` env was set explicitly, `themory mcp` **auto-selects `--transport=streamable-http --auth=api-keys`** so the same `theo_live_*` bearer token authenticates REST (`@usetheo/memory/server` Item 16) AND MCP HTTP without the operator remembering which surface accepts which credential. Matches industry-standard SDK auth convention (env presence shifts behavior gracefully; explicit flags always win).

**`.mcp.json` template for the uniform-auth path:**

```json
{
  "mcpServers": {
    "themory": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer ${THEMEMORY_API_KEY}"
      }
    }
  }
}
```

**Precedence table (`@see ADR D1` of `themory-mcp-bearer-by-env-faang-plan.md`):**

| Tier | Source | Effect |
|------|--------|--------|
| 1 | `--transport` / `--auth` CLI flag | Always wins — most-specific operator intent |
| 2 | `THEOMEM_MCP_TRANSPORT` / `THEOMEM_MCP_AUTH` env (valid value) | Explicit env config |
| 3 | `THEMEMORY_API_KEY` env presence (non-empty after trim) | Heuristic → `streamable-http` + `auth=api-keys` |
| Fallback | (none of above) | `stdio` + `auth=none` (embedded subprocess use) |

Operator-observability: when the Tier-3 heuristic fires (or stdio default), `themory mcp` emits a one-line stderr disclosure announcing the selected pair. Set `THEOMEM_MCP_QUIET=1` to suppress the disclosure in embedded scenarios where the host captures stderr.

**WARNING — R4 mitigation:** If you use TheMemory ONLY via REST and `.mcp.json` is not pointing at TheMemory's MCP, do NOT add `THEMEMORY_API_KEY` to the `.mcp.json` env block of your MCP servers — a subprocess `themory mcp` invocation that inherits the env would AUTO-FLIP to HTTP and try to bind port 8080. To opt out explicitly when intentional, pass `--transport=stdio` or `--auth=none` on the CLI (both win Tier-1).



## REST API server (`@usetheo/memory/server`)

Standalone HTTP distribution surface for TheMemory — exposes the 4 verbs (`remember`/`recall`/`forget`/`reflect`) + health probes + paginated scope listing under `/v1/*`. Use it when your consumer is not Node.js (mobile apps, Python/Go/Rust services via OpenAPI codegen, admin dashboards, monitoring curl probes).

**Compose the server from a local memory factory:**

```ts
import { createMemory } from '@usetheo/memory';
import { createServer } from '@usetheo/memory/server';
import { serve } from '@hono/node-server';

const memory = await createMemory({ /* local runtime config */ });
const app = createServer({ memory });
serve({ fetch: app.fetch, port: 8080 });
```

**Bearer authentication** is opt-in via `THEMEMORY_API_KEY` env var (mirrors the `THEOKIT_API_KEY` convention per ADR-0009). When set, every `/v1/*` request requires `Authorization: Bearer <token>`:

```bash
curl -X POST http://localhost:8080/v1/remember \
  -H "Authorization: Bearer $THEMEMORY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","text":"prefers dark mode"}'
```

**OpenAPI 3.1 spec** auto-derived from the zod schemas at `GET /v1/openapi.json` — auth-exempt per EC-19 so codegen tools (openapi-generator, Postman, Swagger UI) can fetch the spec before having credentials.

**Observability:** every handler emits an OTel span (`rest.v1.remember`, `rest.v1.recall`, etc.) with `http.status_code`/`http.method`/`http.route` attributes. Pass a `Tracer` via `createServer({ memory, tracer })` to wire your provider; default falls through to the global no-op tracer at zero cost.

**ESM-only.** The subpath `@usetheo/memory/server` is ESM-only — matches the package's `"type": "module"`. CJS consumers (`require('@usetheo/memory/server')`) will see Node's standard ESM-resolution error.

**Body limit:** 1 MB cap on `/v1/*` POST endpoints (DOS guard via `hono/body-limit`; 413 response carries the structured `{code: 'CONTENT_TOO_LARGE', message: ...}` envelope). Compressed request bodies (`Content-Encoding: gzip`) are NOT auto-decompressed by Hono — operators serving large compressed payloads should enforce body limits at the reverse-proxy layer (nginx `client_max_body_size`, Caddy `request_body max_size`) for production deployments.

**Wiring real providers (post-T3.2 — no stubs in production path).** As of p0-api-sdk-mcp-correctness-audit T3.2 (mirror of MCP commit `e43d801`), BOTH `themory server` (REST) and `themory mcp` (MCP) hard-fail at startup when `OPENAI_API_KEY` is unset. Real providers wired by default: `LocalTransformerEmbedder` (Xenova MiniLM, 384-dim, keyless — `@xenova/transformers` optional dep) for embeddings and `OpenAILLM` for fact extraction. The `OPENAI_API_KEY` env var works for OpenAI proper AND for OpenRouter via `OPENAI_BASE_URL=https://openrouter.ai/api/v1`. No silent stub fallback. The earlier "alpha default uses stubs" pattern is retired.

Docker stack (multi-stage distroless + `pgvector` + GHCR release pipeline) lands at v0.1.0-alpha alongside the consolidated `themory {mcp,server,migrate,health}` CLI — see Roadmap Items 16–18.

**Container entrypoint** (per ADR D13): the distroless image's `ENTRYPOINT` invokes the Node binary directly — `["/nodejs/bin/node", "/app/dist/agent-tools/cli.js", "server"]` — with no shell wrapper. Migrate-on-startup runs inside the `themory server` binary (T2.3) so there is no `docker-entrypoint.sh`. Operators can run the other subcommands by overriding the entrypoint at `docker run` time:

```bash
# Apply pending migrations standalone (manual schema bootstrap).
docker run --rm --entrypoint /nodejs/bin/node \
  -e THEOMEM_PG_URI=postgres://... \
  ghcr.io/usetheo/themory:0.1.0-alpha \
  /app/dist/agent-tools/cli.js migrate

# Probe DI graph + DB readiness (CI / orchestrator health checks).
docker run --rm --entrypoint /nodejs/bin/node \
  -e THEOMEM_PG_URI=postgres://... \
  ghcr.io/usetheo/themory:0.1.0-alpha \
  /app/dist/agent-tools/cli.js health
```

The `docker-compose.prod.yaml` stack (T3.2) boots both `themory` + `pgvector` with healthchecks suitable for `docker compose up -d --wait --wait-timeout 60`.

## CLI verbs

`themory` ships 8 subcommands: 4 lifecycle commands (`mcp` / `server` / `migrate` / `health` — documented in the sections above) and 4 memory verbs (`remember` / `recall` / `forget` / `reflect`) that round-trip a single memory operation from the shell without a long-running server. All 4 verbs emit JSON by default; pass `--text` for human-readable output.

```bash
export THEOMEM_PG_URI=postgres://memory:memory@localhost:5432/themory
export OPENAI_API_KEY=sk-...             # OR an OpenRouter key + OPENAI_BASE_URL
export OPENAI_BASE_URL=https://openrouter.ai/api/v1   # optional

# Write a fact under a user scope
themory remember 'I prefer dark coffee in the morning' --user alice

# Query the same scope
themory recall 'morning beverage' --user alice --top-k 5 --threshold 0.5

# Delete a memory by id (NO scope flag — memoryId globally unique)
themory forget 11111111-2222-3333-4444-555555555555 --hard

# Trigger reflection over a scope; emits raw ReflectionResult JSON
themory reflect --user alice
```

### Stable flags (v1.0 contract — see `CLAUDE.md` § Locked names)

| Flag | Where | Type | Notes |
|---|---|---|---|
| `--user <id>` | `remember` / `recall` / `reflect` | string | Mutually exclusive with `--session` / `--agent`. |
| `--session <id>` | `remember` / `recall` / `reflect` | string | Mutually exclusive with `--user` / `--agent`. |
| `--agent <id>` | `remember` / `recall` / `reflect` | string | Mutually exclusive with `--user` / `--session`. |
| `--top-k <n>` | `recall` | int 1..100 | Max items returned. |
| `--threshold <f>` | `recall` | float [0, 1] | Semantic similarity floor. |
| `--diversify <l>` | `recall` | float [0, 1] | MMR diversification lambda (opt-in). |
| `--hard` | `forget` | flag | Hard-delete (default is soft via `t_invalid`). |
| `--json` | all 4 verbs | flag | Output JSON (default). |
| `--text` | all 4 verbs | flag | Human-readable text instead of JSON. |

### Docker-exec composability

The published image at `ghcr.io/usetheo/themory:0.1.0-alpha` includes the CLI:

```bash
docker exec themory \
  node /app/dist/agent-tools/cli.js recall 'morning beverage' --user alice --top-k 5
```

### Caveats (honest disclosure per Inquebrável Rule 3)

- **Cold-start cost.** Each verb invocation pays ~2-5s warm-up: model download (first run only, then disk-cached), pg connect + journal sync, factory probe. For batch operations > 50 invocations, use the REST server (`themory server`) + `curl` instead of one CLI invocation per item.
- **Output contract.** `reflect --json` emits the RAW `ReflectionResult` shape (`{ higherOrderMemories, sourceIds, derivedMemoriesCreated, reason? }`) so scripts portable across CLI + MCP + REST consume the same field names. There is no projection step.
- **Mutually-exclusive scope.** `remember` / `recall` / `reflect` REQUIRE exactly one of `--user` / `--session` / `--agent`; zero or multiple → exit 2 in <2s (boundary-first ordering, no factory warm-up paid). `forget` takes NO scope flag because `memoryId` is globally unique.

## Status — v0.6 (voyager-skill-library) shipped; v0.4b forgetting + v0.5 cloud + v0.7 distillation next

> **v0.8 — Independent benchmark reproduction (Roadmap Item 10) — published 2026-06-02.** Smoke validation across LongMemEval / LoCoMo / DMR for TheMemory; vendor adapter cells (Mem0/Zep/Letta) shipping `VendorClient` DIP only with real SDK wiring deferred per Drift-T6.x-1. Matrix at [`docs/benchmarks/v0.8.md`](docs/benchmarks/v0.8.md), methodology at [`docs/benchmarks/v0.8-methodology.md`](docs/benchmarks/v0.8-methodology.md), reproducibility runbook at [`docs/benchmarks/v0.8-reproducibility.md`](docs/benchmarks/v0.8-reproducibility.md). **`/dogfood` gate remains EVIDENCE_INSUFFICIENT — v0.8 does NOT unblock v1.0 production-ready claims.**
>
> `@usetheo/memory` is **pre-release**. v0.0 (type contract) shipped via PR #4 on 2026-05-22; v0.1 (core + local runtime) shipped via PR #8 on 2026-05-23; v0.2 PR-A (TheoKit binding) shipped via PR #11 on 2026-05-23; v0.3 (MCP agent tools) shipped via PRs #17+#18 on 2026-05-25; v0.4a (reflection pipeline) shipped on `develop` 2026-05-23 (`494bceb`); v0.6 (Voyager-style skill library) shipped on `feat/v0-6-voyager-skill-library` on 2026-05-30 — closed with the v0.6.1 fixes cycle (14 commits, b6aead6 `/review READY_TO_MERGE`) + `chat-with-memory-e2e-fixes` demo cycle (4 commits, 9e09bb9 `/test-chat-with-memory READY 30/30`). **No package is published yet** — the `@usetheo/memory` name is reserved. The TheoCloud managed runtime depends on [Theo PaaS](../theo) (pre-release) reaching general availability.
>
> What works today (v0.1 → v0.6 against `ankane/pgvector:v0.5.1`):
> - **`createMemory` factory** + `runMigrations` helper + public barrel at `@usetheo/memory`.
> - **Three-tier scope** (`memory.user(id)` / `memory.session(id)` / `memory.agent(id)`) with isolation enforced at the SQL `WHERE` level — plus **`RepoScope` 4th tier** (v0.6, ADR-0010) exposed via `memory.skills(repoId)`.
> - **8-phase write pipeline** ported verbatim from Mem0 with per-row fallback at every I/O boundary + OpenTelemetry spans per phase.
> - **9-step search** with additive `(semantic + BM25 + entity_boost) / max_possible` scoring, threshold-gates-semantic-BEFORE-combining invariant, BM25 via Postgres `to_tsvector` + sigmoid normalization adapted to query length.
> - **MD5 hash dedup** (no normalization; matches Mem0 byte-level behavior) + **Porter lemmatization** (optional `natural` peer + in-house `simpleStem` fallback).
> - **Two `VectorStore` adapters**: in-memory (Map-backed, ~200 LoC) for unit tests + dev quickstart; pgvector (raw SQL via `pg`) for production. Both pass identical 17-test conformance suite.
> - **`DrizzleHistoryManager`** for append-only audit trail (`Memory.history(id)` reverse-chronological).
> - **Drizzle schema** with bi-temporal columns (`tValid`/`tInvalid` nullable per ADR-0006), HNSW pgvector index on 1536-dim embedding column (cap locked per plan ADR D1.7 due to pgvector 0.5.1's 2000-dim HNSW limit).
> - **v0.4a reflection pipeline**: `reflect()` async via sleep-time worker (Letta pattern) behind `ReflectionPolicy` DIP — `ManualReflectionPolicy` (v0.0 default) + `ThresholdReflectionPolicy` (counter persisted in `reflection_counters` Postgres table) + scoring strategy interface (additive Mem0 default OR multiplicative Generative Agents opt-in). LLM-importance cached at write to avoid per-query cost.
> - **v0.6 voyager-skill-library**: `memory.skills(repoId)` returns `ScopedSkillMemory` exposing `add(SkillDraft)` / `recall(query, options)` / `consolidate(options)` / `forget(skillId)`. Reuses the v0.4a chain via `executeReflection` + `validateProvenance`. `clusterThreshold` (default 0.85) opt-in per consumer. Identity is `hashFact(description)` — same-description-different-code collides on `UNIQUE(hash)` per v0.6.1 T1.2 contract. Forget is scope-isolated: cross-repo deletion attempts return the same `MemoryNotFound` shape as non-existent ids (information-leak prevention per v0.6.1 T4.1 EC-2).
> - **`@usetheo/memory/agent-tools`** subpath: 4 MCP tools (`remember`/`recall`/`forget`/`reflect`) over stdio + streamable-HTTP transports for `@usetheo/sdk` agents; AsyncLocalStorage scope binding via `memoryFromCtx`.
> - **`@usetheo/memory/theokit`** subpath: `memoryFromCtx(ctx, memory)` auto-scopes `user_id` from `ctx.session.userId` via structural typing (zero peer-dep, ADR D1).
> - **`examples/chat-with-memory/`**: Next.js 15 demo combining `@usetheo/memory` + `@usetheo/sdk` + `@usetheo/ui` to demonstrate every Scope tier + skills + history + reflection through a tabbed UI. Backend auto-detect (pgvector if `THEOMEM_PG_URI` set, in-memory otherwise). Validated end-to-end by the `/test-chat-with-memory` skill — 30/30 PASS on 2026-05-30 (verdict `READY`).
> - **Test coverage**: 490 contract tests (unit + type) + 67 integration tests against real pgvector (THE GOAL TEST for v0.6 + scope-isolation for v0.6.1 T4.1). Zero CRITICAL/HIGH CVE (6 MODERATE: 4 dev-only `esbuild` chain via drizzle-kit allowlisted to 2026-08-23; 2 demo-side `next`+`postcss` transitive not introduced by current plans).
>
> What is still honest:
> - **Pre-release.** No package published. No "production-ready" claim until v1.0 with reproduced benchmarks (LongMemEval + LoCoMo + DMR) per the macro roadmap + `/dogfood` returning `EVIDENCE_SUFFICIENT`.
> - **Cloud runtime not built yet.** v0.5 depends on TheoCloud (pre-release) GA.
> - **Long-tail forgetting not built yet.** v0.4b (roadmap Item 6) is the open problem: triadic signal (Ebbinghaus decay + LRU/LFU + LLM-judged importance) with explicit anti-long-tail guardrail. Required before v0.8 benchmark reproduction.
> - **Episodic→Semantic distillation pipeline not built yet.** v0.7 (roadmap Item 9). Required before v1.0 contract freeze.
> - **TheoKit binding PR-B still pending.** Default-on memory in scaffolded `create-theo` templates per ADR D7 lives in the sibling `theokit` repo — pending; until then consumers wire the singleton manually per the binding example above.
> - **Apache-2.0 aligned with the monorepo standard** (re-aligned 2026-06-09). Explicit patent grant + trademark protection for embeds in proprietary systems.
>
> If you are evaluating *today* and need something running in production *today*, mature alternatives exist ([Mem0](https://mem0.ai), [Letta](https://www.letta.com), [Zep](https://www.getzep.com)). `@usetheo/memory` is what you reach for when your stack is TheoKit + TheoCloud OR you want a Mem0-shape memory primitive without the framework lock-in.

## Two runtimes, one API

Runtime is picked by which key you pass to `Memory.create()` — `local` or `cloud`. Same API surface either way; same three tiers either way.

| Runtime | What it does | When to use |
|---|---|---|
| **Local** | Runs against your own Postgres + pgvector. Embeddings via your provider key. | Dev, CI, self-hosted demos, evaluation against your data. |
| **TheoCloud (managed)** | Runs in TheoCloud against a managed vector store with managed embeddings, managed LLM extraction, and managed retrieval. Same TheoCloud account that deploys your TheoKit app. | Production. Same dashboard as your deploy, one invoice, one access control surface. |

Premium capabilities (graph memory, multi-tenant audit trails, managed embedding pricing, cross-region replication) ship in the TheoCloud runtime. The local runtime stays open and useful for development — it is not a crippled demo.

## Planned API contract

The contract below is the design target. Treat snippets as the **shape** the implementation will conform to, not as code you can run today.

### Installation

```bash
npm install @usetheo/memory     # reserved; not yet published
```

### Local runtime — dev and CI

```typescript
import { Memory } from "@usetheo/memory";

const memory = await Memory.create({
  local: {
    storage: { type: "postgres", url: process.env.DATABASE_URL! },
  },
  embeddings: { provider: "openai", model: "text-embedding-3-small" },
  workspace: "acme-support",
});
```

### TheoCloud runtime — production

```typescript
import { Memory } from "@usetheo/memory";

const memory = await Memory.create({
  cloud: { apiKey: process.env.THEOKIT_API_KEY! },
  workspace: "acme-support",
});
```

Same `THEOKIT_API_KEY` as the rest of the Theo ecosystem (`@usetheo/sdk`, TheoCloud deploys). No separate account. No separate billing.

### Three-tier scopes

```typescript
// User memory — durable identity, cross-session
await memory.user("user-42").remember(
  "Speaks Portuguese. Vegetarian. Prefers concise responses."
);

// Session memory — scoped to one conversation
const session = memory.session("session-abc");
await session.remember({
  role: "assistant",
  text: "Promised a callback by Friday about the refund.",
});

// Agent memory — procedural skills the agent learned
await memory.agent("support-bot").remember({
  skill: "refund-flow",
  body: "Check last 3 invoices, verify chargeback window, open ticket.",
});

// Unified recall — pulls from whichever tiers the call enables
const context = await memory.recall("What does the user prefer?", {
  user: "user-42",
  session: "session-abc",
  agent: "support-bot",
  scopes: ["user", "session"],
  limit: 8,
});

console.log(context.items);
// → [{ tier: "user", text: "Speaks Portuguese...", score: 0.91, ... }]
```

Same verbs, scope-aware:

```typescript
// remember(fact, options)
await memory.user(userId).remember("Allergic to peanuts");
await memory.session(sessionId).remember({ role: "user", text: "..." });
await memory.agent(agentId).remember({ skill: "refund-flow", body: "..." });

// recall(query, options)
const userFacts = await memory.user(userId).recall("dietary restrictions");
const recentTurns = await memory.session(sessionId).recall(null, { limit: 20 });
const skill = await memory.agent(agentId).recall("how to refund");

// forget(predicate, options)
await memory.user(userId).forget({ olderThan: "30d" });
await memory.session(sessionId).clear();

// reflect — consolidate episodic into semantic (Generative Agents-shaped)
await memory.agent(agentId).reflect({ window: "7d" });
```

### TheoKit-native binding (`@usetheo/memory/theokit`)

When the consumer is a [TheoKit](../theokit) app, the binding auto-scopes memory from the request context — no explicit `memory.user(id)` thread through every handler. The lock-in surface is **opt-in via a separate subpath** (consumers not using TheoKit pay zero binding bundle cost):

```typescript
// server/routes/notes.ts (TheoKit route)
import { defineRoute, requireAuth } from "theokit/server";
import { memoryFromCtx } from "@usetheo/memory/theokit";
import { z } from "zod";

import { memory } from "../memory.js"; // your app-scoped singleton

export const POST = defineRoute({
  body: z.object({ text: z.string() }),
  handler: async ({ ctx, body }) => {
    requireAuth(ctx.session);
    await memoryFromCtx(ctx, memory).remember(body.text);
    return { ok: true };
  },
});
```

`memoryFromCtx(ctx, memory)` reads `ctx.session.userId` structurally — zero peer-dependency on the `theokit` package. The resolver has three explicit states:

- **(a)** `userId` is a non-empty string → returns `memory.user(userId)`
- **(b)** `ctx.session === null` (unauthenticated) → throws `MissingScopeError` with guidance to call `requireAuth(ctx.session)` first
- **(c)** `session` field absent OR `userId` undefined/non-string/empty/whitespace → throws `MissingScopeError` with guidance to wire `createSessionManager`

`MissingScopeError` is re-exported from the same subpath for `instanceof` checks in error boundaries.

v0.2 resolves the **`userId` tier only**; consumers needing `sessionId` or `agentId` scoping call `memory.session(id)` / `memory.agent(id)` directly per the three-tier API. Multi-tier auto-resolution may land in a later milestone. Default-on memory in scaffolded `create-theokit` templates (`saas` + `postgres`) is **planned** as a follow-up — until that lands, consumers add `@usetheo/memory` as a dep + wire the singleton themselves.

Outside TheoKit the framework-agnostic API is identical — wire `user` / `session` / `agent` manually. **Inside TheoKit, the binding reads them from `ctx.session` for you.** That is the lock-in this project owns explicitly.

### Retrieval — Mem0-shape, multi-signal

Each `recall` runs the same hybrid retrieval pipeline:

```
candidates = pgvector(semantic ANN) ∪ BM25(lexical) ∪ entity_match(extracted entities)
score      = recency(decay) × importance(LLM-judged 1-10 at write) × relevance(cosine)
```

Pure cosine similarity is provably worse for agent behavior over long horizons (Park et al. 2023, *Generative Agents*). The recency × importance × relevance triad is the default. Hybrid candidate generation matches Mem0's v2 retrieval shape (semantic + BM25 + entity).

### Write pipeline — two-stage, ADD-only

Following Mem0 v2.0 (April 2026), the write path is two-stage and **ADD-only**:

1. **Extract** — recover top-K related memories for dedup context, single LLM call extracts all distinct facts from the new turn.
2. **Update** — batch embed → hash-dedup → batch insert with entity linking.

Old memories are not overwritten. Conflicts produce new facts with their own `t_valid` window. This trades disk for auditability — every claim the agent ever made is traceable.

### Memory operations as agent tools

When `@usetheo/memory` runs alongside an agent SDK (e.g., [`@usetheo/sdk`](../theokit-sdk)), the tier verbs are exposed as MCP tools — the agent decides when to remember, recall, and forget rather than the framework deciding for it. This follows the MemGPT lesson: **function-calling memory ops outperform hardcoded heuristics**.

```typescript
import { Agent } from "@usetheo/sdk";
import { memoryTools } from "@usetheo/memory/agent-tools";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  tools: memoryTools(memory),    // exposes remember/recall/forget/reflect
});
```

## Architecture

```
@usetheo/memory/
├── packages/
│   ├── core/                    Memory class, MemoryStore interface (DIP)
│   │   ├── tiers/               UserMemory, SessionMemory, AgentMemory
│   │   ├── retrieval/           recency × importance × relevance scorer
│   │   ├── pipeline/            two-stage extract → update pipeline
│   │   ├── consolidation/       reflect() — episodic → semantic
│   │   └── types.ts             public type contract
│   ├── local/                   Postgres + pgvector local runtime
│   ├── cloud/                   TheoCloud managed runtime client
│   ├── embeddings/              provider abstraction (OpenAI, Anthropic, local)
│   ├── theokit/                 TheoKit-native binding (request-context aware)
│   └── agent-tools/             MCP tools for @usetheo/sdk agents
```

### Semantic recall cache (v1.5)

Opt-in read-side cache for `recall()` keyed by **query-embedding cosine similarity** (NOT string match). A near-duplicate query (`"what is my favorite color?"` vs `"what color do I prefer?"`) within the same scope reuses the cached result instead of re-running the 9-step retrieval pipeline. Backs Roadmap Item 19 / v1.5.

```ts
import { createLocalMemory, runMigrations, PgvectorStore } from '@usetheo/memory';

await runMigrations(pool);                   // migration 0010 ships recall_cache

const memory = await createLocalMemory({
  vectorStore: new PgvectorStore(pool),
  embedder,
  llm,
  recallCache: { threshold: 0.8 },           // opt-in; cache disabled by default
});

await memory.user('alice').recall('what is my favorite color?');  // MISS → populates
await memory.user('alice').recall('what color do I prefer?');     // HIT (cosine >= 0.8)
```

- **Threshold**: default `0.8` cosine similarity (convergent across embedchain `similarity_threshold=0.8` and LangChain `distance_threshold=0.2`).
- **Per-tier TTL**: default `user` 24h, `agent` 1h, `session` 10min, `repo` 1h. Override via `recallCache.ttlSecondsByScopeTier`.
- **LRU eviction**: default cap `1000` rows per scope. Concurrent `set()` calls serialize via Postgres SERIALIZABLE isolation (single retry on `40001`).
- **Write-trigger invalidation**: `remember()` / `forget()` / `reflect()` await `invalidateScope()` post-success so the consumer's next `recall()` sees fresh state (Inquebrável Rule 3 + Item 19 AC#3).
- **Bypass boundary**: `recall(query, { asOf })` AND `recall(query, { attributedTo })` BYPASS the cache (no get, no set) — v1.5 cache key is `(scope_key, query_embedding)` and does not include bi-temporal/multi-peer dimensions.
- **Observability**: 3 OTel instruments — `theo.memory.recall_cache.hit` (Counter) + `theo.memory.recall_cache.hit.duration_ms` (Histogram) + `theo.memory.recall_cache.miss.duration_ms` (Histogram). Labels `{ scope_tier, embedder_kind }`.
- **Subpath**: `@usetheo/memory/cache-pg` exposes `PgvectorRecallCacheStore` + metric resolvers for custom wirings.
- **Stub-embedder gate**: when cache is enabled and the embedder is `StubEmbedder` / `DeterministicStubEmbedder`, a 3-line stderr warning fires at factory time — cache hits with stub vectors are COINCIDENTAL, not semantic.

**Known limitation (v1.5.0):** `memory.skills(repoId).recall(...)` does NOT consult the recall cache — the cache wrap lives on `LocalScopedMemory.recall()` only. Skill-scope cache wiring is tracked for v1.5.x. `ScopeTierTtlConfig.repo` remains REQUIRED in the public DIP because consumer configs that set it forward-port without rewrites; the field's TTL value is dormant until the wiring lands. Mirrors the v1.1 EC-9 skill-scope `asOf` honest deferral precedent. See `semantic-recall-cache-v1-5-fixes-cycle-1-plan.md` § ADR D10.

THE GOAL TEST (`tests/integration/cache/semantic-recall-cache.test.ts`) verifies hit rate ≥ 0.5 on 10 hand-authored near-duplicate query pairs at `threshold=0.8` against real `ankane/pgvector:v0.5.1`. Last run: **6/10 = 0.60**.

### Dependency direction (planned, enforced at CI)

```
core              → (nothing, type-only)
local             → core
cloud             → core
embeddings        → core
theokit           → core, embeddings
agent-tools       → core
```

The `MemoryStore` interface in `core/` is the DIP boundary. Both `local/` and `cloud/` implement it. Consumers depend on `core/` only — they switch runtimes by changing one config block.

### Local storage — pgvector

Local mode runs on **Postgres + pgvector** because:

- It is the simplest setup for dev and CI.
- TheoCloud also exposes Postgres, so local-to-cloud migration is feasible.
- pgvector is a single extension, not a separate database, network hop, or query language.
- Hybrid retrieval (vector + BM25 + entity match) fits inside one SQL transaction.

### Cloud storage — TheoCloud-managed

Cloud mode runs against a TheoCloud-managed vector store with managed embeddings, managed LLM extraction, and managed retrieval. The user never sees the underlying engine — that is operational state, not API surface. This follows [Cross-Project Rule 9 (Cloud abstraction)](../CLAUDE.md): user-facing copy says "memory store", not "Qdrant" or "pgvector". The managed runtime is also where premium capabilities live:

- **Graph memory** — entity-relation graph layered on top of fact extraction
- **Bi-temporal audit** — `t_valid` and `t_invalid` windows on every fact for compliance trails
- **Multi-region replication** — for latency-sensitive customer surfaces
- **Managed embedding cost** — no per-call provider billing for embeddings; bundled in TheoCloud usage

## Roadmap

The contract above is the target. The shipping order is:

| Milestone | Scope | Status |
|---|---|---|
| **0.0 — Contract** | Type contract for `Memory`, `MemoryStore`, three tiers, retrieval scorer, two-stage pipeline. | **Shipped 2026-05-22** (PR #4) |
| **0.1 — Core + local runtime** | `core/` + `local/` (Postgres + pgvector). Single backend, three tiers, additive scoring, 8-phase write + 9-step search. | **Shipped 2026-05-23** (PR #8) |
| **0.2 — TheoKit binding** | `theokit/` subpath: `memoryFromCtx(ctx, memory)` auto-scopes from `ctx.session.userId` via structural typing. Default-on in scaffolded TheoKit apps deferred to sibling repo PR-B per ADR D7. | **PR-A shipped 2026-05-23** (PR #11); PR-B pending |
| **0.3 — Agent tools (MCP)** | `agent-tools/` package: 4 MCP tools (`remember`/`recall`/`forget`/`reflect`) over stdio + streamable-HTTP for `@usetheo/sdk` agents. | **Shipped 2026-05-25** (PRs #17 + #18) |
| **0.4a — Reflection pipeline** | `reflect()` async via sleep-time worker behind `ReflectionPolicy` DIP. Additive Mem0 (default) OR multiplicative Generative Agents (opt-in strategy). Counter persisted in `reflection_counters` Postgres table. | **Shipped 2026-05-23** (`develop` `494bceb`) |
| **0.4b — Long-tail forgetting** | OPEN PROBLEM #1 — triadic signal (Ebbinghaus decay + LRU/LFU + LLM-judged importance) with explicit anti-long-tail guardrail. | Planned |
| **0.5 — TheoCloud runtime** | `cloud/` package + TheoCloud-managed backend. Bi-temporal `t_valid`/`t_invalid` audit history exposed in paid tier. Multi-region replication. Depends on Theo PaaS GA. | Planned |
| **0.6 — Voyager-style skill library** | OPEN PROBLEM #2 — `memory.skills(repoId)` 4-phase consolidate orchestrator (Orient → Gather → Consolidate → Report). Identity via `hashFact(description)`. Scope-isolated forget. | **Shipped 2026-05-30** (b6aead6 `/review READY_TO_MERGE` after the v0.6.1 fixes cycle; 9e09bb9 `/test-chat-with-memory READY 30/30` after the demo `chat-with-memory-e2e-fixes` cycle) |
| **0.7 — Episodic→Semantic distillation** | OPEN PROBLEM #3 — managed pipeline: raw episodes → entity extraction → conflict resolution (LLM-judged) → semantic facts with `derived_from` provenance. | Planned |
| **0.8 — Independent benchmark reproduction** | Reproduce LongMemEval + LoCoMo + DMR. Publish matrix (P95 latency, recall@10, cost/session, temporal accuracy) at `docs/benchmarks/`. | Planned |
| **1.0** | Contract stable. `production-ready` claim allowed ONLY after v0.8 reproduced independently AND `/dogfood` returns `EVIDENCE_SUFFICIENT` (anchor scenario `running` ≥ 30 days). | Planned |

Honest claims only — v0.0 + v0.1 + v0.2 PR-A + v0.3 + v0.4a + v0.6 shipped to git (`feat/v0-6-voyager-skill-library` branch awaiting merge to `develop` → `main`); package is NOT yet published to npm; no "production-ready" claim until v1.0 per CLAUDE.md § honesty discipline. The roadmap is the commitment, not the receipt.

## Where this fits

`@usetheo/memory` is a community auxiliary of the [Theo stack](../README.md), with a managed runtime that lives inside TheoCloud:

| Tier | Project | License | What it does |
|---|---|---|---|
| Apex (paid) | [TheoCloud](../theo) | Commercial | Managed deployment runtime. The product. Hosts the `@usetheo/memory` cloud runtime. |
| Funnel (OSS) | [TheoCode](../theo-code) | Apache-2.0 | Autonomous coding agent. Plan · Code · Infra. |
| Funnel (OSS) | [TheoCreate](../theo-stacks) | Apache-2.0 | Scaffolding for Node/Go/Python/Rust/Java/Ruby/PHP/Next.js. |
| Funnel (OSS) | [TheoKit](../theokit) | Apache-2.0 | Next.js framework for full-stack AI agents. |
| Community auxiliary | [`@usetheo/sdk`](../theokit-sdk) | Apache-2.0 | Build-your-own-agent SDK. |
| Community auxiliary | [`@usetheo/ui`](../theo-ui) | Apache-2.0 | React components for AI agent surfaces. |
| **Community auxiliary** | **`@usetheo/memory`** *(this)* | **Apache-2.0** | **Three-tier managed memory layer. Native to TheoKit; runs in TheoCloud.** |

The local runtime is open and works without TheoCloud. The **managed runtime is the strategic focus** — that is where the single-platform consolidation happens (deploy + memory + agent SDK + UI all on one TheoCloud account).

## Development

This package is not yet published. Once implementation begins:

```bash
nvm use                       # Node 22+ per .nvmrc
corepack enable

pnpm install                  # install workspace deps
pnpm typecheck                # tsc --noEmit across packages
pnpm test                     # vitest
pnpm build                    # tsup → dist/
pnpm check                    # biome lint + format
```

Contributions are welcome once the 0.0 contract lands. Until then, the value-add is on the design itself — open issues against the planned API contract above.

## License

[Apache-2.0](./LICENSE) © [usetheo.dev](https://usetheo.dev)

> Aligned with the monorepo's Apache-2.0 standard as of 2026-06-09. The prior MIT exception (locked 2026-05-14) was reverted: explicit patent grant and trademark protection in Apache-2.0 are net-positive for embeds in proprietary systems, matching the licensing of all direct competitors (Mem0, Letta, Zep/Graphiti).

## Community

- Discord: https://discord.usetheo.dev/
- X: https://x.com/usetheodev
- LinkedIn: https://linkedin.com/company/usetheodev
