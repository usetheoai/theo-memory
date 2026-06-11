# Component Inventory -- @usetheo/memory

Generated: 2026-06-10 Phase 1 baseline

## Summary

- Total components: 26
- Total files inventoried: 341 (312 TypeScript + 14 JSON + 15 SQL)
- Excluded files: 15 (SQL migrations -- auto-generated)
- Production LOC: ~20,079
- Test LOC: ~17,934

## Components by Layer

### Entry Points (4)

| Component | Path | LOC | Description |
|-----------|------|-----|-------------|
| cli-entrypoint | src/agent-tools/cli.ts | 370 | themory CLI router |
| server-entrypoint | src/server/app.ts | 200 | Hono REST server factory |
| mcp-server-entrypoint | src/agent-tools/run-mcp-server.ts | 150 | MCP server bootstrap |
| root-barrel | src/index.ts | 148 | Root barrel public surface |

### Core Layer (7 modules, ~5,001 LOC prod)

| Component | Path | LOC | Description |
|-----------|------|-----|-------------|
| core | src/core/ | 5,001 | Contract layer (all DIP interfaces + pipelines) |
| core-dip | src/core/dip/ | 800 | 13 DIP interface definitions |
| core-extraction | src/core/extraction/ | 500 | 8-phase write pipeline |
| core-retrieval | src/core/retrieval/ | 400 | 9-step search pipeline |
| core-reflection | src/core/reflection/ | 300 | Reflection pipeline orchestrator |
| core-conflict-resolution | src/core/conflict-resolution/ | 400 | v0.7 distillation policies |
| core-scoring | src/core/scoring-strategies/ | 200 | Additive scoring strategies |

### Local Runtime Layer (5 modules, ~6,534 LOC prod)

| Component | Path | LOC | Description |
|-----------|------|-----|-------------|
| local | src/local/ | 6,534 | Postgres+pgvector runtime |
| local-eviction | src/local/eviction/ | 1,500 | Triadic-scoring forgetting |
| local-recall-cache | src/local/recall-cache/ | 800 | Semantic recall cache |
| local-skills | src/local/skills/ | 600 | Skill library |
| local-reflection | src/local/reflection/ | 400 | Reflection persistence |

### Server Layer (3 modules, ~2,731 LOC prod)

| Component | Path | LOC | Description |
|-----------|------|-----|-------------|
| server | src/server/ | 2,731 | REST API layer |
| server-auth | src/server/auth/ | 800 | Auth subsystem (bearer/API-key/OIDC) |
| server-handlers | src/server/handlers/ | 600 | HTTP handlers |

### Agent Tools Layer (3 modules, ~3,394 LOC prod)

| Component | Path | LOC | Description |
|-----------|------|-----|-------------|
| agent-tools | src/agent-tools/ | 3,394 | MCP tools + CLI layer |
| agent-tools-mcp-tools | src/agent-tools/tools/ | 500 | MCP tool definitions |
| agent-tools-transports | src/agent-tools/transports/ | 400 | MCP transports |

### Adapter Modules (4 modules)

| Component | Path | LOC | Description |
|-----------|------|-----|-------------|
| embedders | src/embedders/ | 345 | Embedder implementations |
| llms | src/llms/ | 262 | LLM implementations |
| theokit | src/theokit/ | 85 | TheoKit binding |
| benchmarks | src/benchmarks/ | 1,579 | Benchmark framework |

## Test Distribution

- 147 test files across all layers
- Test-to-production ratio: 0.89:1
- Tests co-located in `__tests__/` directories within each module
