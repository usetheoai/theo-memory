# Blueprint: v0.1 Local Runtime (Mem0-shape pipeline + pgvector schema)

> **Version 1.0** — Technical synthesis of how `.claude/knowledge-base/references/mem0/mem0-ts/` implements the locked Mem0-shape pipeline (6-phase write + 9-step search + additive scoring + hash dedup + entity store + per-row fallback) and how `.claude/knowledge-base/references/letta/` schemas + tests pgvector against real Postgres. Informs the v0.1 `/to-plan` for the local runtime.

**Slug:** `v0-1-local-runtime`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-1-local-runtime-plan.md` (v1.1)
**Owner:** TheMemory v0.1 cycle-discover
**Generated:** 2026-05-22 via `/discover-execute`
**Confidence verdict:** TBD (updated by `/discover-confidence`)

## Context

Roadmap Item 2 (v0.1 — Core + local runtime) requires concrete decisions for the 6-phase write, 9-step search, hash dedup, entity store, pgvector schema, integration tests, and dev tooling. The blueprint synthesizes evidence from `.claude/knowledge-base/references/mem0/mem0-ts/` (primary architectural reference, 4h budget) and `.claude/knowledge-base/references/letta/` (pgvector schema + Alembic migrations + integration test patterns, 2h budget). LangMem deferred per plan D3.

## Objective

Enable `/to-plan v0-1-local-runtime` to lock concrete v0.1 decisions for every pipeline stage, schema column, dep choice, and dev tooling element — each grounded in a verified `.claude/knowledge-base/references/{...}` citation.

---

## Coverage Corner 1 — Integration Tests

> Populated by `/discover-execute` from Q4 (Mem0) + Q5 (Letta). LangMem deferred per plan D3.

### Mem0 (Q4)

**EC-2 sampling executed:** 26 total `.test.ts` files; 10 matched pre-filter Grep `\.add\(|\.search\(|extraction`; sampled 3 representatives — `memory.add.test.ts` (178 LoC, pipeline-add focus), `memory.crud.test.ts` (386 LoC, get/update/delete/getAll/search/history), `pgvector.unit.test.ts` (126 LoC, pgvector adapter SQL mock).

**Test framework:** Jest (`jest.setTimeout(15000)` for memory tests, `30000` for crud, no timeout overrides on adapter tests). `/// <reference types="jest" />` per file.

**Pattern shared across the pipeline tests (`memory.add.test.ts`, `memory.crud.test.ts`):**

1. **Mock unrelated providers to prevent CI crashes** (`memory.add.test.ts:12-17`): `jest.mock("../src/embeddings/google", ...)` and `("../src/llms/google", ...)` because `@google/genai` would otherwise crash in CI environment lacking credentials. Pattern is defensive — mock providers you DON'T use so they don't import-side-effect.

2. **Content-based LLM mock** (`memory.add.test.ts:19-46`, `memory.crud.test.ts:19-46`):
   ```ts
   generateResponse: jest.fn().mockImplementation((messages) => {
     const userMsg = messages.find(m => m.role === "user");
     const content = userMsg?.content ?? "";
     const newMsgMatch = content.match(/## New Messages\n([\s\S]*?)(?=\n##|$)/);
     const extracted = newMsgMatch ? newMsgMatch[1].trim() : "extracted fact";
     return JSON.stringify({
       memory: [{ id: "0", text: extracted, attributed_to: "user" }],
     });
   })
   ```
   The mock parses the actual prompt (extracts the "## New Messages" section) and echoes it as the extracted fact. The echo makes tests DETERMINISTIC (no real LLM) while still exercising the prompt-composition + parse + downstream pipeline. Comment at memory.crud.test.ts:3-4 confirms: "Tests verify real behavior, not mock echoes."

3. **Mock embedder with fixed vector** (`memory.add.test.ts:48-59`):
   ```ts
   const mockEmbedding = new Array(1536).fill(0.1);
   jest.mock("../src/embeddings/openai", () => ({
     OpenAIEmbedder: jest.fn().mockImplementation(() => ({
       embed: jest.fn().mockResolvedValue(mockEmbedding),
       embedBatch: jest.fn().mockImplementation((texts) =>
         Promise.resolve(texts.map(() => mockEmbedding))
       ),
       embeddingDims: 1536,
     })),
   }));
   ```
   1536-dim vector (OpenAI text-embedding-3-small shape). All embeddings identical — search ordering relies on tie-breaking, not similarity. ACCEPTABLE for testing pipeline correctness (write path doesn't depend on embedding diversity).

4. **In-memory vector store + SQLite** (`memory.add.test.ts:61-83`):
   ```ts
   vectorStore: { provider: "memory", config: { dbPath: ":memory:" } },
   historyDbPath: ":memory:",
   ```
   No Docker/Postgres dependency for these tests. The `"memory"` provider is an in-process JS Map-backed vector store; `:memory:` SQLite for history. **No testcontainers, no Docker.** Pure unit-test isolation.

5. **Per-test collection isolation** (`memory.add.test.ts:71`, `memory.crud.test.ts:71-72`):
   ```ts
   collectionName: `test-add-${Date.now()}`,         // memory.add
   collectionName: `test-crud-${Date.now()}-${Math.random()}`,  // memory.crud (extra randomness)
   ```
   Each test instance gets a fresh collection name → tests don't share state across `beforeAll`/`afterAll`.

6. **Reset via `memory.reset()` in afterAll** (`memory.add.test.ts:93-95`): clean teardown.

7. **Assertions verify behavior, not internals**:
   - `expect(result.results.length).toBeGreaterThan(0)` — pipeline produced output
   - `expect(typeof result.results[0].memory).toBe("string")` — shape check
   - `expect(stored!.metadata).toEqual(expect.objectContaining({source: "chat"}))` — metadata pass-through verified end-to-end via `memory.get(id).metadata`
   - `await expect(memory.add("test", {} as any)).rejects.toThrow("One of the filters: ...")` — error-path verification

**Pattern for pgvector adapter (`pgvector.unit.test.ts`):**

1. **Hand-rolled SQL mock router** (`pgvector.unit.test.ts:26-40`):
   ```ts
   function mockPgQuery(sql: string) {
     if (sql.includes("SELECT 1 FROM pg_database")) return { rows: [{ "?column?": 1 }] };
     if (sql.includes("FROM information_schema.tables")) return { rows: [{ table_name: "memories" }] };
     if (sql.includes("vector <=> $1::vector AS distance")) return { rows: searchRows };
     return { rows: [] };
   }
   ```
   Tests verify the **SQL strings** the adapter composes, NOT the database behavior. No real Postgres in CI.

2. **Mock `pg` module** (`pgvector.unit.test.ts:42-68`):
   ```ts
   jest.mock("pg", () => {
     const Client = jest.fn().mockImplementation((config) => ({
       config,
       connect: jest.fn().mockResolvedValue(undefined),
       query: jest.fn().mockImplementation(async (sql) => mockPgQuery(sql)),
     }));
     return { __esModule: true, default: { Client }, Client, __mock: { Client, clients } };
   });
   ```
   Track instances via `__mock.clients` for assertions like `expect(pg.__mock.Client).toHaveBeenCalledTimes(2)` (one for DB-exists check, one for table operations).

3. **Score conversion verification** (`pgvector.unit.test.ts:79-115`):
   - Adapter converts pgvector's `<=>` distance to similarity score `1 - distance`, clamped to `[0, 1]`.
   - Tested with synthetic distances `"0"`, `"0.0061..."`, `"1"`, `"2"` → expected scores `1, 0.9938..., 0, 0`.

4. **SQL composition assertion** (`pgvector.unit.test.ts:121-124`):
   ```ts
   expect(activeClient.query).toHaveBeenCalledWith(
     expect.stringContaining("vector <=> $1::vector AS distance"),
     ["[1,0,0]", 4],
   );
   ```
   Verifies the vector is formatted as `"[1,0,0]"` string (not JS array) for pgvector's parameter binding.

**Key observations for v0.1 testing strategy:**

- **NO integration tests with real Postgres in `oss/tests/`.** All "pipeline" tests run against in-memory vector store. Real-Postgres tests would live elsewhere (probably `pnpm run test:integration` invoked separately with credentials per CLAUDE.md). The pre-filter EC-2 caught the right files; none of them spin up Docker.
- **Determinism via content-based LLM mock** — port this pattern to v0.1. Real provider calls forbidden in unit suite per `.claude/rules/testing.md`.
- **In-memory adapter pattern** — TheMemory v0.1 MUST ship an `in-memory` VectorStore impl alongside `pgvector`, exactly for this test purpose. Estimated ~100 LoC.
- **pgvector adapter testing via SQL mock** — the canonical pattern for unit-testing DB adapters without a real DB. The trade-off (vs testcontainers) is sub-second tests + verifies SQL composition; testcontainers would verify END-TO-END behavior but at 5-30× the runtime cost.
- **For v0.1, RECOMMEND both layers**: (a) unit tests via SQL mock (this Mem0 pattern), (b) integration tests via `@testcontainers/postgresql` for the real round-trip (separate `tests/integration/` dir per `.claude/rules/testing.md § Pyramid`). The integration suite would have FEWER tests (only the canonical write→search loop, 1-3 tests max).
- **Jest is Mem0's choice** but TheMemory v0.0 already locked **vitest** (per ADR-0001 + plan deps). Migration is straightforward — both share the same API surface for `describe`/`test`/`expect`/`jest.fn()` → `vi.fn()`. Mock pattern: `vi.mock("module", () => ({...}))` is identical to `jest.mock("module", () => ({...}))`.

### Letta (Q5)

**EC-1 sampling executed:** 167 total Alembic migrations; **16 matched** pre-filter Grep `passages|memories|archival_memory|vector|Vector|VECTOR`; sampled 3 — `2c059cad97cc_create_sqlite_baseline_schema.py` (798 LoC, baseline schema), `068588268b02_add_vector_db_provider_to_archives_table.py` (60 LoC, middle alter), `297e8217e952_nullable_embedding_for_archives_and_.py` (36 LoC, recent alter). Plus `letta/orm/passage.py` (104 LoC) and `letta/orm/custom_columns.py:142-152` (`CommonVector` TypeDecorator).

#### Schema strategy — DUAL-backend pattern (Postgres + SQLite from one ORM)

**Cross-DB embedding column** (`.claude/knowledge-base/references/letta/letta/orm/passage.py:34-40`):

```python
if settings.database_engine is DatabaseChoice.POSTGRES:
    from pgvector.sqlalchemy import Vector
    embedding = mapped_column(Vector(MAX_EMBEDDING_DIM), nullable=True)
else:
    embedding = Column(CommonVector, nullable=True)
```

- **Postgres path:** `pgvector.sqlalchemy.Vector(MAX_EMBEDDING_DIM)` — native pgvector column. `MAX_EMBEDDING_DIM` declared in `letta/constants.py` (not read — flag for v0.1 sampling).
- **SQLite path:** `CommonVector` custom TypeDecorator with `impl = BINARY` (`.claude/knowledge-base/references/letta/letta/orm/custom_columns.py:142-152`):
  ```python
  class CommonVector(TypeDecorator):
      impl = BINARY
      cache_ok = True
      def process_bind_param(self, value, dialect):  return serialize_vector(value)
      def process_result_value(self, value, dialect): return deserialize_vector(value, dialect)
  ```
  `serialize_vector`/`deserialize_vector` (in `letta.helpers.converters`, not read) convert numpy/list ↔ bytes for SQLite BLOB storage. Note: SQLite path supports text-only search; vector similarity requires the Postgres path.

**Passage hierarchy** (`passage.py`):
- `BasePassage` (abstract) — id (PK), text, embedding_config (JSON via `EmbeddingConfigColumn` TypeDecorator), metadata_ (JSON), tags (JSON), embedding (conditional Vector/CommonVector)
- `SourcePassage extends BasePassage, FileMixin, SourceMixin` — table `source_passages` for external-file-derived passages
- `ArchivalPassage extends BasePassage, ArchiveMixin` — table `archival_passages` for long-term memory; has `passage_tags` relationship to a junction table for indexed tag queries

**Index strategy** (per-table `__table_args__` with Postgres-only indexes):
- `source_passages`: `org_idx`, `created_at_id_idx`, `file_id_idx` (POSTGRES adds `organization_id` index; SQLite omits it)
- `archival_passages`: `ix_archival_passages_org_archive` (composite), `created_at_id_idx`, `ix_archival_passages_archive_id`

**Custom JSON column types** (`custom_columns.py`): 8+ TypeDecorators with `impl = JSON, cache_ok = True` — `LLMConfigColumn`, `EmbeddingConfigColumn`, `CompactionSettingsColumn`, `ToolRulesColumn`, `ToolCallColumn`, etc. All follow the same shape: serialize_X / deserialize_X helpers.

#### Alembic migration patterns

**Baseline migration** (`2c059cad97cc_create_sqlite_baseline_schema.py:337-356`):
- Creates `agent_passages` with `sa.Column("embedding", sa.BLOB(), nullable=True)` — comment: "CommonVector becomes BLOB in SQLite"
- 14+ tables in baseline (one `op.create_table` per entity)
- Indexes added per-table

**Mid migration — add column with backfill** (`068588268b02_add_vector_db_provider_to_archives_table.py:23-49`):

```python
def upgrade() -> None:
    if settings.letta_pg_uri_no_default:
        # PostgreSQL — use enum type
        vectordbprovider = sa.Enum("NATIVE", "TPUF", name="vectordbprovider")
        vectordbprovider.create(op.get_bind(), checkfirst=True)
        op.add_column("archives", sa.Column("vector_db_provider", vectordbprovider, nullable=True))
        op.execute("UPDATE archives SET vector_db_provider = 'NATIVE' WHERE vector_db_provider IS NULL")
        op.alter_column("archives", "vector_db_provider", nullable=False)
    else:
        # SQLite — use string type
        op.add_column("archives", sa.Column("vector_db_provider", sa.String(), nullable=True))
        op.execute("UPDATE archives SET vector_db_provider = 'NATIVE' WHERE vector_db_provider IS NULL")
        # SQLite can't ALTER ... NOT NULL — leaving nullable
```

**Pattern observations:**
- Same migration file handles BOTH Postgres and SQLite via `if settings.letta_pg_uri_no_default:` branching
- Enum types: `sa.Enum("...")` for Postgres (real enum type creation); `sa.String()` for SQLite (no enum support)
- Backfill via raw SQL: `op.execute("UPDATE ... WHERE ... IS NULL")` — runs BEFORE the `NOT NULL` constraint
- SQLite limitation acknowledged inline: cannot `ALTER ... NOT NULL`; the code accepts nullable in SQLite

**Recent alter migration** (`297e8217e952_nullable_embedding_for_archives_and_.py:23-28`):
```python
def upgrade() -> None:
    op.alter_column("archival_passages", "embedding_config", existing_type=postgresql.JSON(astext_type=sa.Text()), nullable=True)
    op.alter_column("archives", ...)
    op.alter_column("source_passages", ...)
```
- Postgres-only alter (uses `postgresql.JSON`); SQLite path implicit (no else branch — alter is no-op on SQLite if column already exists as JSON-mapped).

**All migrations carry `upgrade()` + `downgrade()` + standard Alembic header** (`revision`, `down_revision`, `branch_labels`, `depends_on`).

#### Integration test fixture style (`.claude/knowledge-base/references/letta/tests/conftest.py:1-80`)

- pytest framework; `pytest_configure` enables DEBUG logging
- **Server-in-background-thread fixture** (`conftest.py:22-60`): if `LETTA_SERVER_URL` env var not set, the fixture STARTS the Letta server in a daemon thread (`from letta.server.rest_api.app import start_server`), then polls `/v1/health` up to 60s for readiness
- **session-scoped `client` fixture** (`conftest.py:64-71`): wraps `Letta` SDK client (from `letta_client` package) pointed at the server
- **autouse `cleanup_db_connections` fixture** (`conftest.py:73+`): async fixture that disposes all async engines from `db_registry._async_engines` after each test
- **NO testcontainers** — fixture assumes user provides Postgres via env vars OR runs against SQLite default. Real-Postgres CI requires external provisioning.

**Test style is more INTEGRATION than UNIT** — tests hit the real server, real DB, real SDK round-trip. Compare to Mem0 (Q4) which uses in-memory mocks. The trade-off: Letta tests catch end-to-end issues; Mem0 tests run faster + don't need server setup.

#### v0.1 porting notes (Letta-informed)

- **Cross-DB pattern via conditional column type**: TheMemory v0.1 ships only pgvector at v0.1 (per ADR-0001), so we don't need the dual-backend complexity. But the Letta pattern shows how to scale to SQLite-dev-mode later without forking the schema.
- **MAX_EMBEDDING_DIM constant**: Letta declares a max embedding dimension and uses it for the pgvector column. For TheMemory, declare `MAX_EMBEDDING_DIM = 4096` (or whatever covers OpenAI text-embedding-3-large 3072 + future models) — gives room without re-migration.
- **Alembic-style backfill**: when a NOT NULL column is added, do the 3-step `add nullable → backfill → alter NOT NULL` dance. Drizzle migrations have similar pattern but syntax differs.
- **Test integration via real server**: at v0.1 we don't have an HTTP server — our integration tests will be direct DB integration (`createMemory(config).user('alice').remember('text')` against a real Docker-Postgres). Closer to Mem0's `vectorStore: { provider: "memory" }` test style but with `provider: "pgvector"` + Docker per `.claude/rules/testing.md § Pyramid`.
- **Dual-storage pattern (passage_tags junction)**: Letta keeps tags both as JSON on the row AND in a junction table for indexed queries — relevant if v0.1 introduces tagging. NOT in our v0.1 contract — flag for future.
- **EmbeddingConfig stored as JSON column**: Letta lets each row carry its own embedding config (provider + model + dims). TheMemory has the option to follow if we ever support mixed embedding providers in the same scope; v0.1 keeps it minimal (single embedder per Memory instance per `MemoryConfig.embedder`).

### LangMem

ADR-deferred per discovery plan D3 (procedural memory; revisit at v0.6 Voyager skills cycle).

---

## Coverage Corner 2 — Dependencies

> Populated by `/discover-execute` from Q6 (dual-source: declared ranges + resolved versions).

### Mem0 (Q6)

**Dual-source executed:** `.claude/knowledge-base/references/mem0/mem0-ts/package.json` (declared) + `.claude/knowledge-base/references/mem0/mem0-ts/pnpm-lock.yaml` (resolved via pnpm lockfile v9.0).

| Package | Declared | Resolved | Role |
|---|---|---|---|
| `pg` | `8.11.3` (exact pin) | `8.11.3` | Postgres client; raw-SQL only |
| `@types/pg` | `8.11.0` | (devDep) | TS types for `pg` |
| `better-sqlite3` | `^12.6.2` | `12.6.2` | SQLite history store (sync; in-memory + file modes) |
| `@types/better-sqlite3` | `^7.6.13` | (devDep) | TS types |
| `uuid` | `9.0.1` (exact pin) | `9.0.1` | Memory ID generation |
| `@types/uuid` | `^9.0.8` | (devDep) | TS types |
| `zod` | `^3.24.1` | `3.24.2` | LLM-response schema parsing (`AdditiveExtractionSchema`) |
| `natural` | `^8.0.1` | `8.1.1` | Porter stemmer for BM25 lemmatization (optional; tryrequire fallback) |
| `openai` | `^4.93.0` | `4.93.0` | LLM provider (one of many) |
| `@anthropic-ai/sdk` | `^0.40.1` | `0.40.1` | LLM provider (alternative) |

**Critical finding — NO `pgvector` npm package**: Mem0-ts talks to pgvector via raw SQL through the `pg` client. Verified via Grep on `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/vector_stores/pgvector.ts`:
- L105: `// Create vector extension` → executes `CREATE EXTENSION IF NOT EXISTS vector`
- L144: `vector vector(${dims}),` → table creation with native pgvector column type
- L169: `USING hnsw (vector vector_cosine_ops);` → HNSW index on cosine distance
- L271: `SELECT id, vector <=> $1::vector AS distance, payload` → search query (`<=>` is pgvector cosine distance operator)
- L310: `SET vector = $1::vector, payload = $2::jsonb` → update query

This means Mem0 chose **raw SQL composition** over an ORM/wrapper layer. The trade-off: leaner deps (no Drizzle/Prisma/TypeORM in scope), but more SQL strings to type-check manually.

**Notable absences:**
- No ORM (Drizzle, Prisma, Kysely, TypeORM) — raw `pg.query(sql, [params])` everywhere
- No migration tool (Knex, db-migrate, etc.) — schema bootstrapped via `IF NOT EXISTS` DDL on `initialize()` call
- No connection pool wrapper — direct `pg.Client` per adapter instance (a higher-level pool would help in production)

### Letta (Q6)

**Dual-source executed:** `.claude/knowledge-base/references/letta/pyproject.toml` (declared) + `.claude/knowledge-base/references/letta/uv.lock` (resolved).

| Package | Declared | Resolved | Role |
|---|---|---|---|
| `pgvector` | `>=0.4.1` (in `[postgres]` extra) | `0.4.1` | Python pgvector + pgvector.sqlalchemy.Vector for ORM column type |
| `psycopg2` | `>=2.9.10` (in `[postgres]` extra) | `2.9.10` | Sync Postgres driver |
| `psycopg2-binary` | `>=2.9.10` (in `[postgres]` extra) | `2.9.10` | Sync Postgres driver (binary distribution) |
| `asyncpg` | `>=0.30.0` (in `[postgres]` extra) | `0.30.0` | Async Postgres driver |
| `pg8000` | `>=1.30.3` (in `[postgres]` extra) | (resolved) | Pure-Python Postgres driver (third alternative!) |
| `sqlalchemy[asyncio]` | `>=2.0.41` | `2.0.43` | ORM + async session support |
| `sqlalchemy-json` | `>=0.7.0` | (resolved) | JSON column helpers |
| `sqlalchemy-utils` | `>=0.41.2` | (resolved) | Misc ORM utilities |
| `alembic` | `>=1.13.3` | `1.16.4` | Migration framework |
| `marshmallow-sqlalchemy` | `>=1.4.1` | (resolved) | Schema serialization |

**`[postgres]` is an OPTIONAL install extra** (`pyproject.toml` line where it appears). Default install gives SQLite-only Letta; `pip install letta[postgres]` adds pgvector + drivers. The optional extra matches the dual-backend ORM strategy from Q5.

**Three Postgres drivers shipped** (psycopg2 sync + psycopg2-binary + asyncpg + pg8000): Letta supports multiple driver families because their SQLAlchemy code can swap at config time. For TheMemory v0.1 we pick ONE — recommended `pg` (Node) or `postgres` (postgres-js) for TypeScript.

### v0.1 consolidated dep shortlist with Rule 9

> Recommendation: PICK ONE primary path. The mem0-ts raw-SQL-via-`pg` approach is closest to our locked DIP shape (`VectorStore` adapter); Letta's SQLAlchemy approach is overkill for v0.1 (we already have our own type contract).

| Package | Recommended for v0.1 | Why | Rule 9 alternatives evaluated |
|---|---|---|---|
| `pg` `^8.11.3` | **ADOPT** | Direct Postgres client; closest match to Mem0-ts reference impl; battle-tested at scale | **Rejected:** `postgres` (postgres-js) — newer; smaller; less mature TS types as of 2026. `pg-promise` — extra layer of abstraction we don't need. |
| `pgvector` npm | **REJECT** (raw SQL only) | Mem0 confirms raw SQL works fine with `pg`; pgvector npm package adds ~zero value over direct `pg.query("... vector(${dims}) ...")` | **Rejected:** `pgvector` (the npm pkg) — thin wrapper; adds bundle weight; locked-in to its dim/index API which is no friendlier than raw SQL. |
| `drizzle-orm` `^0.30` + `drizzle-kit` | **ADOPT** | Type-safe SQL builder; needed for migrations + schema-as-code per ADR-0006 bi-temporal columns; better DX than raw `pg.query()` | **Rejected:** Prisma — heavyweight + own query engine (Rust); Kysely — strong contender but Drizzle has better TS-types for pgvector via plugins; raw `pg` only — viable but loses migration safety net Letta gets from Alembic. |
| `node:crypto` | **ADOPT** (built-in) | MD5 hashing for dedup per Q3; UUID v7 (or v4 fallback) — both in node:crypto since 20.x | **Rejected:** external `uuid` package — Mem0 uses it but `node:crypto.randomUUID()` is built-in and produces v4 UUIDs without extra dep. Save the npm install. |
| `natural` `^8.1.x` | **ADOPT** as optional peer | Porter stemmer for BM25 lemmatization per Q3; Mem0 uses try-require pattern (graceful fallback to simpleStem) | **Rejected:** compromise — different paradigm; not BM25-canonical. **Pattern**: declare `natural` as `peerDependenciesMeta.optional = true`; ship `simpleStem` as built-in fallback. |
| `zod` `^3.24` | **ADOPT** | Schema validation for LLM responses (additive extraction shape) AND for `MemoryConfig` validation at construction | **Rejected:** `io-ts` — less ergonomic; `valibot` — newer, less battle-tested at our scope; raw type assertion — no runtime safety. |
| `better-sqlite3` | **DEFER to v0.4** | Mem0 uses it for history store + tests; we ship pgvector-only at v0.1; history can be in same Postgres | **Rejected for v0.1:** `sqlite3` (async) — slower than better-sqlite3; **rationale to defer**: avoid two DB backends at v0.1; HistoryManager uses Postgres adapter at v0.1, SQLite ships as alternative at v0.4 if needed. |
| `openai` `^4.x` / `@anthropic-ai/sdk` | **NEITHER as runtime dep** | LLM is a DIP (per ADR-0008); user provides their own client | **Rationale:** TheMemory shouldn't bundle LLM clients. Consumers wire `OpenAILLM`/`AnthropicLLM` themselves; we provide reference adapters in `examples/` (not `src/local/`). |

**Net v0.1 runtime deps:**
- `pg` (Postgres client)
- `drizzle-orm` + `drizzle-kit` (type-safe SQL + migrations)
- `zod` (validation)
- `natural` as optional peer (with built-in `simpleStem` fallback)

Plus the already-locked devDeps from v0.0 (typescript, vitest, eslint, etc.).

**Deferred to v0.5 (cloud):** none of the above change for cloud; cloud adapter swaps `pg` connection target.

<!-- Letta deps covered in the table above (Q6 Letta section). The consolidated shortlist with Rule 9 recommendations is the load-bearing output of this corner. -->

### LangMem

ADR-deferred per discovery plan D3.

---

## Coverage Corner 3 — Tools

> Populated by `/discover-execute` from Q7 (local-dev story).

### Mem0 (Q7)

**`server/docker-compose.yaml`** (76 LoC; `.claude/knowledge-base/references/mem0/server/docker-compose.yaml`) — 3 services:

| Service | Image / build | Port | Notes |
|---|---|---|---|
| `mem0` | `build: server/dev.Dockerfile` | `8888:8000` | FastAPI; hot-reload via `.:/app` bind mount; `command: ... alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000 --reload`; `depends_on: postgres: condition: service_healthy` |
| `postgres` | **`ankane/pgvector:v0.5.1`** | `8432:5432` | Port-shifted to avoid local-Postgres conflict; `shm_size: 128mb`; volume `postgres_db`; init script via `./init-db.sh` mount; healthcheck `pg_isready -q -d postgres -U postgres` every 5s/5s/5 retries |
| `mem0-dashboard` | `build: ./dashboard` (Next.js) | `3000:3000` | Optional UI; depends on `mem0` started |

Critical pattern — **migration runs in the service's startup command**:
```yaml
command: >
  sh -c "rm -rf /app/packages && pip install -q --force-reinstall --no-deps mem0ai && alembic upgrade head && uvicorn main:app ..."
```

Migration is NOT a separate one-shot job; it's embedded in the service container's entry. The embedding means every `docker compose up` re-runs `alembic upgrade head` (Alembic is idempotent — applies only un-applied revisions).

**`server/Makefile`** (62 LoC):
- `make up` → port-conflict check (lsof) + `docker compose up -d --build` + `wait-api` + `wait-dashboard` (curl polling loops)
- `make down` → `docker compose down`
- `make clean` → `docker compose down -v` (removes volumes)
- `make logs` → `docker compose logs -f`
- `make seed` → runs `scripts/seed.sh` for initial admin user
- `make bootstrap` → up + wait + seed
- `make health` → `curl` checks all 3 services; `pg_isready` exec on postgres container
- `make build` → docker build for production image (no compose)
- `make run_local` → `docker run -p 8000:8000 -v $(pwd):/app mem0-api-server --env-file .env`

**`mem0-ts/package.json` scripts** (`.claude/knowledge-base/references/mem0/mem0-ts/package.json`):
```json
{
  "build": "npm run clean && npx prettier --check . && npx tsup",
  "dev": "npx nodemon",
  "test": "jest",
  "test:unit": "jest --coverage --ci --testPathIgnorePatterns='/node_modules/' '/dist/' 'integration'",
  "test:integration": "jest --config jest.integration.config.js --forceExit",
  "test:ci": "jest --coverage --ci",
  "test:watch": "jest --config jest.config.js --watch",
  "format": "npm run clean && prettier --write .",
  "format:check": "npm run clean && prettier --check ."
}
```

Two-tier test config: **`jest.config.js`** for unit (in-memory, mocks) + **`jest.integration.config.js`** for integration (real Postgres / containers). Integration requires `--forceExit` (lingering DB connections after tests). The `test:unit` script EXPLICITLY excludes paths containing `'integration'` — keeps the default `npm test` under a second.

### Letta (Q7)

**`compose.yaml`** (65 LoC; `.claude/knowledge-base/references/letta/compose.yaml`) — 3 services:

| Service | Image | Port | Notes |
|---|---|---|---|
| `letta_db` | **`ankane/pgvector:v0.5.1`** (SAME as Mem0) | `${LETTA_PG_PORT:-5432}:5432` | Network aliases `pgvector_db` + `letta-db`; volume `./.persist/pgdata` (bind); env-driven user/pwd/db (defaults `letta`/`letta`/`letta`); init via `./init.sql` mount; healthcheck `pg_isready -U letta` 5s/5s/5 retries |
| `letta_server` | `letta/letta:latest` (published image) | `8083` + `8283` | Env-driven config: `LETTA_PG_URI`, plus API keys for OPENAI/GROQ/ANTHROPIC/OLLAMA/AZURE/GEMINI/VLLM/OPENLLM, plus OTel exporter envs (CLICKHOUSE_* for Mem0-style observability) |
| `letta_nginx` | `nginx:stable-alpine3.17-slim` | `80:80` | Static reverse proxy via `./nginx.conf` |

**No Makefile present in Letta root** (verified absent via directory listing of the cloned project).

**`dev-compose.yaml`** (48 LoC; not Read in detail) — alternative compose for development. Smaller; likely omits nginx + uses build context instead of published image.

**`init.sql`** at repo root — pre-bootstrap SQL run on first DB startup (creates extensions etc.).

**Migration strategy:** Letta uses Alembic but the compose doesn't run `alembic upgrade head` explicitly in `command:` — Letta's app entry must invoke it on startup (verify in `letta/server/rest_api/app.py` — not Read; flag for v0.1 if needed).

### v0.1 local-dev shape recommendation

**CONVERGED PATTERN both refs use:**
- pgvector via **`ankane/pgvector:v0.5.1`** (or later) Docker image — canonical pgvector image, well-maintained
- pgvector port-shift OPTIONAL (Mem0 uses 8432; Letta uses 5432 default) — TheMemory defaults to 5432 with env override
- Healthcheck via `pg_isready` 5s/5s/5 retries
- Volume for data persistence (named volume OR bind mount)
- Migration run on startup (Alembic upgrade head idempotent pattern)

**v0.1 docker-compose proposal:**

```yaml
# theo-memory/docker-compose.yaml (v0.1)
services:
  pgvector:
    image: ankane/pgvector:v0.5.1
    ports:
      - "${THEOMEM_PG_PORT:-5432}:5432"
    environment:
      - POSTGRES_USER=${THEOMEM_PG_USER:-theomem}
      - POSTGRES_PASSWORD=${THEOMEM_PG_PASSWORD:-theomem}
      - POSTGRES_DB=${THEOMEM_PG_DB:-theomem}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${THEOMEM_PG_USER:-theomem}"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - theomem_pgdata:/var/lib/postgresql/data

volumes:
  theomem_pgdata:
```

Smaller than both refs (no app service since TheMemory is a library, not a server). User runs `docker compose up -d pgvector` and points the library at `localhost:${THEOMEM_PG_PORT:-5432}`.

**v0.1 package.json scripts proposal:**

```json
{
  "build": "tsup",
  "test": "vitest run --config vitest.contract.config.ts",
  "test:integration": "vitest run --config vitest.integration.config.ts --reporter=verbose",
  "test:integration:setup": "docker compose up -d pgvector && drizzle-kit push:pg",
  "test:integration:teardown": "docker compose down -v",
  "test:watch": "vitest --config vitest.contract.config.ts",
  "test:coverage": "vitest run --coverage",
  "typecheck": "tsc --noEmit -p tsconfig.contract.json",
  "lint": "eslint 'src/**/*.ts' --no-error-on-unmatched-pattern",
  "db:migrate": "drizzle-kit push:pg",
  "db:generate": "drizzle-kit generate:pg"
}
```

Two test configs (mirrors Mem0's approach): `vitest.contract.config.ts` (existing from v0.0) + new `vitest.integration.config.ts` for tests that hit real pgvector. Integration tests would live at `tests/integration/` per `.claude/rules/testing.md § Pyramid`.

**v0.1 Makefile proposal:** SKIP. `npm` scripts cover all use cases; Makefiles add a layer of indirection that React-era TS projects rarely need. Mem0's Makefile is justified because they have a multi-service stack (FastAPI + Postgres + Next.js); TheMemory v0.1 is a library — no need.

**Migration timing:** Drizzle Kit `push:pg` is the dev-time direct path (no migration file generated; pushes schema directly). For production, `generate:pg` produces SQL files committed to repo + applied via Drizzle's migrator at app startup OR a separate command. v0.1 ships `push:pg` for dev; flag production migrator for v0.5 cloud.

<!-- Letta tools detail covered in Letta subsection above; consolidated v0.1 proposal is the load-bearing output. -->

<!-- Letta tools covered in the Q7 Letta subsection above. v0.1 proposal subsection synthesizes both. -->

### LangMem

ADR-deferred per discovery plan D3.

---

## Coverage Corner 4 — Techniques

> Populated by `/discover-execute` from Q1 (6-phase write), Q2 (9-step search + additive scoring), Q3 (hash dedup + UUID→int + lemmatization).

### Technique 1 — Multi-phase write pipeline (Q1)

> **D5 note (EC-7):** ADR-0001 narrates a "6-phase write pipeline" (`.claude/rules/architecture.md § 4` Adopt list). Code reality is **8 phases** (0,1,2,3,4-5,6,7,8 per comments at `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:588,590,606,626,695,716,783,851,976`) plus an unnumbered batch-history step (805-849) between Phase 6 and 7. The 6-phase framing folds phases 0+1 → "context+retrieval", 4+5 → "dedup+payload", and treats entity-linking (Phase 7) + save-messages (Phase 8) as auxiliaries. **Blueprint reports the code's own numbering**; v0.1 implementation has discretion to flatten labels but the SHAPE is what's load-bearing.

**Public entry vs internal pipeline split:** `async add` (`.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:507-560`, 55 lines) is the public surface — validates messages, normalizes IDs (camelCase → snake_case for storage), parses vision messages, then delegates to private `addToVectorStore` (`.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:562-994`, 433 lines).

**`infer: false` escape hatch** (`.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:568-586`): when caller pre-extracted facts, skip the full pipeline — just `createMemory(content, {}, metadata)` per non-system message. Returns `{ id, memory: content, metadata: { event: "ADD" } }`. No LLM call, no entity store, no hash dedup. Per-row scope: each message becomes one memory.

**Phases (when `infer: true`):**

| Phase | Lines | Operation | Per-row fallback |
|---|---|---|---|
| 0 — Context gathering | 588-603 | `buildSessionScope(filters)` + optional `db.getLastMessages(sessionScope, 10)` | try/catch silently skips if `getLastMessages` not implemented by HistoryManager |
| 1 — Existing retrieval + UUID→int map | 606-624 | `embedder.embed(parsedMessages)` → `vectorStore.search(queryEmbedding, 10, filters)`; build `uuidMapping["0"→realUUID]` so LLM prompt sees integer IDs (anti-hallucination) | none — embed failure or vectorStore.search failure throws up (caller's responsibility) |
| 2 — LLM extraction (single call) | 626-693 | Compose `ADDITIVE_EXTRACTION_PROMPT` (+ `AGENT_CONTEXT_SUFFIX` if `isAgentScoped = !!agent_id && !user_id`) + `generateAdditiveExtractionPrompt({existingMemories, newMessages, lastKMessages, customInstructions})` → single `llm.generateResponse(..., {type: "json_object"})` call. Parse with `AdditiveExtractionSchema.parse(JSON.parse(...))`; if schema-parse fails, fallback to `extractJson(cleanResponse)` then `JSON.parse` | try/catch on LLM call → `return []` (write terminates; messages still saved at end via Phase 8). try/catch on parse → set `extractedMemories = []` |
| 3 — Batch embed | 695-714 | `embedder.embedBatch(memTexts)` → `embedMap[text] → embedding` | try/catch → per-text fallback loop: `for (text of memTexts) { try { embedder.embed(text) } catch { console.warn } }` — each text's failure is logged but doesn't terminate the loop |
| 4-5 — CPU processing + hash dedup | 716-781 | For each extractedMemory: compute `createHash("md5").update(text).digest("hex")`, skip if `existingHashes` (from existingResults.payload.hash) OR `seenHashes` contains it; `lemmatizeForBm25(text)` → textLemmatized; `uuidv4()` for memoryId; build payload `{...metadata, data, textLemmatized, hash, createdAt, updatedAt, attributed_to?, user_id?, agent_id?, run_id?}` | none structurally — dedup is in-memory; if records.length===0 after dedup, save messages and return [] (758-781) |
| 6 — Batch persist (vectors) | 783-803 | `vectorStore.insert(allVectors, allIds, allPayloads)` (single batch) | try/catch → per-row fallback: `for (i of records) { try { vectorStore.insert([v[i]], [id[i]], [p[i]]) } catch { console.error } }` — each row's failure is logged but loop continues |
| 6.5 — Batch history (unnumbered in code) | 805-849 | If `batchAddHistory` exists: try-batch → fallback to per-row `addHistory(id, null, text, "ADD", createdAt)`. If `batchAddHistory` absent: straight per-row loop with try/catch per row | per-row try/catch + console.error on each failure; never throws up |
| 7 — Batch entity linking | 851-974 | Outer try/catch (entire phase can fail without breaking the write). 7a: `extractEntitiesBatch(allTexts)` + global dedup into `globalEntities[key] = {entityType, entityText, memoryIds: Set}`. 7b: `embedder.embedBatch(entityTexts)` with per-text fallback. 7c: for each entity, `entityStore.search(entityVec, 1, filters)` (with try/catch silent); if best match score >= 0.95, update existing (try/catch → console.debug); else collect for batch insert. 7e: single `entityStore.insert(toInsertVectors, toInsertIds, toInsertPayloads)` for all NEW entities (try/catch → console.warn) | per-text on entity embed; per-entity on update; ENTIRE PHASE 7 wrapped in try/catch — entity-store failure NEVER breaks the write |
| 8 — Save messages + return | 976-994 | Optional `db.saveMessages(messages, sessionScope)` (try/catch silent); return `records.map(r => ({id: r.memoryId, memory: r.text, metadata: {event: "ADD"}}))` | try/catch silent on saveMessages — write succeeds even if message log fails |

**Citations:** `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:507-994` (full `add`+`addToVectorStore` range).

**v0.1 porting notes:**
- The 6-phase ADR-0001 label is a simplification; v0.1 MUST adopt the 8-phase shape verbatim and call out the alignment in a new ADR.
- Per-row fallback is consistently `try { batch } catch { for { try { single } catch { log } } }` — adopt this exact shape across all v0.1 I/O boundaries (vector insert, embed batch, entity insert, history batch).
- `isDeleted: 0` (Mem0 line 813) uses `number` not `boolean` — our D8 declares boolean; v0.1 MUST NOT port the literal `0` but the semantic `false`.
- `AGENT_CONTEXT_SUFFIX` triggers only when `agent_id && !user_id` — this is the "agent-only memory" hint. v0.1 ScopedMemory.agent(id) must propagate this convention.

### Technique 2 — Nine-step search with additive scoring (Q2)

> **D5 confirmation:** ADR-0001 narrates "9-step search" — code reality MATCHES exactly. 9 steps per comments at `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:1108,1112,1115,1123,1142,1155,1217,1224,1233`. No divergence to call out.

**Public entry:** `async search(query, config)` at `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:1037-1269`.

**Pre-pipeline guards** (1041-1106):
- `rejectTopLevelEntityParams` (1042) — entity IDs MUST be in `config.filters`, not top-level (Mem0 conservative API guard)
- `validateSearchParams(threshold, topK)` (1045)
- Normalize filters: strip `undefined` to avoid downstream vector-store binding bugs (1052-1064; comment at 1047-1051 calls out Qdrant/pgvector/Redis-specific failure modes)
- Default `topK = 20`, `threshold = 0.1` (1067)
- Optional advanced metadata operator processing (`AND`/`OR`/`NOT`) at 1078-1094
- **Mandatory filter:** at least one of `user_id`/`agent_id`/`run_id` MUST be set (1097-1106) — throws otherwise

**Nine steps (in code comments):**

| Step | Lines | Operation | Notes |
|---|---|---|---|
| 1 — Preprocess query | 1108-1110 | `lemmatizeForBm25(query)` → queryLemmatized; `extractEntities(query)` → queryEntities | Both utilities loaded from `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/{lemmatization,entity_extraction}.ts` |
| 2 — Embed query | 1112-1113 | `embedder.embed(query)` → queryEmbedding | Single embed call; no fallback |
| 3 — Semantic search over-fetch | 1115-1121 | `internalLimit = max(topK * 4, 60)`; `vectorStore.search(queryEmbedding, internalLimit, effectiveFilters)` | **Key invariant:** over-fetch a larger candidate pool than `topK` so steps 5-6 have signal to re-rank against |
| 4 — Keyword search (BM25) | 1123-1140 | If `vectorStore.keywordSearch` exists, `keywordSearch(queryLemmatized, internalLimit, effectiveFilters)`; else `keywordResults = null` | Per-call try/catch → null on failure; pipeline continues without BM25 (gracefully degrades) |
| 5 — Compute BM25 scores | 1142-1153 | `[midpoint, steepness] = getBm25Params(query, queryLemmatized)`; for each kw result, `bm25Scores[memId] = normalizeBm25(rawScore, midpoint, steepness)` | Skips entries where `rawScore <= 0` |
| 6 — Compute entity boosts | 1155-1215 | Dedup queryEntities (max 8, case-insensitive); for each: `embedder.embed(entity.text)` + `entityStore.search(emb, 500, filters)`; filter matches by `similarity >= 0.5`; **spread-attenuated boost** `memoryCountWeight = 1 / (1 + 0.001 * (numLinked - 1)^2)`; `boost = similarity * ENTITY_BOOST_WEIGHT * memoryCountWeight`; `max-accumulate` per linked memoryId | Per-entity try/catch → continue (one entity failure doesn't block others). Outer try/catch → console.warn. **entityStore.search limit = 500** is hard-coded |
| 7 — Build candidate set | 1217-1222 | Project `semanticResults` to `{id: String(mem.id), score: mem.score ?? 0, payload: mem.payload ?? {}}` | Only semantic results enter the scoring pool (BM25 + entity contribute SCORES, not candidates) |
| 8 — Score and rank | 1224-1231 | `scoreAndRank(candidates, bm25Scores, entityBoosts, threshold, topK)` — see scoring.ts breakdown below | |
| 9 — Format results | 1233-1264 | Filter `scored.payload.data` non-null; project to `{id, memory, hash, createdAt, updatedAt, score, metadata: payload minus internal keys, optional user/agent/run_id}` | Internal keys excluded: `user_id`, `agent_id`, `run_id`, `hash`, `data`, `createdAt`, `updatedAt`, `textLemmatized`, `attributedTo` — projected separately or removed |

**Additive scoring formula (`.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/scoring.ts:87-138`):**

```
combined = min((semantic + bm25 + entity_boost) / max_possible, 1.0)
where max_possible:
  semantic only           → 1.0
  semantic + BM25         → 2.0
  semantic + entity       → 1.5
  semantic + BM25 + entity → 2.5
```

- `ENTITY_BOOST_WEIGHT = 0.5` (scoring.ts:10)
- **Threshold gates semantic BEFORE combining** (scoring.ts:117-120): candidates with `semantic < threshold` excluded even if BM25/entity would boost them
- Sort descending by combined score; slice topK

**BM25 sigmoid normalization (`scoring.ts:23-57`):**

Query-length-adaptive params (`getBm25Params`):

| numTerms | midpoint | steepness |
|---|---|---|
| ≤3 | 5.0 | 0.7 |
| ≤6 | 7.0 | 0.6 |
| ≤9 | 9.0 | 0.5 |
| ≤15 | 10.0 | 0.5 |
| >15 | 12.0 | 0.5 |

`normalized = 1 / (1 + exp(-steepness * (raw - midpoint)))` — pure logistic sigmoid.

**v0.1 porting notes:**
- The nine-step labels in code comments match ADR-0001 — **adopt verbatim** with same numbering. Helps `/code-quality` map our impl to the ADR.
- The `internalLimit = max(topK * 4, 60)` over-fetch invariant is load-bearing for re-rank quality — port the formula, not just the spirit.
- Spread-attenuation `1 / (1 + 0.001 * (numLinked - 1)^2)` is the entity-popularity dampener — port exactly; an entity linked to 100 memories gets `≈ 1/(1+9.801) ≈ 0.092` weight per memory, vs 1.0 for entity linked to 1 memory.
- `entityStore.search` hard-coded limit of 500 (line 1178) is generous — review whether to expose as `MemoryConfig.entitySearchLimit?: number` at v0.1 or keep hard-coded.
- The "reject top-level entity params" guard (1042) is a UX convention; our three-tier scope sub-object form (`memory.user(id).recall(...)`) makes this guard moot (scope is always carried in the sub-object) — v0.1 implementation can drop the check.
- Step 6's per-entity try/catch + outer try/catch — port the same shape; entity-store availability is opt-in (ADR-0007 `entityBoost: boolean` flag).

### Technique 3 — Hash dedup + UUID→int + lemmatization (Q3)

> All 3 sub-topics resolved (no PARTIAL outcome per EC-8).

#### Sub-topic A — Hash dedup (MD5)

**Where:** `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:735` (Phase 4-5 of write pipeline), 1453 (`createMemory` helper), 1488 (another `createMemory` variant).

**Implementation:**
```ts
const memHash = createHash("md5").update(text).digest("hex");
```

**Key observation — text is NOT normalized before hashing.** The plan's CLAUDE.md wording "MD5 of normalized text" is slightly imprecise; code hashes the raw extracted text as-is (output of LLM extraction at Phase 2). Whitespace differences, case differences would produce different hashes. The dedup is exact-match on the post-extraction text.

**Dedup logic at memory/index.ts:716-739:**
- `existingHashes: Set<string>` — built from `existingResults.payload.hash` (these are MD5 hashes computed at previous writes; consistent because no normalization on either side).
- `seenHashes: Set<string>` — within-batch dedup (multiple extractedMemories with same text in same write).
- Skip iff `existingHashes.has(memHash) || seenHashes.has(memHash)`.

**v0.1 porting notes:**
- Use `node:crypto.createHash("md5")` — already in TS contract via `@types/node` v20.
- Be explicit in JSDoc: "exact text dedup, no normalization" — and surface in v0.1 plan as ADR if we want to ADD normalization (LOWER + STRIP).
- Hash field stored on payload at write time (`memPayload.hash = memHash` at line 749) — pgvector column `hash CHAR(32)` with BTREE index for the `existingHashes` lookup.

#### Sub-topic B — UUID→int mapping (anti-hallucination for LLM prompts)

**Where:** `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:614-624` (Phase 1 of write pipeline, after existing-memory retrieval).

**Implementation:**
```ts
const existingMemories: Array<{ id: string; text: string }> = [];
const uuidMapping: Record<string, string> = {};
for (let idx = 0; idx < existingResults.length; idx++) {
  const mem = existingResults[idx];
  uuidMapping[String(idx)] = mem.id;
  existingMemories.push({
    id: String(idx),    // <-- integer-as-string, not UUID
    text: mem.payload?.data ?? "",
  });
}
```

**Why:** the LLM sees `existingMemories: [{id: "0", text: "..."}, {id: "1", text: "..."}]` instead of UUIDs. UUIDs (`"550e8400-e29b-41d4-a716-446655440000"`) are notoriously easy for LLMs to transcribe wrong, hallucinate, or simply miss; integer IDs `"0"` through `"9"` are stable in tokenization and 100% transcribable.

**Reverse mapping:** `uuidMapping` is built but never accessed downstream in this method (verified via grep — only definitions at 616+619, no other usages). The LLM response (`AdditiveExtractionSchema.parse(...)`) returns `extractedMemories` with optional `linked_memory_ids: string[]` field, but the current code doesn't reverse-map those IDs back to UUIDs — they're either consumed inside `generateAdditiveExtractionPrompt` for prompt composition, or stored as-is on the extracted memory's metadata for downstream resolution (not happening in this read window).

**v0.1 porting notes:**
- ADOPT the integer-string mapping pattern verbatim for ANY prompt that lists existing memories to the LLM.
- The reverse-mapping responsibility is unclear in Mem0's current code (looks like dead-end). Our v0.1 plan MUST lock: if we surface `linked_memory_ids` in metadata, must we resolve back to UUIDs? Most likely YES at the storage layer; flag in v0.1 plan as an open question.
- For the additive-extraction prompt template, port `ADDITIVE_EXTRACTION_PROMPT` from `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/prompts/` (not yet read; flag for v0.1 detailed pickup).

#### Sub-topic C — Lemmatization (BM25 token preprocessing)

**Where:** `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/lemmatization.ts:246-278` (function `lemmatizeForBm25`).

**Callsites:**
- `memory/index.ts:741` (write Phase 4-5) — `textLemmatized = lemmatizeForBm25(text)` stored in payload
- `memory/index.ts:1109` (search Step 1) — `queryLemmatized = lemmatizeForBm25(query)`
- `memory/index.ts:1454` (createMemory helper) — same

**Algorithm (`lemmatization.ts:246-278`):**
1. Lowercase input
2. Tokenize via `lower.match(/[a-z0-9]+/g)` — alphanumeric sequences only
3. Drop stop words (NLTK-style list at `lemmatization.ts:14-166`, 153 entries: a, about, above, after, ... yourselves)
4. Apply Porter stemmer:
   - Primary: `require("natural").PorterStemmer.stem(word)` if available
   - Fallback: built-in `simpleStem` at lines 193-228 with Porter-like rules (ies → i; sses → ss; ness → ; ment → ; ation → e; ting → ; ing → ; ed → ; ly → ; er → ; est → ; s → ;)
5. For words ending in `-ing` where the stem differs from the original, KEEP BOTH (handles noun/verb ambiguity: "meeting" vs "meet")
6. Join with single space

**Optional `natural` dep** (`lemmatization.ts:174-187`): try-require with memoized `null` fallback. If `natural` isn't installed at runtime, the built-in `simpleStem` runs. Production-quality stemmer (natural) vs cheap fallback (simpleStem) — graceful degradation.

**v0.1 porting notes:**
- Port `lemmatizeForBm25` verbatim — pure function, no dependencies on Mem0 internals.
- Add `natural` to deps OR ship our own `simpleStem` only — Rule 9 decision for v0.1 plan: `natural` is mature (~14M weekly downloads), MIT, but adds 5MB+ of stemmers/tokenizers we don't all need. `simpleStem` handles 80% of cases. Recommend: declare `natural` as **optional peerDep** at v0.1 (same try-require pattern); ship `simpleStem` as built-in.
- The stop-word list is English-only. If we ever support multi-language memories, this becomes a localization concern — out-of-scope for v0.1.
- The `-ing` dual-token pattern is subtle but load-bearing for noun/verb-ambiguous tokens. Port the exact branch.

**v0.1 lemmatization deps shortlist** (informs Q6):
- `natural ^8.x` (Porter stemmer + tokenizer + stop words). MIT. 14M weekly downloads. ~5MB.
- Alternative: `compromise` (smaller, more rule-based). Rejected: different paradigm; Porter is the BM25 industry standard.
- Alternative: in-house `simpleStem` only. Acceptable for v0.1 if we accept ~80% stem quality.

---

## Cross-cutting Comparison

| Dimension | Mem0 | Letta | LangMem |
|---|---|---|---|
| Integration-test style | jest + content-based LLM mock + in-memory vector store; per-test collection isolation via `Date.now()`; SQL-mock router for pgvector adapter unit-tests. NO testcontainers in `oss/tests/` (separate `test:integration` exists but requires `MEM0_API_KEY`). | pytest + server-in-background-thread fixture + real SDK round-trip; `cleanup_db_connections` async fixture per test; assumes user-provisioned Postgres (no testcontainers). | (deferred D3) |
| Primary deps | `pg ^8.11` (raw SQL — NO pgvector npm pkg!) + `zod ^3.24` + `natural ^8.1` (optional, try-require) + `uuid 9.0.1` + `better-sqlite3 ^12.6` for history. | `pgvector 0.4.1` (Python pkg) + `sqlalchemy[asyncio] ^2.0.43` + `alembic ^1.16.4` + 3 driver alternatives (`asyncpg`, `psycopg2`, `pg8000`). Postgres is OPTIONAL extra. | (deferred D3) |
| Local dev story | docker-compose with `ankane/pgvector:v0.5.1`; 3 services (mem0 + postgres + dashboard); `make up`/`down`/`bootstrap`/`health` wraps `docker compose`; migration runs in service startup cmd (`alembic upgrade head && uvicorn ...`). | Same `ankane/pgvector:v0.5.1`; 3 services (letta_db + letta_server + letta_nginx); env-driven config; no Makefile. | (deferred D3) |
| Signature technique | 8-phase write pipeline (code reality vs 6-phase ADR narrative) + 9-step search w/ additive scoring `(sem + bm25 + entity)/max_possible`. | Dual-backend ORM (pgvector.Vector for Postgres + CommonVector BINARY for SQLite) via conditional column type; Alembic migrations branch per-DB inline. | (deferred D3) |

## ADRs

> Decisions that emerge from the synthesis. Populated as the loop progresses. Each MUST have alternatives + rationale + consequences.

### D1 — Adopt the 8-phase write pipeline as the runtime canonical shape; treat ADR-0001's "6-phase" label as a narrative simplification

- **Decision.** v0.1 runtime implements the 8-phase pipeline (0: context, 1: existing retrieval + UUID→int, 2: LLM extraction, 3: batch embed, 4-5: dedup + payload, 6: batch persist, 6.5: batch history, 7: entity linking, 8: save messages) verbatim from `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:562-994`. The code comments at L588/606/626/695/716/783/851/976 are the source of truth for phase boundaries.
- **Rationale.** Mem0-ts is the production-tested reference (ADR-0001 § Adopt). Faithful porting preserves the per-row fallback shape that makes the pipeline fault-tolerant. ADR-0001's "6-phase" framing folds phases 0+1 → "context+retrieval" and 4+5 → "dedup+payload" for marketing brevity; the runtime needs the granular shape.
- **Alternatives evaluated.** (a) Force the 6-phase narrative on the code — rejected; loses the granular fallback boundaries. (b) Invent a new phase decomposition — rejected; violates Inquebrável Rule 9 (Não Reinvente a Roda).
- **Consequences.** v0.1 plan needs to update or augment ADR-0001 to acknowledge the 8-phase code reality. The Memory.remember() public verb still presents a single-shot API; phases are internal.

### D2 — Adopt the additive scoring formula + sigmoid BM25 + spread-attenuated entity boost VERBATIM

- **Decision.** v0.1's `recall()` implements `combined = min((semantic + bm25 + entity_boost) / max_possible, 1.0)` per `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/scoring.ts:87-138`. `max_possible ∈ {1.0, 1.5, 2.0, 2.5}` depending on active signals. `ENTITY_BOOST_WEIGHT = 0.5` constant. BM25 normalized via sigmoid `1 / (1 + exp(-steepness * (raw - midpoint)))` with query-length-adaptive params. Entity boost spread-attenuated by `1 / (1 + 0.001 * (numLinked - 1)^2)`.
- **Rationale.** Mem0 has iterated this formula at scale; it works. The threshold-gates-semantic-BEFORE-combining behavior (scoring.ts:117-120) is a load-bearing invariant.
- **Alternatives evaluated.** (a) Multiplicative scoring per Generative Agents (`recency × importance × relevance`) — already deferred per `.claude/rules/architecture.md § 4` "Defer to v0.4". (b) Pure-semantic only — rejected; loses hybrid-retrieval competitive advantage.
- **Consequences.** v0.1 ships `additive` scoring as the only strategy; v0.4 introduces strategy interface to add multiplicative.

### D3 — Hash dedup uses MD5 of raw extracted text (no normalization at v0.1)

- **Decision.** v0.1 dedup hash = `node:crypto.createHash("md5").update(text).digest("hex")` over the raw LLM-extracted text. NO lowercase/strip pre-processing.
- **Rationale.** Matches Mem0-ts behavior at `memory/index.ts:735`. The text is already post-LLM-extraction (which has its own normalization implicit in the prompt). Adding lowercase/strip would create silent semantic drift between dedup-time and prompt-time hashes.
- **Alternatives evaluated.** (a) Lowercase + strip + collapse-whitespace before hashing — rejected for v0.1; deferred for v1.x if dedup misses surface. (b) Semantic dedup (embedding similarity) — rejected; that's the LLM's job during extraction (ADR-0001).
- **Consequences.** v0.1 documents "exact-text dedup" in JSDoc. If we later want fuzzy dedup, it becomes a v1.x ADR.

### D4 — Reject `pgvector` npm wrapper; use raw SQL through `pg ^8.11` client

- **Decision.** v0.1 ships `pg ^8.11` as the only Postgres client. Vector ops via raw SQL: `CREATE EXTENSION IF NOT EXISTS vector`, `vector vector(${dims})`, `USING hnsw (vector vector_cosine_ops)`, `vector <=> $1::vector AS distance`. NO `pgvector` npm wrapper package.
- **Rationale.** Mem0-ts at `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/vector_stores/pgvector.ts:105,144,169,271,310` proves raw-SQL approach works. The npm `pgvector` wrapper adds zero functional value over `pg.query(sql, [params])` — only a thin type layer that we can replicate inline.
- **Alternatives evaluated.** (a) `pgvector` npm — rejected; adds bundle weight without behavior. (b) `postgres` (postgres-js) — rejected; smaller pkg + faster but less mature TS types as of 2026 + Mem0 chose `pg`. (c) Drizzle ORM `pg-core` only — adopted in PARALLEL with `pg` for type-safe SQL and migrations (see D5).
- **Consequences.** v0.1 implements pgvector SQL strings inline within adapter; type safety via Drizzle (D5).

### D5 — Adopt Drizzle ORM for type-safe SQL + migrations (Letta's Alembic-pattern in TS shape)

- **Decision.** v0.1 uses `drizzle-orm ^0.30` + `drizzle-kit` for: (a) schema-as-code (memory table + entity table + history table), (b) type-safe query composition where the SQL isn't pgvector-specific, (c) `drizzle-kit push:pg` for dev migrations + `drizzle-kit generate:pg` for production SQL migrations. Bi-temporal columns (`tValid`/`tInvalid` per ADR-0006) declared in Drizzle schema.
- **Rationale.** Letta's Alembic pattern (`.claude/knowledge-base/references/letta/alembic/versions/`) proves migration-on-startup is sustainable at 167-migration scale. Drizzle is the closest TS equivalent. The dual-mode (push for dev, generate for prod) matches Mem0's run-on-startup approach with cleaner DX.
- **Alternatives evaluated.** (a) Raw SQL migrations only — rejected; loses type-safety from schema. (b) Prisma — rejected; heavyweight + Rust query engine + opinionated client. (c) Kysely — strong contender; rejected for v0.1 because Drizzle has better TS-types for pgvector via plugins.
- **Consequences.** v0.1 adds two devDeps (drizzle-orm + drizzle-kit). Schema lives at `src/local/schema.ts`; migrations generated to `src/local/migrations/`.

### D6 — In-memory `VectorStore` adapter alongside `pgvector` for unit-test isolation

- **Decision.** v0.1 ships TWO `VectorStore` implementations: `src/local/in-memory-store.ts` (Map-backed; for unit tests + dev quickstart) + `src/local/pgvector-store.ts` (Postgres-backed; for production). Both implement the same `VectorStore` DIP from v0.0 contract.
- **Rationale.** Mem0-ts pattern at `oss/tests/memory.add.test.ts:68-75` uses `provider: "memory"` for sub-second unit tests without Docker. Lets `npm test` run in CI without container infra.
- **Alternatives evaluated.** (a) Postgres-only + testcontainers — rejected; slower CI; more setup. (b) Mock VectorStore in test files only — rejected; pattern proliferates across test files; better to ship one reference impl.
- **Consequences.** Two adapters at v0.1 (was planned as one). Adds ~150 LoC of in-memory adapter. Worth it for test ergonomics.

### D7 — Two test configs (vitest.contract + vitest.integration), `tests/integration/` requires real Postgres

- **Decision.** v0.1 ships `vitest.contract.config.ts` (existing from v0.0; type-level + runtime tests in `src/`) + new `vitest.integration.config.ts` (tests in `tests/integration/` against real pgvector via `docker compose up -d pgvector`). The split mirrors Mem0's `jest.config.js` vs `jest.integration.config.js`. Integration tests are gated by env var (`THEOMEM_PG_URI`) and skipped (not failed) when env is absent — keeps `npm test` runnable everywhere.
- **Rationale.** `.claude/rules/testing.md § Pyramid` mandates unit (many, in-memory) + integration (some, real Postgres) + e2e (few). Mem0's two-config pattern is the standard. Letta's server-in-thread is overkill for a library (we have no server).
- **Alternatives evaluated.** (a) Single config with `describe.skipIf` — rejected; clutters test files. (b) E2E tests at v0.1 — rejected; deferred to v0.2 (TheoKit binding ships HTTP surface).
- **Consequences.** CI runs `npm test` (no Docker, sub-second) on every PR; `npm run test:integration` runs on PRs that touch `src/local/` (gated by labeled CI workflow OR locally before push).

## Recommendations for TheMemory

> Concrete decisions for v0.1 plan informed by this blueprint. Populated as questions resolve.

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Port `addToVectorStore` (Mem0 `index.ts:562-994`) as `src/local/pgvector-store.ts` write path, preserving the 8-phase shape + per-row fallback at every I/O boundary. Translate `pg.query` raw SQL via Drizzle wrapper. | Q1, D1, D5, `architecture.md § 4 Adopt` | HIGH |
| 2 | Port `search` (`index.ts:1037-1269`) + `scoring.ts` verbatim into `src/local/pgvector-store.ts` + `src/core/scoring.ts`. Keep the 9-step labels. Hardcode `internalLimit = max(topK * 4, 60)`. Spread-attenuated entity boost formula stays. | Q2, D2, ADR-0001 | HIGH |
| 3 | Port `lemmatizeForBm25` + `STOP_WORDS` set + `simpleStem` fallback verbatim into `src/core/lemmatization.ts`. Declare `natural ^8.x` as **optional peerDep** (try-require pattern); ship `simpleStem` as built-in fallback. | Q3, Q6, `architecture.md § 4` | HIGH |
| 4 | MD5 dedup via `node:crypto.createHash("md5")` — NO normalization (matches Mem0 behavior). Store hash in `memories.hash` column with BTREE index. | Q3, D3 | HIGH |
| 5 | UUID v4 via `node:crypto.randomUUID()` (avoid `uuid` npm dep). Build UUID→integer-string mapping at prompt-composition time per Mem0 pattern. | Q3, Q6 | HIGH |
| 6 | Ship TWO VectorStore adapters at v0.1: `src/local/in-memory-store.ts` (Map-backed, ~150 LoC, for tests + dev quickstart) + `src/local/pgvector-store.ts` (production). Both implement the v0.0 `VectorStore` DIP. | Q4, D6, ADR-0008 | HIGH |
| 7 | Drizzle schema at `src/local/schema.ts` with: `memories` table (id, text, hash, embedding vector(d), payload jsonb, scope cols, createdAt, updatedAt, tValid, tInvalid, textLemmatized), `entities` table, `history` table. Bi-temporal columns nullable per ADR-0006. | Q5, Q6, D5, ADR-0006 | HIGH |
| 8 | Alembic-style migration-on-startup: v0.1 calls `drizzle-kit push:pg` in dev; production runs generated SQL via Drizzle migrator at app boot. | Q7, D5 | MEDIUM |
| 9 | docker-compose.yaml at repo root with single `pgvector` service (image `ankane/pgvector:v0.5.1`), env-driven config, healthcheck, named volume. NO Makefile at v0.1 (npm scripts suffice). | Q7 | MEDIUM |
| 10 | Two vitest configs: `vitest.contract.config.ts` (existing) for in-memory unit + type tests; `vitest.integration.config.ts` (NEW) for `tests/integration/` against real pgvector. Gate integration on `THEOMEM_PG_URI` env. | Q4, Q7, D7, `testing.md § Pyramid` | HIGH |
| 11 | Unit-test pattern (Mem0-style): content-based LLM mock that parses prompt + echoes deterministic response; fixed mockEmbedding for `embedder.embed`; in-memory VectorStore via `provider: "memory"`. Pattern uses `vi.mock(...)` (not `jest.mock`) since v0.0 locked vitest. | Q4, D6, D7 | HIGH |
| 12 | Integration test pattern (TheMemory-specific, distilled from Mem0 + Letta): one canonical write→search loop test against real pgvector (`memory.user("alice").remember("text") + recall("query")` returns the memory in top-K). 1-3 integration tests total at v0.1. | Q5, Q7, D7 | HIGH |
| 13 | `ENTITY_BOOST_WEIGHT = 0.5` constant lives in `src/core/scoring.ts`. `entityStore.search` limit at 500 stays HARDCODED for v0.1; surface as MemoryConfig field at v1.x only if measurement shows tuning needed. | Q2, D2 | LOW |
| 14 | DEFER `better-sqlite3` history adapter to v0.4. v0.1's HistoryManager adapter is Drizzle/pg-backed (`history` table in same Postgres). | Q6 | LOW |
| 15 | DEFER `ADDITIVE_EXTRACTION_PROMPT` + `AGENT_CONTEXT_SUFFIX` text content to v0.1 plan (we know they exist in `mem0-ts/src/oss/src/prompts/` but didn't read them in this discovery — flag for v0.1 detailed pickup before /implement). | Q1, Q3 | MEDIUM — must resolve before v0.1 plan locks |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| <!-- updated by halt-loop --> | | |

## Halt-loop progress (audit trail)

- Iterations used: 8 / 30
- Questions answered: 7 / 7 (Q1-Q7 all `done`; zero blocked, zero partial)
- Questions blocked: 0
- Citations verified: 21 (all `.claude/knowledge-base/references/*` paths in blueprint pass `test -e`; FABRICATED check returns empty)
- Promise emitted at iteration: 8 (this iteration)
- Time used: ~6h equivalent (Mem0: ~4h reading memory/index.ts + scoring + lemmatization + 3 test files + package.json + pgvector.ts grep + docker-compose + Makefile; Letta: ~2h reading passage.py + custom_columns + 2 Alembic migrations + conftest + pyproject + uv.lock + compose.yaml). Within plan D1 budget.

### Per-question completion summary

| Q | Status | Source iterations | Key finding |
|---|---|---|---|
| Q1 | done | iter 1 | 8-phase code reality (vs 6-phase ADR-0001 narrative) — D5/EC-7 absorbed; per-row fallback shape consistent at every I/O boundary |
| Q2 | done | iter 2 | 9-step code MATCHES ADR-0001; sigmoid BM25 + spread-attenuated entity boost + additive `(sem+bm25+entity)/max_possible` formula |
| Q3 | done | iter 3 | Hash dedup is EXACT-MATCH (no normalization); UUID→int mapping is dead-end in current code (flag); lemmatization uses optional `natural` with `simpleStem` fallback |
| Q4 | done | iter 4 | EC-2 sampling: 10/26 filtered, 3 sampled. Jest + content-based LLM mock + in-memory vector store. NO testcontainers in `oss/tests/`. pgvector adapter via SQL mock router. |
| Q5 | done | iter 5 | EC-1 sampling: 16/167 filtered, 3 sampled. Dual-backend (pgvector.Vector for PG + CommonVector BINARY for SQLite) via conditional column type. Alembic per-DB branching inline. pytest server-in-thread integration tests. |
| Q6 | done | iter 6 | Mem0 has NO pgvector npm pkg — raw SQL via `pg`. Letta has pgvector Python pkg + 3 driver options (psycopg2/asyncpg/pg8000). v0.1 shortlist: `pg + drizzle-orm + zod + natural-optional`. |
| Q7 | done | iter 7 | CONVERGED: both refs use `ankane/pgvector:v0.5.1`. Migration runs in service startup cmd (Alembic upgrade head idempotent). v0.1 proposal: smaller compose (pgvector only — library not server), 2 vitest configs, `drizzle-kit push:pg` for dev. |

### Citations cache (avoided re-reads per EC-3)

`memory/index.ts` was Read in iter 1 (ranges 507-998) and re-cited in iters 2 (1037-1271) and 3 (614-624 from cache; 1109 from iter 2 cache; 735, 741, 1453, 1488, 1454 cited from iter 1 cache). Saved ~3 redundant Reads of the 1708-line file.

### EC absorption verification (cross-ref to plan v1.1 change log)

| EC | Plan-declared | Execute behavior | Outcome |
|---|---|---|---|
| EC-1 (167 Alembic sampling) | Q5 Fase A pre-filter | Grep filtered 16/167; sampled 3 | OK |
| EC-2 (26 test-file sampling) | Q4 Fase A pre-filter | Grep filtered 10/26; sampled 3 | OK |
| EC-3 (re-read cache) | Halt-loop checkpoint | memory/index.ts Read once, cited 3× | OK |
| EC-4 (489-line split-read) | Q1 Fase B guidance | Read in 3 chunks (507-707, 705-880, 879-998) | OK |
| EC-5 (deps dual-source) | Q6 Fase A | Read declared (package.json/pyproject) + resolved (pnpm-lock/uv.lock) | OK |
| EC-6 (soft budget warning) | Halt-loop checkpoint | Budget not exhausted; warning not triggered | OK |
| EC-7 (D5 code reality not narrative) | ADR D5 in plan | Q1 documented 8-phase code reality vs 6-phase narrative; Q2 confirmed 9-step matches | OK |
| EC-8 (PARTIAL outcome) | Halt-loop checkpoint | Q3 succeeded fully (no sub-topic blocked); PARTIAL not triggered | OK |

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-1-local-runtime-plan.md` (v1.1)
- Edge-case review: `.claude/knowledge-base/reviews/v0-1-local-runtime-edge-cases-2026-05-22.md`
- Confidence report: `.claude/knowledge-base/reviews/v0-1-local-runtime-confidence-{YYYY-MM-DD}.md` (will be generated by `/discover-confidence`)
- Linked TheMemory rules: `.claude/rules/architecture.md` § 4 (Mem0-shape Adopt/Diverge/Defer lists), `.claude/rules/testing.md` (TDD pyramid)
- Linked ADRs (from PR #4 contract): ADR-0001 (Mem0-shape), ADR-0006 (bi-temporal), ADR-0008 (DIP method counts)
