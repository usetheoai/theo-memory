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
 *  - Bi-temporal columns (t_valid/t_invalid) nullable per ADR-0006 — local runtime throws
 *    BiTemporalNotSupportedLocally on asOf queries until v0.5
 *  - payload: jsonb storing Record<string, string | number | boolean | null>
 *  - text_lemmatized: jsonb storing string[] (pre-computed BM25 tokens, blueprint Recommendation 3)
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T2.1 + ADR D1.7
 * @see referencia/letta/letta/orm/passage.py:1-105
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
    textLemmatized: jsonb('text_lemmatized').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('memories_hash_unique_idx').on(table.hash),
    index('memories_user_id_idx').on(table.userId),
    index('memories_session_id_idx').on(table.sessionId),
    index('memories_agent_id_idx').on(table.agentId),
    index('memories_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
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
