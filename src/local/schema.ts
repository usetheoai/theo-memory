/**
 * Drizzle schema for v0.1 local runtime — T2.1 of v0-1-local-runtime plan v1.3.
 *
 * Three tables:
 *  - memories: primary store (vector + payload + bi-temporal + scope columns)
 *  - entities: optional entity-boost store (gated by MemoryConfig.entityBoost per ADR-0007)
 *  - history:  audit trail (Memory.history(id) reads this)
 *
 * Schema decisions:
 *  - Embedding column: vector(MAX_EMBEDDING_DIM=1536) per ADR D1.7 (HNSW limit of pgvector 0.5.1)
 *  - HNSW index on embedding with vector_cosine_ops
 *  - Unique BTREE index on hash (MD5 collision rare enough for v0.1 to UNIQUE)
 *  - Scope columns (user_id/session_id/agent_id) nullable; AND-composed by Filters at query time
 *  - Bi-temporal columns (t_valid/t_invalid) nullable per ADR-0006 (schema clause).
 *    Local runtime honors `asOf` recall queries from v1.1 per ADR-0011 (supersedes
 *    the ADR-0006 runtime clause); pre-v1.1 callers got `BiTemporalNotSupportedLocally`.
 *  - payload: jsonb storing Record<string, string | number | boolean | null>
 *  - text_lemmatized: jsonb storing string[] (pre-computed BM25 tokens, blueprint Recommendation 3)
 *
 * **F-M3 review finding — parametric-dim drift constraint (LOCKED, document-only mitigation):**
 *
 *   When `runMigrations(pool, { embeddingDim: N })` is called with N != 1536,
 *   the live DB ends up with `vector(N)` columns, but this schema.ts file
 *   still declares `vector(1536)` literally (Drizzle's `pgTable` cannot
 *   read `MAX_EMBEDDING_DIM` from runtime constants — the parameter is
 *   resolved at build time when drizzle-kit generates migrations).
 *
 *   Consequence: **NEVER run `drizzle-kit push` against a database whose
 *   live embedding dim diverges from this file.** drizzle-kit introspects
 *   the live DB and computes a destructive ALTER back to 1536, silently
 *   reverting the parametric change (and dropping all 384-dim rows in the
 *   process). The orphan-schema mitigation in architecture.md § 10.2 does
 *   NOT cover this case — it only short-circuits when the journal is
 *   missing, not when columns disagree.
 *
 *   The contract: production deploys go through `runMigrations()` on a
 *   fresh DB (which honors `embeddingDim` symmetrically). Dev/CI envs
 *   that use `db:push` MUST stay at 1536. The applyDimChange console.error
 *   in src/local/index.ts surfaces this constraint at runtime when the
 *   operator triggers the parametric path.
 *
 *   See: .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-review-2026-06-02.md § F-M3 + F-Mi5
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T2.1 + ADR D1.7
 * @see .claude/knowledge-base/references/REDACTED/REDACTED/orm/passage.py:1-105
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

import { MAX_EMBEDDING_DIM } from '../core/constants.js';

/** Primary memory store — every remember/recall/forget operation touches this. */
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    text: text('text').notNull(),
    hash: text('hash').notNull(),
    embedding: vector('embedding', { dimensions: MAX_EMBEDDING_DIM }).notNull(),
    payload: jsonb('payload').$type<Record<string, string | number | boolean | null>>().notNull(),
    userId: text('user_id'),
    sessionId: text('session_id'),
    agentId: text('agent_id'),
    tValid: timestamp('t_valid', { withTimezone: true }).defaultNow(),
    tInvalid: timestamp('t_invalid', { withTimezone: true }),
    /** v1.1 T1.1: first-class promoted column for multi-peer attribution per blueprint Q3 + R1.
     *  Nullable text; LLM extraction populates it (extracted[i].attributed_to) OR verbatim callers
     *  pass RememberOptions.attributedTo (EC-2 absorption). N-valent semantic per blueprint Q5
     *  (any peer ID accepted; not restricted to the upstream bivalent "user"/"assistant" vocabulary).
     *  @see .claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § T1.1 + ADR D2. */
    attributedTo: text('attributed_to'),
    textLemmatized: jsonb('text_lemmatized').$type<string[]>(),
    /** v0.4a: discriminator for extracted (v0.1 default) vs derived (reflection output) per ADR D6;
     *  v0.6: also accepts 'skill' (code-as-skill) per plan ADR D3. */
    kind: varchar('kind', { length: 20 }).notNull().default('extracted'),
    /** v0.4a: provenance for kind='derived' memories — array of source memory UUIDs per ADR D6;
     *  v0.6: also populated by `consolidate()` on derived skill rows (kind='skill'). */
    derivedFrom: jsonb('derived_from').$type<string[]>(),
    /** v0.4a: LLM-judged importance cached at write per ADR D8 (REUSED by v0.4b forgetting). */
    llmImportanceScore: real('llm_importance_score'),
    /** v0.6: supersession chain — newer skill points back to ancestor.
     *  Self-FK with ON DELETE SET NULL preserves audit trail when an ancestor is hard-deleted. */
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => memories.id, {
      onDelete: 'set null',
    }),
    /** v0.6: code-as-skill payload — executable TypeScript/JavaScript snippet. NULL for non-skills. */
    code: text('code'),
    /** v0.6: Natural-language description of the skill — embedding target for kind='skill' rows. */
    description: text('description'),
    /** v0.6: Language tag of the `code` payload (typescript | javascript). NULL for non-skills. */
    codeLanguage: varchar('code_language', { length: 20 }),
    /** v0.4b: timestamp of last recall() touching this row — drives exponential half-life decay
     *  and LRU/LFU bookkeeping per plan T2.1 + T3.1. NULL means never recalled since insert.
     *  @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T0.1 (ADR D13). */
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    /** v0.4b: monotonic counter incremented by recall() write-back hook per plan T3.1.
     *  Used by the access-frequency dimension of triadic scoring per plan T2.1. */
    accessCount: integer('access_count').notNull().default(0),
    /** v0.4b: per-row half-life in seconds for exponential time decay; lazy-backfilled from
     *  llm_importance_score on first scoring per plan T2.2 (D14). NULL until first backfill. */
    halfLifeSeconds: integer('half_life_seconds'),
    /** principles-alignment-hardening T0.1: Princípio 1 (confirmação) factor —
     *  bumped on dedup-collision via ON CONFLICT DO UPDATE per ADR D1. Tracks
     *  how many times the SAME hash was asserted within the SAME scope. DEFAULT 1
     *  treats pre-cycle rows as "1 confirmation" (EC-4 honest floor — pre-cycle
     *  schema did not track confirmations; 1 is NOT fabricated history).
     *  @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § ADR D1
     *  @see CLAUDE.md § IMPORTANTE Princípio 1 */
    confirmationCount: integer('confirmation_count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // principles-alignment-hardening T0.1 / ADR D5 — composite UNIQUE on
    // (hash, scope_columns) replaces v0.1 global UNIQUE on hash alone.
    // COALESCE() treats NULL scope columns as empty string for uniqueness:
    // (hash, NULL, NULL, NULL) deduplicates with (hash, NULL, NULL, NULL) but
    // (hash, 'alice', NULL, NULL) is independent from (hash, 'bob', NULL, NULL).
    // The v0.1 global UNIQUE was a pre-existing cross-scope dedup defect — see
    // EC-1 absorption in the principles-alignment-hardening edge-case review.
    // @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § ADR D5
    uniqueIndex('memories_hash_scope_unique_idx').on(
      table.hash,
      sql`COALESCE(${table.userId}, '')`,
      sql`COALESCE(${table.sessionId}, '')`,
      sql`COALESCE(${table.agentId}, '')`,
    ),
    index('memories_user_id_idx').on(table.userId),
    index('memories_session_id_idx').on(table.sessionId),
    index('memories_agent_id_idx').on(table.agentId),
    index('memories_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    // v0.4b: partial index on active (non-invalidated) rows keyed on the
    // scope-tier column. Supports CapacityBasedTrigger COUNT(*) + loadCandidates
    // SELECT queries per plan T5.1 + T6.1. `WHERE t_invalid IS NULL` keeps the
    // index small (soft-deleted rows excluded per ADR D17).
    //
    // v0.4b-fixes T9.1 (F-dom-pg-1): `last_accessed_at` was originally listed
    // as the second key column for LRU-style ORDER BY support — but no
    // eviction query actually uses ORDER BY on this column (TriadicScoringPolicy
    // computes the eviction order in-app, NOT via SQL). The column was dead
    // index weight. Migration 0006 drops + recreates these 3 indexes keyed
    // only on the scope-tier column.
    //
    // @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T0.1 (ADR D13)
    // @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T9.1 (F-dom-pg-1)
    index('idx_memories_eviction_score')
      .on(table.agentId)
      .where(sql`${table.tInvalid} IS NULL`),
    index('idx_memories_eviction_score_user')
      .on(table.userId)
      .where(sql`${table.tInvalid} IS NULL`),
    index('idx_memories_eviction_score_session')
      .on(table.sessionId)
      .where(sql`${table.tInvalid} IS NULL`),
    // v1.1 (T1.1): partial composite index on (user_id, attributed_to) for
    // peer-attributed recall. WHERE clause keeps the index narrow — most rows
    // (pre-v1.1 + non-attributed v1.1) have NULL attributed_to and skip indexing.
    // Declared here to close the `drizzle-kit push` parity gap surfaced by
    // /review F-dom-dbmig-1 — migration 0008_attributed_to.sql already creates
    // the index via runMigrations(); this declaration makes push-flow developers
    // land the same index per architecture.md § 10.2.
    index('idx_memories_user_attributed_to')
      .on(table.userId, table.attributedTo)
      .where(sql`${table.attributedTo} IS NOT NULL`),
    check(
      // EC-1 absorption (plan v1.1): name verbatim, cited by
      // migration 0002_skill_columns.sql DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT pair.
      'memories_kind_derived_from_check',
      sql`(${table.kind} = 'extracted' AND ${table.derivedFrom} IS NULL)
       OR (${table.kind} = 'derived' AND jsonb_array_length(${table.derivedFrom}) >= 1)
       OR (${table.kind} = 'skill' AND (${table.derivedFrom} IS NULL OR jsonb_array_length(${table.derivedFrom}) >= 1))`,
    ),
  ],
);

/**
 * v0.4a: per-scope reflection trigger counter — bumped on each remember() per ADR D4.
 *
 * ThresholdReflectionPolicy reads `count % threshold == 0` to decide whether to enqueue
 * a reflection. Counter is decoupled from `memories` because (a) it's a hot-write row
 * (every remember() bumps it) while memories is append-only, and (b) it isolates
 * threshold state from the bi-temporal memory store.
 *
 * EC-2 absorption: `count BIGINT` (not INTEGER) to avoid 2.1B overflow.
 * EC-3 absorption: CHECK forbids all-NULL scope rows (Postgres NULL≠NULL in UNIQUE
 * would otherwise allow unbounded all-NULL counter rows, defeating modular arithmetic).
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § ADR D4
 */
export const reflectionCounters = pgTable(
  'reflection_counters',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    scopeUserId: text('scope_user_id'),
    scopeSessionId: text('scope_session_id'),
    scopeAgentId: text('scope_agent_id'),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reflection_counters_scope_unique_idx').on(
      table.scopeUserId,
      table.scopeSessionId,
      table.scopeAgentId,
    ),
    check(
      'reflection_counters_scope_not_all_null_check',
      sql`NOT (${table.scopeUserId} IS NULL AND ${table.scopeSessionId} IS NULL AND ${table.scopeAgentId} IS NULL)`,
    ),
  ],
);

/** Optional entity store — instantiated only when MemoryConfig.entityBoost !== false (ADR-0007). */
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    embedding: vector('embedding', { dimensions: MAX_EMBEDDING_DIM }).notNull(),
    payload: jsonb('payload').$type<Record<string, string | number | boolean | null>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('entities_name_idx').on(table.name),
    index('entities_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

/** Audit-trail rows for Memory.history(id). Append-only; ordered by (timestamp DESC, id DESC) per EC-18. */
export const history = pgTable(
  'history',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    memoryId: uuid('memory_id').notNull().references(() => memories.id, { onDelete: 'cascade' }),
    event: text('event').notNull(), // 'ADD' | 'FORGET' | 'REFLECT_MERGE' | 'REFLECT_SPLIT'
    prevText: text('prev_text'),
    newText: text('new_text'),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    messages: jsonb('messages').$type<{ role: string; content: string }[] | null>(),
  },
  (table) => [
    index('history_memory_id_idx').on(table.memoryId),
    index('history_timestamp_idx').on(sql`${table.timestamp} DESC, ${table.id} DESC`),
  ],
);

/**
 * v0.7 distillation pipeline audit trail — every conflict-resolution decision
 * lands here as one row. `kept_memory_id` uses ON DELETE SET NULL so a GDPR
 * `Memory.forget(id, { hard: true })` survives at the audit layer (the row
 * stays, the FK pointer goes NULL). Closes /review F-C3: previously declared
 * only in migration `0007_distillation_columns.sql` + `meta/0007_snapshot.json`
 * but NOT here; `drizzle-kit push` would have computed a destructive diff
 * (DROP TABLE) and silently lost all GDPR-survival audit rows.
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T0.1 + ADR D3
 * @see src/local/migrations/0007_distillation_columns.sql
 * @see .claude/knowledge-base/reviews/v0-7-distillation-pipeline-review-2026-06-02.md § F-C3
 */
export const consolidationHistory = pgTable(
  'consolidation_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    keptMemoryId: uuid('kept_memory_id').references(() => memories.id, { onDelete: 'set null' }),
    rejectedMemoryIds: jsonb('rejected_memory_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    reason: text('reason').notNull(),
    policyName: text('policy_name').notNull(),
    originalEpisodeIds: jsonb('original_episode_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_consolidation_history_kept').on(table.keptMemoryId),
    index('idx_consolidation_history_created').on(sql`${table.createdAt} DESC`),
  ],
);

/**
 * v1.5 semantic recall cache — backs the 13th DIP `RecallCacheStore` per
 * `semantic-recall-cache-v1-5-plan.md § T0.2`.
 *
 * Key composition `(scope_key, query_embedding)` per blueprint D4: scope_key
 * isolates per-tier results; HNSW partial index on `query_embedding` with
 * `vector_cosine_ops` powers the cosine-similarity lookup at `get()`.
 *
 * Independent of the memories table — cache rows do NOT FK back. Write-triggered
 * invalidation via `invalidateScope()` is the correctness gate.
 *
 * Parametric dim discipline: the column declares `vector(MAX_EMBEDDING_DIM)`
 * (1536). When `runMigrations({ embeddingDim: N })` rewrites memories.embedding,
 * `applyDimChange()` must ALSO rewrite this column to keep the cache aligned with
 * the embedder. T2.1 (cache wrap) is the canonical mismatch-detection gate via
 * `atttypmod` probe (EC-2 absorption).
 *
 * @see .claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md § T0.2
 * @see .claude/knowledge-base/discoveries/blueprints/semantic-recall-cache-blueprint.md § 3 + D4
 * @see src/core/dip/recall-cache-store.ts (13th DIP contract)
 */
export const recallCache = pgTable(
  'recall_cache',
  {
    id: serial('id').primaryKey(),
    scopeKey: text('scope_key').notNull(),
    queryEmbedding: vector('query_embedding', { dimensions: MAX_EMBEDDING_DIM }).notNull(),
    resultSet: jsonb('result_set').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    thresholdUsed: real('threshold_used').notNull().default(0.8),
  },
  (table) => [
    // HNSW partial index per blueprint § 3. Conservative pgvector defaults
    // (m=16, ef_construction=64) per ADR D7 v1.1 amendment + EC-15 DOCUMENT:
    // tuning DEFERRED to v1.5.x dogfood-evidence-driven adjustment per Inquebrável Rule 11 (YAGNI).
    index('recall_cache_scope_hnsw_idx').using('hnsw', table.queryEmbedding.op('vector_cosine_ops')),
    // B-tree on scope_key powers invalidateScope() DELETE perf.
    index('recall_cache_scope_key_idx').on(table.scopeKey),
    // Partial B-tree on expires_at powers clearExpired() sweep.
    index('recall_cache_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL`),
  ],
);
