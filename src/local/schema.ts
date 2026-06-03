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
     *  (any peer ID accepted; not restricted to REDACTED's bivalent "user"/"assistant" vocabulary).
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('memories_hash_unique_idx').on(table.hash),
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
