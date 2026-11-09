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
 *
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';

/**
 * multi-tenant-workspace-isolation T0.2 — the tenant boundary (ADR D1).
 *
 * Every datum belongs to exactly one workspace; a credential (`theo_api_keys`)
 * resolves to exactly one workspace via its `workspace_id` FK. The seeded
 * `'default'` workspace is the collapse target for legacy / no-credential
 * deployments (ADR D7) and the backfill value for pre-0016 rows (ADR D5). Its
 * id is a STABLE literal (`'default'`, not a random UUID) so the env-key bridge
 * resolves it without a lookup race and the seed is idempotent (EC-6 / EC-7).
 *
 */
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * multi-tenant-rbac-and-slice1-completion T0.2 — global user identity (ADR D2).
 *
 * A `users` row is identity that spans workspaces; membership + role live in
 * {@link workspaceUsers}. `email` is the global unique handle (add-by-email).
 * The seeded `'default-owner'` row is the actor every legacy / no-credential
 * request acts as (owner of the `'default'` workspace) so single-tenant
 * deployments keep working after RBAC lands.
 *
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * multi-tenant-rbac-and-slice1-completion T0.2 — membership + role (ADR D1/D3).
 *
 * The M:N join between {@link users} and {@link workspaces}: a user has exactly
 * ONE role per workspace (composite PK `(workspace_id, user_id)`). `role` is
 * constrained to the `owner | admin | member` enum at the DB layer (CHECK) so a
 * bad role never persists. Role resolution LEFT JOINs this table from
 * `theo_api_keys` on `(workspace_id, user_id)`; a key with no membership row
 * resolves to the least-privileged `member` (default-deny).
 *
 */
export const workspaceUsers = pgTable(
  'workspace_users',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    check('workspace_users_role_check', sql`${table.role} IN ('owner', 'admin', 'member')`),
  ],
);

/**
 * M11 — per-`(workspace, user)` routing policy. Keyed by the M8 isolation pair so a policy is that
 * tenant's own row (never cross-tenant). Absent row → the fail-closed default resolved in code
 * (`FAILCLOSED_DEFAULT_POLICY`), so a missing config never disables isolation.
 */
export const routingPolicies = pgTable(
  'routing_policies',
  {
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    defaultScope: text('default_scope').notNull().default('session'),
    llmRouting: boolean('llm_routing').notNull().default(false),
    confirmationThreshold: integer('confirmation_threshold').notNull().default(3),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    check('routing_policies_scope_check', sql`${table.defaultScope} IN ('session', 'global')`),
  ],
);

/**
 * M11 — placement-decision audit (Princípio 3). One row per routing/promotion decision, scoped by the
 * M8 `(workspace_id, user_id)` pair. Reuses the recall-trace governance SHAPE (ADR D2), not a new engine.
 */
export const routingAudit = pgTable(
  'routing_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    chosenScope: text('chosen_scope').notNull(),
    attribution: text('attribution').notNull(),
    decidedBy: text('decided_by').notNull(),
    why: text('why').notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('routing_audit_ws_user_at_idx').on(table.workspaceId, table.userId, table.at),
    check('routing_audit_scope_check', sql`${table.chosenScope} IN ('session', 'global')`),
    check('routing_audit_attribution_check', sql`${table.attribution} IN ('user', 'agent')`),
  ],
);

/** Primary memory store — every remember/recall/forget operation touches this. */
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    text: text('text').notNull(),
    hash: text('hash').notNull(),
    embedding: vector('embedding', { dimensions: MAX_EMBEDDING_DIM }).notNull(),
    payload: jsonb('payload').$type<Record<string, string | number | boolean | null>>().notNull(),
    /** multi-tenant-workspace-isolation T0.2: OUTER tenant anchor (ADR D1). Denormalized
     *  on every directly-queried table (D-LEAF / EC-1). Resolved from the credential's
     *  Principal, never the request body (ADR D3). Backfilled to 'default' for pre-0016
     *  rows by the non-destructive migration (ADR D5). */
    workspaceId: text('workspace_id').notNull().default('default'),
    userId: text('user_id'),
    sessionId: text('session_id'),
    agentId: text('agent_id'),
    tValid: timestamp('t_valid', { withTimezone: true }).defaultNow(),
    tInvalid: timestamp('t_invalid', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    distinctSourceCount: integer('distinct_source_count'),
    /** v1.1 T1.1: first-class promoted column for multi-peer attribution per blueprint Q3 + R1.
     *  Nullable text; LLM extraction populates it (extracted[i].attributed_to) OR verbatim callers
     *  pass RememberOptions.attributedTo (EC-2 absorption). N-valent semantic per blueprint Q5
     *  (any peer ID accepted; not restricted to the upstream bivalent "user"/"assistant" vocabulary). */
    attributedTo: text('attributed_to'),
    /** themory-category-filter-server-side T2.1: operator-supplied category tag promoted to top-level
     *  column per ADR D2 (mirrors v1.1 attributed_to precedent). NULL on pre-2026-06-09 rows and on
     *  remember() calls without RememberOptions.category. ADR D1 honest no-backfill; ADR D6 immutable
     *  via UPSERT (first-write wins; mutation = forget + remember). */
    category: text('category'),
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
     *  and LRU/LFU bookkeeping per plan T2.1 + T3.1. NULL means never recalled since insert. */
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
    // multi-tenant-workspace-isolation T1.1 / EC-12: workspace_id leads the dedup
    // key so the same fact under the same user in two workspaces is two rows, not
    // a cross-workspace confirmation_count bump. workspace_id is NOT NULL (no COALESCE).
    uniqueIndex('memories_hash_scope_unique_idx').on(
      table.workspaceId,
      table.hash,
      sql`COALESCE(${table.userId}, '')`,
      sql`COALESCE(${table.sessionId}, '')`,
      sql`COALESCE(${table.agentId}, '')`,
    ).where(sql`${table.tInvalid} IS NULL`),
    index('memories_user_id_idx').on(table.userId),
    index('memories_session_id_idx').on(table.sessionId),
    index('memories_agent_id_idx').on(table.agentId),
    /** themory-category-filter-server-side T2.1 / ADR D2 — btree on category enables O(log n)
     *  server-side filter via `GET /v1/scopes/.../memories?category=X`. Aligns with v1.1
     *  attributed_to precedent index shape (memories_*_idx naming). */
    index('memories_category_idx').on(table.category),
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
    // skills-subject-prefix-index M2 / SEC-1 — partial composite supporting the
    // cross-repo skills listing's `agent_id LIKE '{subject}:%'` prefix scan
    // (PgvectorStore.listSkillsBySubject). The default `text_ops` btree opclass
    // does NOT serve `LIKE 'prefix%'` under a non-`C` collation (the prefix
    // degrades to a post-scan Filter → Seq Scan over the shared
    // workspace_id='default' partition that holds every tenant's skills). The
    // `text_pattern_ops` opclass compares by raw byte order, making the prefix a
    // left-anchored index range (`agent_id ~>=~ 'x' AND agent_id ~<~ 'y'`).
    // Partial on `kind='skill' AND t_invalid IS NULL` (the query's constant
    // predicates) keeps the index small. Leading `workspace_id` (equality) +
    // `agent_id` (range) mirrors the listSkillsBySubject WHERE shape.
    index('idx_memories_skill_subject_prefix')
      .on(table.workspaceId, table.agentId.op('text_pattern_ops'))
      .where(sql`${table.kind} = 'skill' AND ${table.tInvalid} IS NULL`),
    check(
      // EC-1 absorption (plan v1.1): name verbatim, cited by
      // migration 0002_skill_columns.sql DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT pair.
      'memories_kind_derived_from_check',
      // NOTE: the `derived` branch requires `derived_from IS NOT NULL` explicitly.
      // Without it, `jsonb_array_length(NULL) >= 1` evaluates to NULL, the whole
      // CHECK evaluates to NULL, and Postgres ADMITS the row (CHECK only rejects
      // on FALSE) — so `kind='derived'` with `derived_from=NULL` slipped through.
      sql`(${table.kind} = 'extracted' AND ${table.derivedFrom} IS NULL)
       OR (${table.kind} = 'derived' AND ${table.derivedFrom} IS NOT NULL AND jsonb_array_length(${table.derivedFrom}) >= 1)
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
 */
export const reflectionCounters = pgTable(
  'reflection_counters',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    /** multi-tenant-workspace-isolation T0.2 (D-LEAF / EC-1). */
    workspaceId: text('workspace_id').notNull().default('default'),
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
    /** multi-tenant-workspace-isolation T0.2 (D-LEAF / EC-1 — entities are queried
     *  by name/embedding BEFORE any join, so they MUST carry their own column). */
    workspaceId: text('workspace_id').notNull().default('default'),
    name: text('name').notNull(),
    embedding: vector('embedding', { dimensions: MAX_EMBEDDING_DIM }).notNull(),
    payload: jsonb('payload').$type<Record<string, string | number | boolean | null>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** entity-extraction-nodes-slice1 T2.1 — node extraction populates these.
     *  Nullable (additive; pre-existing rows survive per the no-backfill ADR).
     *  `type` is part of the dedup identity (EC-1) so PROPER "Apple" and NOUN
     *  "apple" do not silently merge. `normalized_key` = lowercased, underscored
     *  name (per-scope dedup key). Scope columns mirror `memories` (one tier set,
     *  others NULL — AND-composed via COALESCE in the UNIQUE below). */
    type: text('type'),
    normalizedKey: text('normalized_key'),
    userId: text('user_id'),
    sessionId: text('session_id'),
    agentId: text('agent_id'),
  },
  (table) => [
    index('entities_name_idx').on(table.name),
    index('entities_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    // EC-1 dedup identity: COALESCE on the nullable scope tiers (NULL != NULL in a
    // plain UNIQUE) — mirrors `memories_hash_scope_unique_idx`. workspace_id is
    // NOT NULL (no COALESCE). `type` + `normalized_key` complete the identity.
    uniqueIndex('entities_scope_type_key_uq').on(
      table.workspaceId,
      sql`COALESCE(${table.userId}, '')`,
      sql`COALESCE(${table.sessionId}, '')`,
      sql`COALESCE(${table.agentId}, '')`,
      sql`COALESCE(${table.type}, '')`,
      sql`COALESCE(${table.normalizedKey}, '')`,
    ),
  ],
);

/**
 * entity-extraction-nodes-slice1 T2.1 — provenance link memory↔entity.
 * Gives `memory_count` (distinct memories per entity via the composite PK) +
 * provenance (Princípio 3). Both FKs CASCADE so forget/GDPR delete cleans links.
 */
export const memoryEntities = pgTable(
  'memory_entities',
  {
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.entityId] }),
    // entity_id-leading index for the handler's GROUP BY (count memories per entity).
    index('memory_entities_entity_id_idx').on(table.entityId),
  ],
);

/**
 * entity-relation-extraction-slice2 T1.1 — relation (triple) edges between entity
 * nodes. A triple `{source, relation, destination}` is two entity FKs + the
 * relation label + `source_memory_id` provenance (Princípio 3). NO graph DB —
 * `JOIN`s cover the 1–2 hop dashboard view (ADR D2). All 3 FKs CASCADE so a
 * forget/GDPR delete of a memory OR an entity cleans its edges.
 *
 * EC-1: `source_memory_id` IS part of the dedup UNIQUE (one row per triple+memory)
 * so `memory_count = count(DISTINCT source_memory_id) GROUP BY triple` aggregates
 * correctly. Leaving it OUT would freeze `memory_count` at 1 (silent wrong data).
 */
export const entityEdges = pgTable(
  'entity_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id').notNull().default('default'),
    sourceEntityId: uuid('source_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    targetEntityId: uuid('target_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    /** Human relation label (first-write-wins on dedup). */
    relation: text('relation').notNull(),
    /** Lowercased + underscored relation — the dedup key component. */
    normalizedRelation: text('normalized_relation').notNull(),
    /** Provenance: the memory whose text produced this triple. */
    sourceMemoryId: uuid('source_memory_id').references(() => memories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /**
     * M1 — edge-level bi-temporal validity (mirrors `memories`). An edge is
     * currently-active iff `t_invalid IS NULL`. Set on forget-propagation (source
     * memory forgotten) or supersession (same source+relation, new target).
     */
    tValid: timestamp('t_valid', { withTimezone: true }).defaultNow().notNull(),
    tInvalid: timestamp('t_invalid', { withTimezone: true }),
    /** Scope tiers mirror `entities` (one set, others NULL — AND-composed via COALESCE). */
    userId: text('user_id'),
    sessionId: text('session_id'),
    agentId: text('agent_id'),
  },
  (table) => [
    // Read path: aggregate edges per (source, relation, target) within a scope.
    index('entity_edges_source_idx').on(table.sourceEntityId),
    index('entity_edges_target_idx').on(table.targetEntityId),
    // M1 — active-edge read path (traversal + graph surfaces filter t_invalid IS NULL).
    index('entity_edges_active_idx')
      .on(table.sourceEntityId)
      .where(sql`${table.tInvalid} IS NULL`),
    // EC-1 dedup identity: source_memory_id IS in the arbiter → one row per
    // (triple, memory) → count(DISTINCT source_memory_id) GROUP BY triple is correct.
    // COALESCE on the nullable scope tiers (NULL != NULL in a plain UNIQUE).
    uniqueIndex('entity_edges_scope_triple_uq').on(
      table.workspaceId,
      sql`COALESCE(${table.userId}, '')`,
      sql`COALESCE(${table.sessionId}, '')`,
      sql`COALESCE(${table.agentId}, '')`,
      table.sourceEntityId,
      table.normalizedRelation,
      table.targetEntityId,
      sql`COALESCE(${table.sourceMemoryId}::text, '')`,
    ),
  ],
);

/** Audit-trail rows for Memory.history(id). Append-only; ordered by (timestamp DESC, id DESC) per EC-18. */
export const history = pgTable(
  'history',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    /** multi-tenant-workspace-isolation T0.2 (D-LEAF / EC-1). */
    workspaceId: text('workspace_id').notNull().default('default'),
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
 * @see src/local/migrations/0007_distillation_columns.sql
 */
export const consolidationHistory = pgTable(
  'consolidation_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** multi-tenant-workspace-isolation T0.2 (D-LEAF / EC-1). */
    workspaceId: text('workspace_id').notNull().default('default'),
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
 * @see src/core/dip/recall-cache-store.ts (13th DIP contract)
 */
export const recallCache = pgTable(
  'recall_cache',
  {
    id: serial('id').primaryKey(),
    /** multi-tenant-workspace-isolation T0.2 (D-LEAF / EC-1 + EC-8 — the cache is
     *  looked up by (scope_key, query_embedding) cosine BEFORE any join, so the
     *  workspace MUST be part of the row to prevent a cross-workspace cache hit). */
    workspaceId: text('workspace_id').notNull().default('default'),
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

/**
 * theo_api_keys — Camada 2 OSS multi-user lifecycle table per plan
 * `theo-memory-faang-auth-lifecycle` § T0.2 + ADRs D2 + D5 + D6.
 *
 * Mirrors the cloud-repo Stripe-shape impl at
 * the platform's canonical Stripe-shape key routes
 * — single unified `theo_live_*` key per ADR D1 of the cloud plan; SHA-256
 * hash-at-rest per D4; 12-char prefix display per D3; soft-delete via
 * `revoked_at` per D7; `rotated_from` self-FK powers the lineage recursive
 * CTE per the same cloud plan.
 *
 * Single-tenant OSS variant (D6): `tenant_id` defaults to `'self'` constant;
 * the column ships in the schema (NOT removed) so the SAME schema is
 * forward-compatible if/when multi-tenant ships behind a flag.
 *
 * **EC-2 absorption (DB CHECK constraint):** the `id != rotated_from`
 * constraint forbids self-rotation cycles at the row level — defense in
 * depth on top of the lineage CTE UNION dedupe. A buggy INSERT that sets
 * `A.rotated_from = A` would otherwise make the recursive CTE loop until
 * `LIMIT 100` kicks in. Constraint is enforced via the migration
 * `0012_theo_api_keys.sql` — Drizzle does not yet have a portable `check()`
 * builder in v0.31 that survives `db:push`; the SQL clause is authoritative.
 *
 * **EC-11 absorption (SHA-256 collision):** the `key_hash` UNIQUE constraint
 * catches the astronomical 1-in-2^128 collision case + returns 500 INTERNAL
 * via the `isUniqueViolation()` discriminator (port from cloud T2.1).
 * Documented per ADR D4 of cloud plan; no extra code needed beyond UNIQUE.
 *
 */
export const theoApiKeys = pgTable(
  'theo_api_keys',
  {
    // Format: `apk-{16hex}` per cloud `pkg/id` convention (ID validated via
    // regex BEFORE any DB query at the handler layer per cloud EC-2).
    id: varchar('id', { length: 20 }).primaryKey(),
    // Authenticated user subject (any string — JWT `sub` claim in cloud;
    // bootstrap-token-issued admin keys may use `bootstrap` literal).
    subject: text('subject').notNull(),
    // Single-tenant constant per ADR D6 — `'self'` always in OSS. RETAINED for
    // backward-compat read after multi-tenant-workspace-isolation (Q1).
    tenantId: text('tenant_id').notNull().default('self'),
    // multi-tenant-workspace-isolation T0.2: the credential→workspace binding.
    // resolvePrincipal joins on key_hash and returns this workspace_id (ADR D2).
    // Backfilled to 'default' for pre-0016 keys (ADR D5).
    workspaceId: text('workspace_id').notNull().default('default').references(() => workspaces.id),
    // multi-tenant-rbac-and-slice1-completion T0.2 (ADR D2): the membership the
    // key acts as. Role resolution LEFT JOINs workspace_users on
    // (workspace_id, user_id). Nullable — legacy keys have no member; backfilled
    // to 'default-owner' by 0017. ON DELETE SET NULL so deleting a user does not
    // orphan the key as a dangling FK.
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    // Human-friendly label shown in the keys list + audit log. Trimmed
    // non-empty per cloud EC-4.
    keyName: varchar('key_name', { length: 64 }).notNull(),
    // SHA-256 hex (64 chars) of the raw `theo_live_*` secret. UNIQUE catches
    // hash collisions (astronomically unlikely; EC-11 absorbed).
    keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
    // First 12 chars of the raw secret (`theo_live_Ab`) for masked display
    // in list/lineage UI — secret itself is shown ONCE post-create.
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    // jsonb array of scope literals from the v0.1 enum (`memory:read` /
    // `memory:write` / `memory:delete` / `memory:admin`) per blueprint Q2.
    scopes: jsonb('scopes').$type<readonly string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    // Nullable per cloud ADR D6 — NULL means never-expires.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Soft-delete per cloud ADR D7 — hard DELETE forbidden. Lineage CTE
    // walks regardless of `revoked_at` so historical chain is visible.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // Self-FK powering the rotation lineage chain. NULL for unrotated keys.
    rotatedFrom: varchar('rotated_from', { length: 20 }),
  },
  (table) => [
    // Hot path: SELECT 1 ... WHERE subject = $1 AND tenant_id = $2 AND revoked_at IS NULL.
    // Partial index excludes revoked rows from the index (smaller + faster).
    index('idx_theo_api_keys_subject_tenant')
      .on(table.subject, table.tenantId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/**
 * admin_config — single-row config table powering ADR D7 bootstrap
 * self-revoke (EC-3 absorption of the plan's edge-case review).
 *
 * After the first admin key is issued via the env-bootstrap token, the
 * `bootstrap_consumed` flag flips to TRUE in the SAME transaction as
 * the INSERT — making the bootstrap-token path single-use. Subsequent
 * bootstrap-token attempts return 401 `BOOTSTRAP_CONSUMED`. Closes the
 * EC-3 silent-backdoor exploit (leaked bootstrap token persisting even
 * after admin key revoke).
 *
 * Single-row invariant enforced via `id INT PRIMARY KEY DEFAULT 1
 * CHECK (id = 1)` in the migration. Migration seeds the row on first
 * install via `INSERT ... ON CONFLICT DO NOTHING`.
 *
 */
export const adminConfig = pgTable('admin_config', {
  id: integer('id').primaryKey().default(1),
  bootstrapConsumed: boolean('bootstrap_consumed').notNull().default(false),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

/**
 * scope_usage_counters — per-scope cumulative `recall()` counter
 * (themory-scoped-forget-and-retrieval-counter § T2.1, ADR D2). NOT tied to a
 * memory (a recall is scope-level, not row-level) → no FK to `memories`; a
 * counter outlives individual rows. The UNIQUE on the scope tuple (COALESCE on
 * the nullable tiers — NULL != NULL in a plain UNIQUE) is the ON CONFLICT
 * arbiter `PgUsageCounterStore.increment` names (EC-3: same expression on write
 * + read). `recall_count` is `mode:'number'` so `getRecallCount()` returns a JS
 * number that serializes as `retrieval_api_usage` in the metrics JSON.
 */
export const scopeUsageCounters = pgTable(
  'scope_usage_counters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id').notNull().default('default'),
    userId: text('user_id'),
    sessionId: text('session_id'),
    agentId: text('agent_id'),
    recallCount: bigint('recall_count', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('scope_usage_counters_scope_uq').on(
      table.workspaceId,
      sql`COALESCE(${table.userId}, '')`,
      sql`COALESCE(${table.sessionId}, '')`,
      sql`COALESCE(${table.agentId}, '')`,
    ),
  ],
);

/**
 * `recall_traces` — the write-side of "accountable forgetting" (explainable-recall
 * S1). One row per DROPPED candidate of a recall, keyed by `recall_id`, so the
 * negative-space (what was dropped + why) is queryable (blueprint ADR D2).
 * Populated opt-in from inside the retrieval pipeline (fail-soft, D3); read back
 * by `RecallTraceStore.getByRecallId`. Scoped by `workspace_id` per the
 * data-plane tenant invariant.
 */
export const recallTraces = pgTable(
  'recall_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Correlation id of the recall this drop belongs to (server-minted UUID). */
    recallId: text('recall_id').notNull(),
    /** Tenant boundary — the resolved Principal's workspace. */
    workspaceId: text('workspace_id').notNull().default('default'),
    /** Scope key (tier + id) the recall ran under. */
    scopeKey: text('scope_key').notNull(),
    /** The dropped candidate's memory id. */
    memoryId: text('memory_id').notNull(),
    /** Semantic (cosine) component of the additive score. */
    semantic: real('semantic').notNull(),
    /** BM25 lexical component. */
    bm25: real('bm25').notNull(),
    /** Entity-boost component (uniformly 0 in v0.1 — schema-forward). */
    entity: real('entity').notNull().default(0),
    /** Additive composite in [0,1]; NULL for `semantic_gate` drops (EC-6). */
    composite: real('composite'),
    /** The threshold this recall applied. */
    threshold: real('threshold').notNull(),
    /** Why the candidate was dropped: semantic_gate | sub_threshold | nan | mmr_redundant. */
    dropReason: text('drop_reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Read path: getByRecallId(recall_id) — the S2 explain surface reads by this.
    index('recall_traces_recall_id_idx').on(table.recallId),
    // Tenant-scoped scan + retention sweep (Unresolved Q1 follow-up).
    index('recall_traces_ws_created_idx').on(table.workspaceId, table.createdAt),
  ],
);

/** Source ledger. A new assertion is not necessarily a new origin. */
export const memoryEvidence = pgTable('memory_evidence', {
  evidenceId: uuid('evidence_id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  memoryId: uuid('memory_id').notNull().references(() => memories.id, { onDelete: 'cascade' }),
  originSourceId: text('origin_source_id').notNull(),
  evidence: jsonb('evidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('memory_evidence_workspace_id_memory_id_origin_source_id_key').on(table.workspaceId, table.memoryId, table.originSourceId),
  index('memory_evidence_page_idx').on(table.workspaceId, table.memoryId, table.createdAt, table.evidenceId),
]);

/** Minimal per-request receipts; erased with the memory they refer to. */
export const memoryWriteReceipts = pgTable('memory_write_receipts', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  scopeKey: text('scope_key').notNull(), requestKey: text('request_key').notNull(),
  requestHash: text('request_hash').notNull(),
  memoryId: uuid('memory_id').notNull().references(() => memories.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ name: 'memory_write_receipts_pkey', columns: [table.workspaceId, table.scopeKey, table.requestKey, table.memoryId] })]);

/** Durable extraction queue. Input and drafts are purged before minimal receipts. */
export const memoryJobs = pgTable('memory_jobs', {
  jobId: uuid('job_id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  requesterId: text('requester_id').notNull(), idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(), input: jsonb('input'), drafts: jsonb('drafts'),
  status: text('status').notNull().default('queued'), attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone:true }).notNull().defaultNow(),
  leaseToken: uuid('lease_token'), leaseUntil: timestamp('lease_until', { withTimezone:true }),
  resultMemoryIds: jsonb('result_memory_ids').notNull().default(sql`'[]'::jsonb`), errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone:true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone:true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone:true }),
}, (table) => [
  unique('memory_jobs_workspace_id_requester_id_idempotency_key_key').on(table.workspaceId,table.requesterId,table.idempotencyKey),
  index('memory_jobs_claim_idx').on(table.status,table.availableAt,table.createdAt),
  check('memory_jobs_status_check',sql`${table.status} IN ('queued','running','succeeded','failed')`),
  check('memory_jobs_attempts_check',sql`${table.attempts} >= 0`),
]);

/**
 * Immutable log of the raw messages each write received (ADR-0027). Rows are appended and
 * erased, never updated. `seq` orders messages within a scope independent of clock ties.
 */
export const memoryMessages = pgTable('memory_messages', {
  messageId: uuid('message_id').primaryKey().defaultRandom(),
  seq: bigserial('seq', { mode: 'bigint' }).notNull(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id'), sessionId: text('session_id'), agentId: text('agent_id'),
  role: text('role').notNull(), content: text('content').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }),
  loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('memory_messages_scope_seq_idx').on(table.workspaceId, table.userId, table.sessionId, table.agentId, table.seq),
  check('memory_messages_role_check', sql`${table.role} IN ('user','assistant','system')`),
]);

/** Which messages produced which memory. Cascades from both sides. */
export const memoryMessageSources = pgTable('memory_message_sources', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  memoryId: uuid('memory_id').notNull().references(() => memories.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').notNull().references(() => memoryMessages.messageId, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ name: 'memory_message_sources_pkey', columns: [table.workspaceId, table.memoryId, table.messageId] }),
  index('memory_message_sources_message_idx').on(table.workspaceId, table.messageId),
]);
