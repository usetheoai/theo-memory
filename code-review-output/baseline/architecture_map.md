# Architecture Map -- @usetheo/memory

Generated: 2026-06-10 Phase 1 baseline

## Overview

`@usetheo/memory` is a TypeScript npm package implementing a managed three-tier memory layer
with Mem0-shape architecture (vector + LLM fact extraction + hybrid retrieval). Apache-2.0 licensed.

## Language Breakdown

| Language   | Files | LOC    |
|------------|-------|--------|
| TypeScript | 312   | 38,013 |
| JSON       | 14    | 7,758  |
| SQL        | 15    | 416    |
| **Total**  | **341** | **46,187** |

Production TypeScript: 165 files / 20,079 LOC
Test TypeScript: 147 files / 17,934 LOC (0.89:1 test-to-prod ratio)

## Architectural Layers

```
Consumer-facing surface
  src/index.ts (root barrel -- 148 LOC)
    re-exports core/ + local/

Subpath exports (package.json#exports):
  @usetheo/memory          -> src/index.ts         (default local runtime)
  @usetheo/memory/contract -> src/core/index.ts    (types only -- adapter authors)
  @usetheo/memory/theokit  -> src/theokit/         (TheoKit binding)
  @usetheo/memory/agent-tools -> src/agent-tools/  (MCP tools)
  @usetheo/memory/server   -> src/server/          (REST API)
  @usetheo/memory/embedders/* -> src/embedders/    (stub/openai/local)
  @usetheo/memory/llms/*   -> src/llms/            (stub/openai)
  @usetheo/memory/cache-pg -> src/local/recall-cache/ (semantic cache)

Dependency direction (DIP enforced):
  src/core/          <-- contracts, types, pure logic (NO I/O)
    ^
    |-- src/local/         <-- Postgres+pgvector runtime (implements core contracts)
    |-- src/server/        <-- REST API (Hono; depends on core/ for Memory interface)
    |-- src/agent-tools/   <-- MCP tools + CLI (depends on core/)
    |-- src/theokit/       <-- TheoKit binding (depends ONLY on core/)
    |-- src/embedders/     <-- Embedder implementations
    |-- src/llms/          <-- LLM implementations
    |-- src/benchmarks/    <-- Benchmark framework (depends on core/)
```

## Entry Points

1. **CLI** (`src/agent-tools/cli.ts`) -- `themory` binary
   - `themory mcp` -- start MCP server
   - `themory server` -- start REST API
   - `themory migrate` -- run Drizzle migrations
   - `themory health` -- readiness check
   - `themory remember/recall/forget/reflect` -- verb subcommands
   - `themory keys {create,list,rotate,revoke}` -- API key management

2. **REST Server** (`src/server/app.ts`) -- Hono-based HTTP server
   - POST /v1/{remember,recall,forget,reflect}
   - GET /v1/health, /v1/health/db
   - GET /v1/scopes/:type/:id/memories
   - GET /v1/openapi.json
   - Admin: /v1/admin/keys/*

3. **MCP Server** (`src/agent-tools/run-mcp-server.ts`)
   - 4 tools: remember/recall/forget/reflect
   - Transports: stdio + streamable-HTTP

4. **Library API** (`src/index.ts`) -- programmatic usage
   - `createMemory(config)` / `createLocalMemory(config)`
   - `memory.user(id).remember(text)` etc.

## Core DIP Interfaces (13)

1. Embedder -- text -> vector
2. LLM -- chat-completion fact extraction
3. VectorStore -- persistent vector storage
4. HistoryManager -- audit trail persistence
5. ReflectionPolicy -- pluggable reflection trigger
6. EvictionPolicy -- v0.4b triadic-scoring forgetting
7. SkillRepresentationStrategy -- v0.6 skill body serialization
8. ConflictResolutionPolicy -- v0.7 distillation conflict resolution
9. BenchmarkAdapter -- v0.8 benchmark framework
10. AuthVerifier -- v1.6 REST server auth
11. Tokenizer -- v0.8 token counting
12. RecallCacheStore -- v1.5 semantic cache
13. HalfLifePersister / NearestNeighborProvider / Evictor (eviction sub-DIPs)

## Key Pipelines

- **Write (remember)**: 8-phase extraction pipeline
  Context -> Retrieval -> LLM Extract -> Batch Embed -> Hash Dedup -> Payload -> Persist -> Entity Link

- **Read (recall)**: 9-step retrieval pipeline
  Preprocess -> Embed -> Semantic over-fetch -> BM25 -> Sigmoid normalize -> Entity boost -> Combined score -> Threshold gate -> Format

- **Reflect**: consolidation pipeline (manual/threshold/sleep-time policies)
- **Forget**: triadic scoring (Ebbinghaus + LRU + LLM importance) with long-tail preservation
- **Distillation**: episodic -> semantic with LLM-judged conflict resolution (v0.7)
- **Recall Cache**: cosine-based query cache with write-trigger invalidation (v1.5)
