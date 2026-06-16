<div align="center">

<img src="https://usetheo.dev/logo.png" alt="Theo Memory" width="128" height="128" />

# Theo Memory

**Persistent memory for AI agents — remember, recall, forget, reflect.**

Give your agent long-term memory across users, sessions, and skills.
Drop-in TypeScript SDK. Postgres + pgvector. Works with any LLM.

[![License](https://img.shields.io/badge/license-Apache--2.0-7C3AED?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-1%2C216%20passing-brightgreen?style=flat-square)](#testing)
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

Most agents forget everything between sessions. Theo Memory gives them persistent, scoped, searchable memory — so your agent can recall that Alice is vegetarian, that the last support ticket was about billing, or that the deploy script needs a `--force` flag on Tuesdays.

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
- **Three surfaces** — REST API (Hono + OpenAPI 3.1) · MCP server · CLI
- **Docker-ready** — distroless image < 200 MB with healthcheck
- **Observable** — 16 OpenTelemetry events + per-handler spans
- **Tested** — 1,216 unit tests, 254 test files, 328 integration tests against real pgvector

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

// Skills — executable code snippets ()
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
| `POST` | `/v1/recall` | Hybrid search |
| `POST` | `/v1/forget` | Soft or hard delete |
| `POST` | `/v1/reflect` | Consolidate episodic → semantic |
| `GET` | `/v1/scopes/:type/:id/memories` | List with `?category=` filter |
| `GET` | `/v1/health` | Liveness (auth-exempt) |
| `GET` | `/v1/openapi.json` | Spec (auth-exempt) |

**Security** — Bearer auth (`THEMEMORY_API_KEY`), rate limiting (30 writes/min, 100 reads/min), CORS, 1 MB body cap, OIDC bridge for multi-tenant.

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

## Docker

```bash
docker pull usetheo/themory:0.2.0

docker run -p 8080:8080 \
  -e THEOMEM_PG_URI=postgres://... \
  -e OPENAI_API_KEY=sk-... \
  usetheo/themory:0.2.0
```

Also available from GHCR: `docker pull ghcr.io/usetheo/themory:0.2.0`

Distroless Node 22 image, < 200 MB, Trivy-gated (zero CRITICAL/HIGH CVE), healthcheck built in. The image has no shell, so one-shot subcommands like `migrate` / `health` run by overriding the entrypoint to invoke Node directly:

```bash
# Apply migrations (or `health`) against the distroless image
docker run --rm --entrypoint /nodejs/bin/node \
  -e THEOMEM_PG_URI=postgres://... \
  usetheo/themory:0.2.0 /app/dist/agent-tools/cli.js migrate
```

## CLI

```bash
themory server                      # Start REST API
themory mcp                         # Start MCP server
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
npm test                    # 1,216 unit tests
npm run test:integration    # 328 integration tests (real pgvector)
npm run typecheck           # Zero errors
npm run lint                # Zero warnings
```

| Metric | Value |
|---|---|
| Unit tests | 1,216 passing |
| Test files | 254 |
| Integration tests | 328 (against `ankane/pgvector:v0.5.1`) |
| Source lines | ~20,000 |
| DIP interfaces | 13 |
| Migrations | 15 |

## Comparison

| | Theo Memory | REDACTED | REDACTED | REDACTED/REDACTED |
|---|---|---|---|---|
| Scope tiers | User + Session + Agent + Skills | User + Agent | Blocks | Episodes |
| Local runtime | Postgres + pgvector | Self-host | Postgres | Neo4j |
| Bi-temporal | `recall({ asOf })` | — | — | Yes |
| Skills memory |  | — | — | — |
| Recall cache | Embedding cosine | — | — | — |
| Auth | Bearer + API keys + OIDC | API key | API key | API key |
| License | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |

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
| v1.0 | Contract stable / production-ready | In progress |
| — | Agentic tool-use + injection/command safety sandbox | Planned (post-P0) |
| — | Layered config + `themory config` subcommand | Planned (post-P0) |
| — | Optional cross-encoder reranker (`Reranker` DIP) | Planned (post-P0) |
| — | Embedder registry + additional providers | Planned (post-P0) |
| v2.0 | Adaptive retrieval + graph backend | Planned |

## Status

> **Pre-release.** Feature-complete for the core use case. Validated across 107 end-to-end scenarios (REST, MCP, CLI, browser). Not yet published to npm. The `production-ready` label is gated on sustained internal usage evidence.

## Contributing

```bash
git clone https://github.com/usetheodev/theo-memory.git
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
