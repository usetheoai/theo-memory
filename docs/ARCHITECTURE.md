# Theo Architecture Standard

> Canonical reference for every project in the Theo ecosystem.
> All repos MUST conform. Deviations require an ADR.

## 1. Workspace Layout

Every project uses **pnpm 10+** workspaces.

```
<project-root>/
  pnpm-workspace.yaml          # packages: ["packages/*"]
  package.json                  # packageManager: pnpm@10.34.1, workspace scripts
  eslint.config.ts              # Single flat config at root (ESLint 9)
  tsconfig.json                 # Base config
  docker-compose.yaml
  Dockerfile
  CLAUDE.md
  CHANGELOG.md
  packages/
    core/                       # @usetheo/<x>      — main library
    api/                        # @usetheo/<x>-api   — REST server (Hono)
    cli/                        # @usetheo/<x>-cli   — Commander CLI (if applicable)
    mcp/                        # @usetheo/<x>-mcp   — MCP server (if applicable)
```

**Rationale:** pnpm is the community consensus for TypeScript monorepos (Inngest, Vite, Turborepo docs). Workspace packages map to deployment units — consumers install only what they need.

**Alternative rejected:** Single-package with subpath exports — couples unrelated deps (Hono in core, Commander in core). Violates ISP.

## 2. Package Naming

| Suffix | Scope | Example |
|---|---|---|
| (none) | Core library | `@usetheo/memory`, `@usetheo/rag` |
| `-api` | REST server | `@usetheo/memory-api`, `@usetheo/rag-api` |
| `-cli` | CLI tool | `@usetheo/memory-cli` |
| `-mcp` | MCP server | `@usetheo/memory-mcp` |

Scope is always `@usetheo/`. Suffix is kebab-case.

## 3. Internal Layout of Core Package

```
packages/core/src/
  contract/           # Zod schemas + pure types (zero logic, zero I/O)
  domain/             # Pure business logic + DIP interfaces (zero I/O)
    dip/              # Interface definitions
    <feature>/        # Feature-specific logic
  infrastructure/     # Adapters implementing domain interfaces (real I/O)
    db/               # Database schema, migrations, repositories
    embedders/        # Embedder implementations
    llm-providers/    # LLM provider implementations
    <adapter>/        # Other adapters
  index.ts            # Public barrel
```

**Dependency rule (DIP):**
- `contract/` depends on nothing
- `domain/` depends only on `contract/`
- `infrastructure/` implements interfaces from `domain/`, depends on `contract/` + `domain/`
- Never: `domain/` importing from `infrastructure/`

**Rationale:** Clean Architecture layer-based. Makes dependency direction explicit and enforceable.

**Alternative rejected:** Feature-based layout (`users/`, `collections/`) — insufficient orthogonal features in domain-specific libs.

## 4. Test Convention

| Type | Location | Vitest Config |
|---|---|---|
| Unit | Co-located: `<name>.test.ts` next to source | `vitest.config.ts` (default) |
| Integration | `tests/integration/` at package root | `vitest.integration.config.ts` |
| E2E | `tests/e2e/` at package or workspace root | `vitest.e2e.config.ts` |

**Co-location rule:** Unit tests live beside their source. Moving a file = moving its test. No `__tests__/` directories.

**Rationale:** Inngest pattern. Co-location makes dead tests visible (orphan `.test.ts` next to deleted source is obvious).

**Alternative rejected:** All tests in `tests/` — breaks refactor coupling; forgotten tests accumulate silently.

## 5. Build Tooling

| Concern | Tool | Config |
|---|---|---|
| TypeScript compilation | `tsc` | `tsconfig.build.json` per package |
| Test runner | Vitest 4 | 3 configs per package (see section 4) |
| Linting | ESLint 9 (flat config) | Single `eslint.config.ts` at workspace root |
| Package manager | pnpm 10+ | `packageManager` field in root `package.json` |
| Database ORM | Drizzle ORM | `drizzle.config.ts` in package with DB access |
| Container | Docker multi-stage | `Dockerfile` at workspace root |

**Scripts convention (root `package.json`):**
```json
{
  "scripts": {
    "test": "pnpm -r test",
    "test:integration": "pnpm -r test:integration",
    "typecheck": "pnpm -r typecheck",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "compose:up": "docker compose up -d pgvector",
    "compose:down": "docker compose down"
  }
}
```

## 6. Naming Conventions

| Entity | Convention | Example |
|---|---|---|
| Directories | `kebab-case` | `llm-providers/`, `agent-tools/` |
| Files | `kebab-case.ts` | `memory-store.ts`, `extraction-pipeline.ts` |
| Classes/Types | `PascalCase` | `MemoryStore`, `ExtractionResult` |
| Functions/Variables | `camelCase` | `rememberFact`, `recallSemantic` |
| Constants | `UPPER_SNAKE_CASE` | `DEFAULT_TOP_K`, `MAX_EMBED_DIM` |
| Barrel exports | `index.ts` only when public surface exists | Avoid deep re-export chains |
| IDs | `@paralleldrive/cuid2` with entity prefix | `col_`, `doc_`, `mem_`, `chk_` |

**Reserved words:** Never use `type`, `from`, `delete`, `id` as parameter names. Prefer `kind`, `source`, `remove`, `entityId`.

## When This Document Is Wrong

The code is authoritative. If this document disagrees with running code, update this document via PR with one-line rationale. Locked items (sections 1-6) require CTO sign-off to change.
