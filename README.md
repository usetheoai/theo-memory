<div align="center">

<img src="https://usetheo.dev/logo.png" alt="Theo" width="120" height="120" />

# @usetheo/memory

**Three-tier managed memory for AI agents.**

User. Session. Agent. One API. Local dev. Cloud production.

[![License](https://img.shields.io/badge/license-Apache--2.0-7C3AED?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/Node-≥20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-1216%20passing-brightgreen?style=flat-square)](./tests)
[![Coverage](https://img.shields.io/badge/test%20files-254-blue?style=flat-square)](#testing)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fusetheo%2Fthemory-2496ED?style=flat-square&logo=docker&logoColor=white)](https://ghcr.io/usetheo/themory)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6BA539?style=flat-square&logo=openapiinitiative&logoColor=white)](#rest-api)
[![MCP](https://img.shields.io/badge/MCP-4%20tools-FF6B35?style=flat-square)](#mcp-server)
[![Status](https://img.shields.io/badge/status-pre--release-orange?style=flat-square)](#status)

[Quickstart](#quickstart) · [API](#api) · [REST Server](#rest-api) · [MCP](#mcp-server) · [Docker](#docker) · [CLI](#cli) · [Architecture](#architecture) · [Roadmap](#roadmap)

</div>

---

## What is this?

`@usetheo/memory` is a **managed memory layer for AI agents** — three scope tiers (User / Session / Agent), hybrid retrieval (semantic + BM25 + entity matching), and LLM fact extraction. Part of the [Theo](https://usetheo.dev) ecosystem.

```ts
const memory = await createLocalMemory({ vectorStore, embedder, llm });

// Write — LLM extracts facts automatically
await memory.user('alice').remember('I prefer dark mode and speak Portuguese');

// Read — hybrid retrieval across semantic + lexical signals
const facts = await memory.user('alice').recall('language preferences');
// → [{ text: 'Speaks Portuguese', score: 0.91 }]

// Forget — soft delete (bi-temporal) or hard delete (GDPR)
await memory.user('alice').forget(factId, { hard: true });

// Reflect — consolidate episodic into semantic insights
await memory.user('alice').reflect();
```

## Key features

| Feature | Description |
|---|---|
| **Three-tier scope** | `user` (cross-session) · `session` (conversation) · `agent` (procedural skills) + `repo` ( skill library) |
| **4-verb API** | `remember` · `recall` · `forget` · `reflect` — same verbs across all tiers |
| **Hybrid retrieval** | Semantic (cosine) + BM25 (lexical) + entity boost — additive scoring with threshold gating |
| **LLM fact extraction** | 8-phase write pipeline extracts discrete facts from free-form text |
| **Bi-temporal queries** | `recall({ asOf })` returns memory state at any historical point |
| **Multi-peer attribution** | `remember(text, { attributedTo: 'bob' })` — track who said what |
| **Category filtering** | `recall(query, { category: 'preferences' })` — server-side filter with btree index |
| **Semantic recall cache** | Query-embedding cosine cache — near-duplicate queries reuse results |
| **MMR diversification** | Opt-in Maximal Marginal Relevance reranking for result diversity |
| **FAANG-grade auth** | API keys (`theo_live_*`) + OIDC bridge + dual-validation middleware |
| **REST + MCP + CLI** | Three distribution surfaces — HTTP, Model Context Protocol, command-line |
| **Docker-ready** | Distroless image at `ghcr.io/usetheo/themory:0.1.0-alpha` (< 200 MB) |
| **14 Drizzle migrations** | Schema versioned; `runMigrations(pool)` applies pending; idempotent |
| **OpenTelemetry** | 16 typed events + per-handler spans — plug your exporter |
| **Apache-2.0** | Explicit patent grant; embeddable in proprietary systems |

## Quickstart

### Prerequisites

- **Node.js** ≥ 20
- **Docker** (for pgvector)
- **OpenAI API key** (or OpenRouter)

### Install & run

```bash
# 1. Clone + install
git clone https://github.com/usetheodev/theo-memory.git
cd theo-memory && npm install

# 2. Boot pgvector
docker compose up -d pgvector

# 3. Configure
cp .env.example .env
# Edit .env: set OPENAI_API_KEY (required) + THEMEMORY_API_KEY (recommended)

# 4. Apply migrations
export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem
npm run db:push

# 5. Start the server
npx themory server
# → REST API at http://localhost:8080
# → OpenAPI spec at http://localhost:8080/v1/openapi.json
```

### First memory

```bash
# Write
curl -X POST http://localhost:8080/v1/remember \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","text":"I prefer dark mode and drink espresso"}'

# Read
curl -X POST http://localhost:8080/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"userId":"alice","query":"coffee preferences"}'
```

## API

### Three tiers

```ts
// User — durable, cross-session
await memory.user('alice').remember('Allergic to peanuts');

// Session — conversation-scoped
await memory.session('conv-42').remember('Asked about pricing tier B');

// Agent — procedural skills
await memory.agent('support-bot').remember('Check last 3 invoices before opening a refund ticket');

// Skills —  code-as-skill library (4th tier)
const skills = memory.skills('my-repo');
await skills.add({ description: 'Deploy to staging', code: '...', codeLanguage: 'typescript' });
```

### Advanced recall

```ts
// With category filter
const prefs = await memory.user('alice').recall('preferences', {
  category: 'food',
  topK: 5,
  threshold: 0.1,
});

// With bi-temporal point-in-time query
const snapshot = await memory.user('alice').recall('address', {
  asOf: new Date('2026-01-15'),
});

// With multi-peer attribution filter
const bobSaid = await memory.user('alice').recall('project updates', {
  attributedTo: 'bob',
});

// With MMR diversification
const diverse = await memory.user('alice').recall('interests', {
  diversify: { lambda: 0.7 },
});
```

## REST API

Standalone HTTP server powered by [Hono](https://hono.dev). OpenAPI 3.1 spec auto-generated from Zod schemas.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/remember` | Store a memory (LLM extracts facts) |
| `POST` | `/v1/recall` | Semantic + hybrid search |
| `POST` | `/v1/forget` | Soft or hard delete |
| `POST` | `/v1/reflect` | Consolidate episodic → semantic |
| `GET` | `/v1/scopes/:type/:id/memories` | Paginated listing with `?category=` filter |
| `GET` | `/v1/health` | Liveness probe (auth-exempt) |
| `GET` | `/v1/health/db` | DB connectivity probe |
| `GET` | `/v1/openapi.json` | OpenAPI 3.1 spec |

**Security:**

- Bearer auth via `THEMEMORY_API_KEY` env (opt-in; alpha mode = open when unset)
- CORS configurable via `THEMORY_CORS_ORIGIN` env (default `*`)
- Rate limiting: 30 writes/min, 100 reads/min (configurable via env)
- 1 MB body limit (DOS protection)
- OIDC bridge + API key lifecycle for multi-tenant (see [Auth docs](#authentication))

## MCP Server

4 tools exposed via [Model Context Protocol](https://modelcontextprotocol.io) — works with Claude Code, Claude Desktop, Cursor, and any MCP-aware agent.

```json
// .mcp.json (Claude Code)
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

**Tools:** `remember` · `recall` · `forget` · `reflect`

**Transports:** stdio (default) · streamable-HTTP (auto-selects when `THEMEMORY_API_KEY` is set)

## Docker

```bash
# Pull
docker pull ghcr.io/usetheo/themory:0.1.0-alpha

# Run with docker-compose (includes pgvector)
docker compose -f docker-compose.prod.yaml up -d

# Or standalone
docker run -e THEOMEM_PG_URI=postgres://... -e OPENAI_API_KEY=sk-... \
  -p 8080:8080 ghcr.io/usetheo/themory:0.1.0-alpha
```

- **Image:** distroless Node 22 runtime (< 200 MB)
- **Entrypoint:** `themory server` (migrate-on-startup built in)
- **Healthcheck:** `GET /v1/health` configured in compose
- **Trivy gate:** zero CRITICAL/HIGH CVE at publish time

## CLI

```bash
# Server lifecycle
themory server                    # Start REST API on :8080
themory mcp                       # Start MCP server (stdio or HTTP)
themory migrate                   # Apply pending Drizzle migrations
themory health --deep             # Probe embedder + LLM + DB

# Memory verbs (one-shot operations)
themory remember 'Prefers dark mode' --user alice
themory recall 'UI preferences' --user alice --top-k 5
themory forget <memory-id> --hard
themory reflect --user alice

# API key management
themory keys create --name my-app --scope memory:read --scope memory:write
themory keys list
themory keys rotate <key-id>
themory keys revoke <key-id>
```

## Architecture

```
src/
├── core/              Contracts, types, extraction pipeline (no I/O)
│   ├── dip/           8 DIP interfaces (VectorStore, Embedder, LLM, ...)
│   ├── extraction/    8-phase LLM fact extraction pipeline
│   └── retrieval/     9-step hybrid search (semantic + BM25 + entity)
├── local/             Postgres + pgvector adapter (15 migrations)
├── server/            Hono REST API + auth middleware + rate-limit + CORS
├── agent-tools/       MCP server (stdio + streamable-HTTP)
├── embedders/         LocalTransformerEmbedder (Xenova MiniLM, 384-dim)
├── llms/              OpenAI-compatible LLM client
└── theokit/           TheoKit framework binding (structural typing)
```

**Dependency direction:** `core/` → nothing · `local/` → `core/` · `server/` → `core/` · `agent-tools/` → `core/`

### Write pipeline (8 phases)

```
Input text → Context gather → Existing retrieval → LLM extraction →
Batch embed → Hash dedup → Payload compose → Batch persist → History audit
```

### Search pipeline (9 steps)

```
Query → Preprocess → Embed → Semantic over-fetch → BM25 → Sigmoid normalize →
Entity boost → Combined score → Threshold gate → Format
```

## Testing

```bash
npm test                          # 1216 unit + contract tests
npm run test:integration          # Integration against real pgvector
npm run typecheck                 # tsc --noEmit (zero errors)
npm run lint                      # ESLint (zero warnings)
```

| Metric | Value |
|---|---|
| Unit + contract tests | **1,216 passing** |
| Test files | **254** |
| Integration tests (pgvector) | 328 passing |
| Type errors | 0 |
| Lint warnings | 0 |
| Source LoC | ~20,000 |
| DIP interfaces | 13 |
| Drizzle migrations | 15 |

## Authentication

Three layers, incrementally adopted:

| Layer | When | How |
|---|---|---|
| **Alpha mode** | `THEMEMORY_API_KEY` unset | All endpoints open (dev default) |
| **Bearer auth** | `THEMEMORY_API_KEY` set | Single shared secret; health endpoints exempt |
| **API key lifecycle** | `createServer({ adminApi })` | Stripe-shape `theo_live_*` keys with scopes, rotation, revocation |
| **OIDC bridge** | `--issuer` + `--client-id` | RFC 7662 introspection + `dualValidationAuth` middleware |

## Status

> **Pre-release.** The `@usetheo/memory` npm package is reserved but not yet published. The system is feature-complete for vector-based hybrid OSS use cases and validated by [107 RED TEAM scenarios](#testing) across REST, MCP, CLI, and browser E2E — but the [`/dogfood` gate](https://github.com/usetheodev/theo-memory/blob/develop/.claude/knowledge-base/dogfood/manifest.md) blocks the `production-ready` label until the anchor scenario runs ≥ 30 days with evidence.

**What works today:**

- 4-verb API across 4 scope tiers (User / Session / Agent / Repo-Skills)
- 8-phase write pipeline + 9-step hybrid retrieval
- Reflection (manual + threshold + sleep-time policies)
- Forgetting with long-tail preservation (Ebbinghaus + LRU + LLM importance)
-  skill library with consolidation
- Episodic → semantic distillation with LLM-judged conflict resolution
- Multi-peer attribution + bi-temporal `asOf` queries
- Semantic recall cache with query-embedding cosine
- REST API (Hono + OpenAPI 3.1 + Bearer auth + rate-limit + CORS)
- MCP server (stdio + streamable-HTTP + Bearer auth)
- Docker stack (distroless, < 200 MB, Trivy-gated)
- CLI (`themory` with 8 subcommands)
- FAANG-grade auth lifecycle (API keys + OIDC + dual-validation)
- Category filter (server-side, btree-indexed)
- Dashboard integration (4-tab scope browser at TheoCloud)

## Roadmap

| Version | What | Status |
|---|---|---|
| v0.0 | Type contract + 9 ADRs | Shipped |
| v0.1 | Core + local runtime (pgvector) | Shipped |
| v0.2 | TheoKit binding | Shipped (PR-A) |
| v0.3 | MCP agent tools (stdio + HTTP) | Shipped |
| v0.4a | Reflection pipeline (3 policies) | Shipped |
| v0.4b | Forgetting with long-tail preservation | Shipped |
| v0.6 |  skill library | Shipped |
| v0.7 | Episodic → semantic distillation | Shipped |
| v0.8 | Independent benchmark reproduction | Shipped |
| v1.1 | Multi-peer attribution + bi-temporal | Shipped |
| v1.5 | Semantic recall cache | Shipped |
| **v1.0** | **Contract stable / production-ready** | **Blocked on /dogfood** |
| v0.5 | TheoCloud managed runtime | Planned |
| v1.2 | Adaptive retrieval (Self-RAG hooks) | Planned |
| v1.3 | Optional graph backend | Planned |

## Comparison

| | @usetheo/memory | REDACTED | REDACTED | REDACTED/REDACTED |
|---|---|---|---|---|
| Architecture | vector-based hybrid hybrid retrieval | Pioneered the shape | OS-hierarchical | Temporal knowledge graph |
| Scope tiers | User + Session + Agent + Skills | User + Agent | Blocks | Episodes + entities |
| Local runtime | Postgres + pgvector | Self-host | Postgres | a graph database / Postgres |
| Managed runtime | TheoCloud (same platform as deploy) | REDACTED Cloud (separate) | REDACTED Cloud (separate) | REDACTED Cloud (separate) |
| Bi-temporal | `recall({ asOf })` | No | No | Yes |
| Skills memory |  consolidation | No | No | No |
| Recall cache | Query-embedding cosine | No | No | No |
| License | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |

> If you're not on TheoKit/TheoCloud, [REDACTED](https://REDACTED.ai) is a great pick. `@usetheo/memory` is what you reach for when you want memory on the same invoice as your deploy.

## Contributing

```bash
git clone https://github.com/usetheodev/theo-memory.git
cd theo-memory
npm install
docker compose up -d pgvector
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. Issues and PRs welcome.

## License

[Apache-2.0](./LICENSE) — [usetheo.dev](https://usetheo.dev)

## Community

[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.usetheo.dev/)
[![X](https://img.shields.io/badge/X-@usetheodev-000000?style=flat-square&logo=x&logoColor=white)](https://x.com/usetheodev)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-usetheodev-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://linkedin.com/company/usetheodev)
