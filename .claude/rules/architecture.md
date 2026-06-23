---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# Architecture Rules — @usetheo/memory

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

These rules govern source code under `src/`. Read them before writing any `.ts`/`.tsx`. They make the architectural decisions in `CLAUDE.md § Architectural Decisions Locked` enforceable in code.

## 1. Three-tier scope (User / Session / Agent)

Locked. Map directly onto Mem0's filter shape internally — rename only the surface vocabulary.

| Tier | Internal filter key | Public sub-object | Lifetime |
|---|---|---|---|
| User | `user_id` | `memory.user(id)` | Long-lived (account scope) |
| Session | `session_id` | `memory.session(id)` | Mid-lived (conversation / run) |
| Agent | `agent_id` | `memory.agent(id)` | Cross-user (skill / persona scope) |

- The internal `filters` object is identical in shape to Mem0's `{ user_id, agent_id, run_id }` — we rename only `run_id → session_id`.
- The public API uses the scoped sub-object form for TypeScript narrowing. Both shapes converge to the same `filters` before reaching the store.
- Never introduce a fourth tier without a strategic review. `RepoScope` is the 4th tier added by v0.6 — see [ADR-0010](../knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md); it is exposed ONLY through `Memory.skills(repoId)` and maps internally to `filters.agent_id` per EC-4.

## 2. ADD-only by design

Locked decision (CLAUDE.md § Architectural Decisions Locked #4). No `update()` on the public API.

- Users mutate facts via `forget(id) + remember(newText)` — the LLM extraction pipeline absorbs any semantic merge inside the next write.
- `history(memoryId)` exists for audit trails (cheap, no new code path).
- The two-stage write pipeline is ADD-only: an LLM call produces zero-or-more facts; nothing rewrites existing facts in place.

## 3. Dependency direction (DIP)

Strictly enforced by `.claude/hooks/boundary-check.sh`.

```
src/core/        ← contracts, types, pure logic, LLM extraction pipeline (no I/O)
   ↑
   ├── src/local/    ← Postgres + pgvector adapter (implements core contracts)
   ├── src/cloud/    ← TheoCloud managed adapter (implements core contracts)
   └── src/theokit/  ← TheoKit binding (depends ONLY on core/, runtime selection happens at app composition)
```

- `src/core/` MUST NOT import from `src/local/` or `src/cloud/`. Ever.
- `src/local/` and `src/cloud/` MUST NOT import from each other. They are siblings; share via `src/core/`.
- `src/theokit/` MUST NOT import from `src/local/` or `src/cloud/`. The binding is runtime-agnostic.
- `packages/cli/` (formerly `src/agent-tools/`, extracted T3.4) is the CLI **composition root** (`themory` entrypoint): it depends on `packages/core/`, `packages/api/` (REST server boot via `themory server`), and `packages/mcp/` (`themory mcp`). NOTE: a `packages/cli ↔ packages/mcp` import cycle exists today — `mcp` imports shared helpers via the `@usetheo/memory/agent-tools` subpath, which resolves into `packages/cli`. Breaking that cycle (extract shared helpers to a leaf package) is tracked as reorg follow-up debt (see `complete-workspace-publish-topology`), not by the extract-cli slice.

## 4. Mem0-shape architecture, not Mem0-clone

Adopt — these patterns are locked for v0.1:

- Eight-phase write pipeline (per v0.1 runtime; ADR-0001 narrates it as six. Phase 0 context, Phase 1 retrieval + UUID→int, Phase 2 LLM extraction, Phase 3 batch embed, Phase 4-5 hash dedup + payload, Phase 6 batch persist, Phase 6.5 history persist, Phase 7+8 entity linking + save messages scaffolded for v0.2 — see ADR-0001 § Implementation note).
- Nine-step search (Preprocess → Embed → Semantic over-fetch → BM25 → Sigmoid normalization → Entity boost → Combined score → Threshold → Format).
- **Additive scoring**: `combined = (semantic + bm25 + entity_boost) / max_possible`, with semantic threshold gating BEFORE combining.
- Hash dedup via MD5 of normalized text (exact match only).
- UUID → integer mapping for LLM prompts (anti-hallucination).
- `textLemmatized` precomputed at write time.
- Auto-detected embedding dimension via probe call.
- `infer: false` escape hatch for caller-supplied facts.
- Robust I/O fallbacks at every boundary.

Diverge — these are explicit divergences from Mem0:

- Public verbs are `remember` / `recall` / `forget` / `reflect` (not `add` / `search` / `delete`).
- ADD-only — no public `update()` method (Mem0 has one; we hold the line).
- Three-tier scope vocabulary (User / Session / Agent) instead of Mem0's `user_id` / `agent_id` / `run_id` field names (internal filter shape is the same).

Defer to v0.4 — these were in README v1 but moved out:

- **Generative Agents multiplicative scoring** (`recency × importance × relevance`) — moves to v0.4 behind a strategy interface. v0.1 ships additive Mem0-style. Do not reintroduce in v0.1 source.
- LLM-importance-aware forgetting — also v0.4.

## 5. Two runtimes, one contract

Both runtimes implement the same `MemoryStore` interface from `src/core/`. Caller swaps via app-composition (a la dependency injection).

- `src/local/` — Postgres + pgvector. Dev/CI default. Local mode stays OSS-functional forever (root override exception, but local stays open).
- `src/cloud/` — TheoCloud managed (pre-release until Theo PaaS GA). Depth coupling with TheoKit + TheoCloud is intentional (CLAUDE.md § Cross-Project Rule 6 exception).

## 6. Naming conventions

Per global CLAUDE.md § PARTE I-5 and ecosystem conventions:

- Files: `kebab-case.ts` (e.g., `memory-store.ts`, `extraction-pipeline.ts`).
- Classes / types: `PascalCase` (e.g., `MemoryStore`, `UserMemory`, `ExtractionResult`).
- Functions / variables: `camelCase` (e.g., `rememberFact`, `recallSemantic`).
- Constants: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_TOP_K`, `MAX_EMBED_DIM`).
- Module barrels: `index.ts` only when there's a public surface to expose; avoid deep re-export chains.
- Reserved word collisions: never use `type`, `from`, `delete`, `id` as parameter names — prefer `kind`, `source`, `remove`, `memoryId`.

## 7. Module hygiene

- ES modules only (`import` / `export`). No CommonJS in source.
- Destructured imports always: `import { foo, bar } from 'baz'`. Avoid `import * as ns`.
- `node:` prefix for built-ins: `import { readFile } from 'node:fs/promises'`.
- TypeScript strict mode. No `any`. If you must escape the type system, use `unknown` with a runtime assertion.
- No `console.log` in production code paths. Use a structured logger interface defined in `src/core/`.

## 8. Error handling (PARTE I-8 of global CLAUDE.md)

- Validate at boundaries (HTTP handler, TheoKit binding entry, CLI). Inside `src/core/`, trust the contract.
- Domain errors are typed classes: `MemoryNotFound`, `InvalidScope`, `EmbeddingMismatch`, etc. — exported from `src/core/errors.ts`.
- Never `catch (e)` and swallow. If you can't handle it, let it bubble.
- LLM/provider errors get a specific error type with `cause` set; never lose the original stack.
- Retry only for transient errors (network timeout, 5xx). Exponential backoff with jitter. Never retry validation errors or 4xx.

## 9. Public API surface

The `index.ts` at `src/` is the **only** thing TypeScript consumers import directly. Subpath exports (`@usetheo/memory/cloud`, `@usetheo/memory/theokit`, `@usetheo/memory/agent-tools`) are explicit per the locked names table.

- Adding a new public export requires updating: `src/index.ts`, `package.json#exports`, the README's "Planned API contract" section, and a unit test that imports through the public path.
- Internal helpers stay un-exported. Test them through the public API.

## 10. Build pipeline — known gaps

### 10.1 Non-`.ts` assets are not copied by `tsc`

`tsc` only emits `.js` / `.d.ts` from `.ts` sources. Anything else co-located under `src/` (Drizzle SQL migrations, JSON fixtures, schema YAMLs) is silently skipped.

Discovered at v0.3 T7.1 — `dist/local/migrations/` was missing after `npm run build`, causing `runMigrations()` to fail at E2E time with `Cannot find module migrations/0000_*.sql`. F-T7.1-3.

**Rule:** when adding any non-`.ts` asset under `src/`, also add a `postbuild:*` npm script that copies it to `dist/`. The contract:

- Asset SHALL be discoverable at runtime via `dirname(fileURLToPath(import.meta.url))` after `tsc` build (production) AND after the test runner's transient compile (test).
- The `postbuild:*` step SHALL be wired into `"build"` (chained with `&&`), not optional — `npm publish --dry-run` must include the artifact.
- Add a publish-readiness integration test that asserts the asset is present under `dist/` post-build.

Current consumer: `src/local/migrations/**` copied via `postbuild:copy-migrations` (see `package.json`).

### 10.2 `drizzle-kit push` vs `runMigrations()` conflict

`drizzle-kit push` introspects the live DB and synchronizes the schema WITHOUT writing to the `drizzle.__drizzle_migrations` journal. If a consumer pushes a schema for dev AND later calls `runMigrations(pool)` against the same DB, `migrate()` throws `relation "memories" already exists`.

**Mitigation (shipped 2026-05-25):** `runMigrations()` detects the orphan-schema state (tables present + journal absent) and skips `migrate()` with a `console.warn` rather than crashing. The warning surfaces the config smell to ops.

**Rule:**
- Production deployments use `runMigrations()` against a fresh DB. Never mix the two.
- Dev/CI may use `npm run db:push` for fast iteration. The `runMigrations()` warning is the early-detection signal when the two paths collide.

F-T7.1-2.

### 10.3 Trigger-bearing migrations require a psql side-channel in `db:push`

Drizzle ORM v0.45 does not model triggers or functions in `pgTable` declarations. Migrations that include `CREATE TRIGGER` or `CREATE FUNCTION` (e.g., `0004_eviction_half_life_trigger.sql`) are invisible to `drizzle-kit push` — its schema introspection sees only columns + indexes. Without intervention, the dev DB ends up with the columns but no trigger, while `runMigrations()` (which reads the journal directly) applies everything correctly in prod. The two paths silently diverge.

**Mitigation (shipped 2026-05-31 / v0.4b-fixes T2.1, closes F-dom-db-2):** `npm run db:push` chains `node scripts/apply-trigger-migrations.mjs` as its final step. The helper scans `src/local/migrations/*.sql` for files matching `/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|FUNCTION)\b/i` and applies each via `psql -v ON_ERROR_STOP=1 -f <file>` against `$THEOMEM_PG_URI`. Idempotency relies on each trigger migration using `CREATE OR REPLACE` semantics (PG 14+); re-running `db:push` is a no-op at the SQL layer.

**Rule:**
- Any new migration that contains `CREATE TRIGGER`, `CREATE FUNCTION`, or other DDL outside Drizzle's schema model MUST use `CREATE OR REPLACE` so the helper stays idempotent.
- Regex-based detection in the helper is sufficient while migrations are hand-authored (< 20 files); revisit if migration count grows or comments start carrying false-positive `CREATE TRIGGER` strings.
- `psql` (PostgreSQL 14+ client tools) is now a dev prerequisite — surfaced in `README.md § Quickstart › Prerequisites` and enforced by the helper's anchored error message when `psql` is absent from `PATH`.

F-dom-db-2.

### 10.4 Large-table index builds run `CREATE INDEX CONCURRENTLY` out-of-band

drizzle-orm 0.45.2 `migrate()` runs ALL pending migrations inside ONE transaction (verified in `drizzle-orm/pg-core/dialect.cjs` `PgDialect.migrate` — `await session.transaction(...)`). Postgres FORBIDS `CREATE INDEX CONCURRENTLY` inside a transaction block, and this Drizzle version has no per-migration no-transaction marker. So a `CREATE INDEX CONCURRENTLY` in a journal-applied migration `.sql` would crash `runMigrations()` at deploy with SQLSTATE `25001`.

A plain `CREATE INDEX` (what every index migration uses today — `0005`, `0008`, `0009`, `0021`) takes a `SHARE` lock that blocks writes for the build duration. On a small/fresh table this is trivial; on a large, write-hot production `memories` table it is a deploy-time write stall.

**Runbook — large-table index (ADR-0018):**

1. **Author the migration as a plain `CREATE INDEX IF NOT EXISTS`** in `packages/core/src/infrastructure/db/migrations/` (via `npm run db:generate`). This is correct + sufficient for fresh/dev DBs, where the blocking build is negligible.
2. **Before deploying against a large EXISTING production DB**, build the index OUT-OF-BAND on a direct autocommit connection (NOT inside `runMigrations()`):
   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "<index_name>" ON "memories" (...) WHERE ...;
   ```
   Run it via `psql`/an ops script against prod (same out-of-band spirit as § 10.3's trigger side-channel).
3. **Deploy.** `runMigrations()` reaches the migration's `CREATE INDEX IF NOT EXISTS` and finds the index already present → metadata no-op; the Drizzle journal marks the migration applied. No write lock, no crash.

**Recovery:** a failed `CREATE INDEX CONCURRENTLY` leaves an `indisvalid=false` index that still consumes writes — `DROP INDEX CONCURRENTLY IF EXISTS "<index_name>"` then retry. Never leave an INVALID index in place.

**Rule:**
- A journal-applied migration `.sql` MUST NOT contain `CREATE INDEX CONCURRENTLY` — it crashes the single-transaction `migrate()`. Enforced by `tests/integration/migration-no-concurrently.test.ts` (a path-drift-guarded, comment-tolerant file scan).
- The `IF NOT EXISTS` on index migrations is load-bearing: it is what lets the out-of-band CONCURRENTLY build and the migration no-op coexist.
- Full automation (a CI lint keyed on table size, or a no-tx-capable runner) is deferred until GA scale justifies it (ADR-0018 § Consequences). Do NOT special-case a single migration to CONCURRENTLY — it cannot live in the file anyway.

ADR-0018.

## Reference

- `CLAUDE.md § Architectural Decisions Locked` — the source of truth.
