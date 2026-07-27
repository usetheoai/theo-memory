<div align="center">

<img src="./assets/banner.svg" alt="Theo Memory — the open-source memory layer for AI agents" width="840" />

**Persistent and multi-tenant — your agents remember facts, conversations, and _executable skills_ across every user and session, on your own Postgres.**

`remember` · `recall` · `forget` · `reflect` — one TypeScript SDK, one REST API, one MCP server.
Works with any LLM. No graph DB. No lock-in. Apache-2.0.

[![License](https://img.shields.io/badge/license-Apache--2.0-7C3AED?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-1%2C500%2B%20passing-brightgreen?style=flat-square)](#testing)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](#docker)
[![MCP](https://img.shields.io/badge/MCP-4%20tools-FF6B35?style=flat-square)](#mcp-server)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6BA539?style=flat-square&logo=openapiinitiative&logoColor=white)](#rest-api)
[![Status](https://img.shields.io/badge/status-pre--release-orange?style=flat-square)](#status)

[Quickstart](#quickstart) · [Features](#features) · [API](#api) · [REST](#rest-api) · [MCP](#mcp-server) · [Docker](#docker) · [CLI](#cli) · [Architecture](#architecture) · [Contributing](#contributing)

**Part of [Theo](https://usetheo.dev) — the open platform for AI agents.** [Learn more →](https://usetheo.dev)

</div>

---

## Why Theo Memory?

**Every session starts from zero.** Your agent re-asks what the user already told it, forgets the
last support ticket, relearns the same procedure. Theo Memory gives it **persistent, scoped,
searchable memory** in four verbs: `remember` · `recall` · `forget` · `reflect`.

So your agent can recall that Alice is vegetarian, that the last ticket was about billing, or that
the deploy script needs a `--force` flag on Tuesdays — across users, sessions, and even as
**reusable executable skills**.

- **Runs on your infra** — plain Postgres + pgvector, your LLM key. No graph DB, no vendor lock-in, Apache-2.0.
- **Three ways to plug in** — TypeScript SDK, REST API (OpenAPI 3.1), or MCP server (works with Claude, Cursor, and any MCP agent).
- **Multi-tenant from day one** — workspace isolation + `owner`/`admin`/`member` RBAC, in the **free** package (not a paid tier).

```ts
import { createLocalMemory, PgvectorStore } from '@usetheo/memory';

const memory = await createLocalMemory({ vectorStore, embedder, llm });

// Your agent remembers
await memory.user('alice').remember('Prefers dark mode. Speaks Portuguese.');

// Your agent recalls
const facts = await memory.user('alice').recall('UI preferences');
// → [{ text: 'Prefers dark mode', score: 0.94 }]
```

**No vendor lock-in.** Runs on your Postgres. Uses your LLM key. Apache-2.0 licensed.

## Features

- **Three-tier scope** — `user` (cross-session) · `session` (conversation) · `agent` (procedural) + `skills` (code-as-skill library)
- **4-verb API** — `remember` · `recall` · `forget` · `reflect` — consistent across all tiers
- **Hybrid retrieval** — semantic (cosine) + BM25 (lexical) + entity boost with threshold gating
- **LLM fact extraction** — 8-phase pipeline extracts structured facts from free-form text
- **Bi-temporal queries** — `recall({ asOf })` for point-in-time memory snapshots
- **Multi-peer attribution** — track who said what with `{ attributedTo: 'bob' }`
- **Category filtering** — server-side `?category=` filter with btree index
- **Semantic recall cache** — near-duplicate queries reuse cached results (cosine similarity)
- **MMR diversification** — opt-in reranking for result diversity
- **Auth lifecycle** — bearer tokens, Stripe-shape API keys, OIDC bridge
- **Multi-tenant + RBAC** — workspace isolation (cross-tenant access is `404`, never `403`) + members/roles (`owner`/`admin`/`member`) with last-owner & anti-escalation guards — see [Multi-tenancy & RBAC](#multi-tenancy--rbac)
- **Three surfaces** — REST API (Hono + OpenAPI 3.1) · MCP server · CLI
- **OpenMemory drop-in** — `themory mcp --compat openmemory` serves the OpenMemory tool surface over SSE for Cursor / Claude Desktop / Windsurf / Cline
- **Selectable embedder** — `THEOMEM_EMBEDDER=local` (on-device Xenova MiniLM) or `openai` (`text-embedding-3-small`, no on-device model)
- **Docker-ready** — distroless image < 200 MB with healthcheck
- **Observable** — 16 OpenTelemetry events + per-handler spans
- **Tested** — ~970 contract/unit tests + 540+ integration tests against real pgvector, across 270+ test files

## Quickstart

```bash
# 1. Install
npm install @usetheo/memory

# 2. Start Postgres + pgvector
docker run -d --name pgvector -e POSTGRES_USER=themem -e POSTGRES_PASSWORD=themem \
  -e POSTGRES_DB=themem -p 5432:5432 ankane/pgvector:v0.5.1

# 3. Configure
cp .env.example .env
# Set OPENAI_API_KEY (required) and THEMEMORY_API_KEY (optional, enables auth)

# 4. Apply schema
export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem
npm run db:push

# 5. Start
npx themory server
```

**Embedder selection** — set `THEOMEM_EMBEDDER`:

- `local` (default) — Xenova MiniLM, 384-dim, no API key. Downloads the model on first use.
- `openai` — OpenAI `text-embedding-3-small`, 1536-dim. Requires `OPENAI_API_KEY`; needs no on-device model and makes no HuggingFace download. Recommended for server/Docker deployments.

The migration dimension follows the selected embedder, so set `THEOMEM_EMBEDDER` before the first `db:push` / startup migration.

Try it:

```bash
# Write a memory
curl -X POST http://localhost:8080/v1/remember \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","text":"I drink espresso every morning"}'

# Query it
curl -X POST http://localhost:8080/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","query":"coffee"}'
```

## API

### Scopes

```ts
// User — persists across sessions
await memory.user('alice').remember('Allergic to peanuts');

// Session — scoped to a conversation
await memory.session('conv-42').remember('Discussed pricing tier B');

// Agent — learned procedures
await memory.agent('support-bot').remember('Check invoices before opening a refund');

// Skills — executable code snippets
await memory.skills('my-repo').add({
  description: 'Deploy to staging',
  code: 'sh("kubectl apply -f k8s/")',
  codeLanguage: 'typescript',
});
```

### Recall options

```ts
// Filter by category
await memory.user('alice').recall('preferences', { category: 'food' });

// Point-in-time query
await memory.user('alice').recall('address', { asOf: new Date('2025-01-15') });

// Filter by who said it
await memory.user('alice').recall('updates', { attributedTo: 'manager-bob' });

// Diversify results (MMR)
await memory.user('alice').recall('interests', { diversify: { lambda: 0.7 } });
```

## REST API

Built on [Hono](https://hono.dev) with auto-generated [OpenAPI 3.1](https://swagger.io/specification/) spec.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/remember` | Store a memory (LLM extracts facts) |
| `POST` | `/v1/recall` | Hybrid search — response envelope carries a `recallId` (see accountable forgetting) |
| `POST` | `/v1/forget` | Soft or hard delete |
| `POST` | `/v1/reflect` | Consolidate episodic → semantic |
| `GET` | `/v1/scopes/:type/:id/memories` | List with `?category=` filter |
| `GET` | `/v1/recall-traces/:recallId` | Why each candidate was **dropped** (accountable forgetting; opt-in, workspace-scoped) |
| `GET`/`POST`/`PATCH`/`DELETE` | `/v1/members` | Workspace member CRUD (role-gated: `admin`) |
| `GET` | `/v1/health` | Liveness (auth-exempt) |
| `GET` | `/v1/openapi.json` | Spec (auth-exempt) |

**Security** — Bearer auth (`THEMEMORY_API_KEY`), rate limiting (30 writes/min, 100 reads/min), CORS, 1 MB body cap, OIDC bridge for multi-tenant.

### Accountable forgetting (opt-in)

Every recall discards candidates — sub-threshold matches, redundant near-duplicates. Most memory layers throw the *reason* away. When you enable tracing (`THEOMEM_RECALL_TRACE=true`), each recall persists one row per **dropped** candidate with its full score breakdown (semantic / bm25 / entity / composite / threshold) and the drop reason (`semantic_gate` / `sub_threshold` / `nan` / `mmr_redundant`), keyed by the `recallId` the recall response returns:

```bash
# recall returns a recallId in its envelope …
curl -s $URL/v1/recall -H "Authorization: Bearer $KEY" \
  -d '{"userId":"alice","query":"preferences"}' | jq .recallId
# … then read WHY each candidate was dropped (workspace-scoped; 404 across tenants)
curl -s $URL/v1/recall-traces/<recallId> -H "Authorization: Bearer $KEY" | jq .drops
```

Default OFF (recall is byte-unchanged and writes nothing). The read is scoped to the caller's workspace at the store boundary — a `recallId` from another tenant returns `404`. Pre-release; the write cost is one row per dropped candidate per recall.

## Multi-tenancy & RBAC

Ship a multi-tenant product without bolting on a separate auth service. Two layers — **workspace isolation** and **role-based access** — are enforced server-side from the credential, never from the request body. Both live in the free package (peers commonly gate this to a paid tier).

### Workspace isolation

Every API key resolves to a `workspace`. The `AuthVerifier` resolves a `Principal { workspaceId, userId, role, scopes }` from the credential, and **every** persistence query is scoped by `principal.workspaceId`:

- **Where the workspace comes from** — the credential, never the body. The three memory tiers (`user` / `session` / `agent`) are partitions *within* a workspace; `workspace_id` is the outer tenant anchor.
- **How isolation is enforced** — app-level: a denormalized `workspace_id` column on every directly-queried table (`memories`, `entities`, `history`, `recall_cache`, …), composed first in every `WHERE`. The `memories` dedup index leads with `workspace_id` (the same fact under the same user in two workspaces is two distinct rows).
- **Cross-tenant access is `404`, never `403`** — a by-id `forget`/`GET` for another workspace's row reveals nothing (no existence leak); the row is invisible because the `workspace_id` filter excludes it.
- **Every surface is covered** — the primary 4-verb path (`remember`/`recall`/`forget`/`reflect`) **and** the opt-in recall-cache (key is workspace-prefixed `ws:<id>|…` → no cross-workspace hit), skill store, and eviction passes (COUNT + candidates + nearest-neighbor are workspace-bound) are all isolated.
- **Legacy bridge** — no credential / the env `THEMEMORY_API_KEY` collapses to a single `default` workspace, so existing single-tenant deployments keep working unchanged.

```ts
// SDK: bind a workspace; every scoped op below is isolated to it.
const wsA = memory.withWorkspace('acme');
await wsA.user('alice').remember('Prefers dark mode');
await wsA.user('alice').recall('UI preferences'); // only ever sees 'acme' rows
```

### Members & roles (RBAC)

A workspace has members (`users` ↔ `workspace_users`, M:N) each holding one role: `owner` ⊇ `admin` ⊇ `member`.

- **Role resolution** — an API key *acts as* a member; its role is resolved by joining the key to its membership. **Default-deny:** a key with no membership row resolves to the least-privileged `member`, never `owner`.
- **Route gating** — management routes (`/v1/members`, `/v1/admin/keys`) require `requireRole('admin')` (401 precedes 403); the RAG verbs stay open to any member.
- **Last-owner invariant** — a workspace can **never lose its last owner**: demote/remove runs in a transaction with a workspace-wide `SELECT … FOR UPDATE` before the owner-count guard, so two concurrent demotions can't race to zero owners (the second returns `409`).
- **Anti-escalation** — an admin **cannot mint a key that outranks itself**: binding a key to a higher-ranked member is `403`, to a non-member `422`, to a lower/equal member `200`. A minted key carries the minter's `workspace_id`.
- **Fail-closed** — if the auth backend errors during role resolution, the request gets an explicit `503` — never a privileged default.

```bash
# Add a member by email (admin-gated). Creates the global user if new.
curl -X POST $BASE/v1/members \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"email":"bob@acme.com","role":"member"}'
# → 201 { "member": { "userId": "...", "email": "bob@acme.com", "role": "member", ... } }

# Promote to admin (last-owner-safe → 409 if it would orphan the workspace).
curl -X PATCH $BASE/v1/members/$USER_ID \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"role":"admin"}'

# Mint an API key bound to a member (anti-escalation: 403 if the target outranks you).
curl -X POST $BASE/v1/admin/keys \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"bob-agent","scopes":["memory:read","memory:write"],"user_id":"'$USER_ID'"}'
# → 200 { "id": "apk-…", "secret": "theo_live_…" }  (secret shown once)
```

> **Pre-release breaking change.** `AuthVerifier` evolves from `verify(token): Promise<boolean>` ("is this key valid?") to resolving `resolvePrincipal(token): Promise<Principal | null>` ("whose key is this?") — the `Principal` carries `{ workspaceId, userId, role, scopes }`. `verify` stays during the migration window; custom verifier implementations should add `resolvePrincipal`.

> **Admin key management is deployment-level.** The `/v1/admin/keys/*` endpoints (gated by the `memory:admin` scope) manage keys at the deployment level; per-workspace member administration is the `/v1/members` surface above. Treat `memory:admin` as a deployment-operator privilege. The MCP transport currently binds the `default` workspace; per-workspace MCP is a tracked follow-up.

## Agent loops via MCP

Works with [Claude Code](https://claude.ai/claude-code), Claude Desktop, Cursor, and any [MCP](https://modelcontextprotocol.io)-compatible agent. The MCP server wires the **real** providers (`LocalTransformerEmbedder` + `OpenAILLM`) — there are **no stubs in production path**, so `OPENAI_API_KEY` is required at boot.

Add `themory` to your project-local `.mcp.json` (Claude Code reads this file from the repo root — see [`.mcp.json.example`](./.mcp.json.example)):

```json
{
  "mcpServers": {
    "themory": {
      "command": "npx",
      "args": ["@usetheo/memory", "mcp"],
      "env": {
        "THEOMEM_PG_URI": "postgresql://themem:themem@localhost:5432/themem",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

`OPENAI_BASE_URL` is honored for OpenAI-compatible gateways — e.g. point at OpenRouter with `OPENAI_BASE_URL=https://openrouter.ai/api/v1` to use the free local-embedder + an OpenRouter chat model.

**Tools:** `remember` · `recall` · `forget` · `reflect`
**Transports:** stdio (default) · streamable-HTTP (auto-selects when `THEMEMORY_API_KEY` is set)

#### streamable-HTTP over TLS (non-localhost binds)

When the MCP server must listen on a **non-localhost** host (e.g. so a container reaches it
over `host.docker.internal`), HTTPS is required. Pass a cert/key pair:

```bash
themory mcp --transport streamable-http --host 0.0.0.0 --port 18091 \
  --auth api-keys --tls-cert path/to/cert.pem --tls-key path/to/key.pem
```

Both flags are required together (one alone fails fast); binding a non-localhost host without
them is refused. A localhost bind stays plain HTTP.

### OpenMemory-compatible mode

Run the server in OpenMemory drop-in mode so MCP clients already wired to the OpenMemory MCP Server (Cursor, Claude Desktop, Windsurf, Cline) work unchanged:

```bash
themory mcp --compat openmemory      # or env THEOMEM_MCP_COMPAT=openmemory
```

This exposes the OpenMemory tool surface — `add_memories` · `search_memory` · `list_memories` · `delete_memories` — as an alias over the native verbs, served over the OpenMemory SSE convention at `http://localhost:8765/{client}/sse/{user}` (`THEOMEM_MCP_HTTP_PORT` overrides the port). Scope is taken from the URL path (`{user}`); per-user isolation holds across all four tools, including delete (a user can only delete their own memories). No new dependency — it reuses the MCP SDK's `SSEServerTransport`. The native `themory mcp` is unchanged.

## Docker

```bash
docker pull ghcr.io/usetheo/themory:0.1.0-alpha

docker run -p 8080:8080 \
  -e THEOMEM_PG_URI=postgres://... \
  -e OPENAI_API_KEY=sk-... \
  -e THEOMEM_EMBEDDER=openai \
  ghcr.io/usetheo/themory:0.1.0-alpha
```

> The currently published tag is `0.1.0-alpha`; release tags are published to GHCR by CI on each version tag. The default image bundles the local embedder (Xenova/ONNX) — set `THEOMEM_EMBEDDER=openai` to use the OpenAI embedding API instead (no on-device model, no HuggingFace download at runtime).

Distroless Node 22 image, < 200 MB, Trivy-gated (zero CRITICAL/HIGH CVE), healthcheck built in. The image has no shell, so one-shot subcommands like `migrate` / `health` run by overriding the entrypoint to invoke Node directly:

```bash
# Apply migrations (or `health`) against the distroless image
docker run --rm --entrypoint /nodejs/bin/node \
  -e THEOMEM_PG_URI=postgres://... \
  ghcr.io/usetheo/themory:0.1.0-alpha /app/dist/agent-tools/cli.js migrate
```

## CI/CD

Every release image is **cosign-signed with identity-pinned verification** and ships an **SBOM + SLSA provenance** — so you can verify what you pull. Images publish to GHCR (and Docker Hub) automatically on each version tag.

| Trigger | Channel | Result |
|---|---|---|
| push to `develop` | preview | `ghcr.io/usetheoai/themory:develop` (+ `:develop-<short>`) |
| semver tag `v*` | release | `ghcr.io/usetheoai/themory:<version>` — **cosign-signed + identity-pinned verify** + SBOM/SLSA (+ Docker Hub `usetheo/themory` when `DOCKERHUB_TOKEN` is set) |
| manual dispatch | smoke | unsigned build |

> **Namespace changed (2026-07-27).** Images used to publish to `ghcr.io/usetheodev/themory`. The
> repository moved to the `usetheoai` organization, and a workflow run there cannot push to the
> previous account's namespace, so new images go to `ghcr.io/usetheoai/themory`. **The old package
> was not deleted** — historical tags (e.g. `:0.27.0`) remain pullable from the old path. What the
> old path no longer receives is new builds, so pin to `ghcr.io/usetheoai/...` going forward.

Every build runs a **Trivy gate** (`severity: CRITICAL,HIGH`, `ignore-unfixed`, `exit-code: 1`,
SHA-pinned in the reusable): the job fails on any fixable CRITICAL/HIGH CVE in the image, so a
vulnerable image is never published. Exemptions go through [`.trivyignore`](./.trivyignore) with a
**mandatory sunset date** and justification — never a blanket ignore.

## CLI

```bash
themory server                      # Start REST API
themory mcp                         # Start MCP server (native verbs)
themory mcp --compat openmemory     # OpenMemory-compatible MCP server over SSE (port 8765)
themory migrate                     # Apply pending migrations
themory health --deep               # Probe embedder + LLM + DB

themory keys create --name app --scope memory:read,memory:write
themory keys list
themory keys revoke <id>
themory keys rotate <id>
```

## CLI verbs

The four memory verbs are first-class subcommands — `remember`, `recall`, `forget`, `reflect`:

```bash
themory remember 'Likes espresso' --user alice
themory recall 'coffee' --user alice --top-k 5
themory forget <id> --hard
themory reflect --user alice
```

### API Key Rotation

Zero-downtime key rotation in 3 steps:

```bash
# 1. Create a new key (old key still works)
themory keys create --name app-v2 --scope memory:read,memory:write

# 2. Update your consumer to use the new key
#    (set THEMEMORY_API_KEY in your app's environment)

# 3. Revoke the old key once consumers are migrated
themory keys revoke <old-key-id>
```

Both keys are valid simultaneously between steps 1 and 3 — no downtime window. For atomic rotation (create + revoke in one call), use `themory keys rotate <id>`.

## Architecture

```
src/
├── core/              Contracts + types (no I/O)
│   ├── dip/           13 DIP interfaces
│   ├── extraction/    8-phase write pipeline
│   └── retrieval/     9-step hybrid search
├── local/             Postgres + pgvector (15 migrations)
├── server/            Hono REST + auth + rate-limit + CORS
├── agent-tools/       MCP server (stdio + HTTP)
├── embedders/         Local transformer (MiniLM, 384-dim)
└── llms/              OpenAI-compatible client
```

**Write path:**
```
Text → Context → Retrieve existing → LLM extract → Embed → Dedup → Persist → Audit
```

**Search path:**
```
Query → Embed → Semantic ANN → BM25 → Entity boost → Score → Threshold → Format
```

## Testing

```bash
npm test                    # ~970 contract/unit tests
npm run test:integration    # 540+ integration tests (real pgvector)
npm run typecheck           # Zero errors
npm run lint                # Zero warnings
```

| Metric | Value |
|---|---|
| Contract / unit tests | ~970 passing |
| Test files | 270+ |
| Integration tests | 540+ (against `ankane/pgvector:v0.5.1`) |
| Source lines | ~20,000 |
| DIP interfaces | 13 |
| Migrations | 18 |

## How it compares

The agent-memory space is healthy and moving fast — REDACTED, REDACTED, and REDACTED's REDACTED are all
strong, Apache-2.0, self-hostable projects. This is a **capability** comparison of the
**open-source surfaces** (not a performance benchmark, and not the vendors' hosted tiers),
best-effort from each project's public repo **as of July 2026**. Corrections welcome — open a PR.

| | **Theo Memory** | [REDACTED](https://github.com/REDACTEDai/REDACTED) | [REDACTED](https://github.com/REDACTED-ai/REDACTED) | [REDACTED](https://github.com/REDACTED/REDACTED) (REDACTED OSS) |
|---|---|---|---|---|
| License | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| Primary language | **TypeScript** | TypeScript + Python | Python | Python |
| Default store | Postgres + pgvector | pgvector / others | Postgres | a graph database (graph DB) |
| Memory model | `user` · `session` · `agent` · **`skills`** | user · session · agent | memory blocks | temporal graph + episodes |
| Hybrid retrieval (semantic + BM25 + entity) | ✅ | ✅ | n/d | ✅ (+ graph) |
| Point-in-time / temporal | ✅ `recall({ asOf })` | ✅ time-aware retrieval | n/d | ✅ bi-temporal |
| **Code-as-skill memory** | ✅ executable skill library | ❌ | ❌ | ❌ |
| MCP memory server | ✅ 4 tools + OpenMemory drop-in | via OpenMemory server | n/d | ✅ |
| REST API (OSS) | ✅ Hono + OpenAPI 3.1 | ✅ self-hosted server | ✅ | ✅ FastAPI |
| Multi-tenant isolation + RBAC (OSS) | ✅ workspace + `owner`/`admin`/`member` | hosted Platform ¹ | n/d ² | REDACTED Cloud ³ |
| No graph DB required | ✅ plain Postgres | ✅ | ✅ | ❌ needs a graph database/graph |

<sub>✅ present in the OSS project · ❌ absent · `n/d` = not determinable from the public repo. **Where Theo Memory is genuinely different:** (a) a **code-as-skill** memory tier (store + recall executable procedures), (b) **multi-tenant isolation + full `owner`/`admin`/`member` RBAC in the free OSS package** — peers commonly gate equivalent tenancy/RBAC to their hosted tiers, and (c) a **plain-Postgres** deployment (no graph database to run). Where peers are strong: REDACTED ships a large provider catalog + temporal reasoning; REDACTED is a first-class **temporal knowledge graph**. Theo Memory itself is **[pre-release](#status)**.</sub>

<br><sub>Sources (validate these): ¹ REDACTED — [repo](https://github.com/REDACTEDai/REDACTED) (OSS self-hosted server has auth; multi-tenancy/RBAC positioned in the hosted Platform). ² REDACTED — [repo](https://github.com/REDACTED-ai/REDACTED) (OSS self-host; RBAC/tenancy not documented in the OSS repo). ³ REDACTED/REDACTED — [repo](https://github.com/REDACTED/REDACTED) (OSS engine + FastAPI server + MCP server; auth/multi-user positioned in REDACTED Cloud). All three are Apache-2.0.</sub>

## Roadmap

| Version | Milestone | Status |
|---|---|---|
| v0.1 | Core + local runtime | **Shipped** |
| v0.3 | MCP agent tools | **Shipped** |
| v0.4 | Reflection + forgetting pipelines | **Shipped** |
| v0.6 | Skill library | **Shipped** |
| v0.7 | Episodic → semantic distillation | **Shipped** |
| v1.1 | Multi-peer + bi-temporal | **Shipped** |
| v1.5 | Semantic recall cache | **Shipped** |
| v0.5 | OpenMemory MCP-shape compatibility (drop-in over SSE) | **Shipped** |
| v0.6 | Selectable embedder (`THEOMEM_EMBEDDER` local / OpenAI) | **Shipped** |
| v1.0 | Contract stable / production-ready | In progress |
| — | Agentic tool-use + injection/command safety sandbox | Planned |
| — | Layered config + `themory config` subcommand | Planned |
| — | Optional cross-encoder reranker (`Reranker` DIP) | Planned |
| — | Embedder registry + additional providers | Planned |
| v2.0 | Adaptive retrieval + graph backend | Planned |

## Status

> **Pre-release — and honest about it.** Feature-complete for the core use case and validated across 107 end-to-end scenarios (REST, MCP, CLI, browser), plus continuous real-usage evidence (our own team runs on it). Not yet published to npm. We won't put a `production-ready` label on it until we cut v1.0 — a deliberate call we make once the contract is frozen, not a marketing default. You can run it, self-host it, and build on it today — we're just not going to over-promise on the tin.

## Contributing

```bash
git clone https://github.com/usetheoai/theo-memory.git
cd theo-memory
npm install
docker compose up -d pgvector
npm test
```

We welcome issues, PRs, and feedback. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[Apache-2.0](./LICENSE) — [usetheo.dev](https://usetheo.dev)

<div align="center">

[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.usetheo.dev/)
[![X](https://img.shields.io/badge/X-@usetheodev-000000?style=flat-square&logo=x&logoColor=white)](https://x.com/usetheodev)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-usetheodev-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://linkedin.com/company/usetheodev)

</div>
