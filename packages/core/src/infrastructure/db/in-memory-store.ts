/**
 * Map-backed VectorStore — T3.2 of v0-1-local-runtime plan v1.3.
 *
 * Pure-JS implementation of the VectorStore DIP. Zero I/O, zero deps.
 * Purpose:
 *  - Unit-test fixture for extraction + retrieval pipelines (mockEmbedding fixture-pattern)
 *  - Dev quickstart for consumers experimenting without spinning up Postgres
 *  - Reference implementation that any other adapter is compared against
 *
 * Scoring: cosine similarity computed by dot product (assumes unit vectors when
 * possible; falls back to full cosine for non-normalized input).
 *
 * Filter semantics: ANDed across user_id / session_id / agent_id. Missing keys
 * in the Filters object are skipped (NOT filtered to NULL — passes-through).
 *
 * @see blueprint Recommendation 6 + ADR D6
 */
import type { InsertOutcome, VectorStore, VectorStoreResult } from '../../domain/dip/vector-store.js';
import {
  type EpisodeListOptions,
  decodeEpisodeCursor,
  resolveEpisodeLimit,
} from '../../domain/episode.js';
import { InvalidSkillError } from '../../domain/errors.js';
import { evidenceFromPayload } from '../../domain/memory-evidence.js';
import { bm25Scores } from '../../domain/retrieval/bm25.js';
import type { Filters } from '../../domain/scope.js';
import type { SkillLanguage } from '../../domain/skill.js';

import type {
  InsertDerivedSkillArgs,
  InsertSkillArgs,
  ListSkillsBySubjectArgs,
} from './skill-store-args.js';

type Payload = Record<string, string | number | boolean | null>;

interface StoredRow {
  readonly vector: readonly number[];
  readonly payload: Payload;
  /**
   * dashboard-memories-tab-standardization T2.2 — wall-clock when the row was
   * stamped at `insert()` time. Projected through `VectorStoreResult.createdAt`
   * on `list()` so consumers (e.g., LocalScopedMemory.getAll) honor real
   * row-temporal truth instead of synthesizing `new Date()` per call.
   */
  readonly createdAt: Date;
}

function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Compare two `(created_at, id)` positions. Returns <0 / 0 / >0 like a
 * standard comparator (ascending). Used by listEpisodes cursor filtering.
 */
function compareCreatedAtId(aDate: Date, aId: string, bDate: Date, bId: string): number {
  const dt = aDate.getTime() - bDate.getTime();
  if (dt !== 0) return dt;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

function matchesFilters(payload: Payload, filters: Filters | undefined, includeInvalid = false): boolean {
  const expiry = payload['expires_at'];
  const instant = filters?.asOf?.getTime() ?? Date.now();
  if (typeof expiry === 'string' && Date.parse(expiry) <= instant) return false;
  // ADR-0029: a superseded row stops being current at its t_invalid, but stays for earlier reads.
  const invalidFrom = payload['t_invalid'];
  if (!includeInvalid && typeof invalidFrom === 'string' && Date.parse(invalidFrom) <= instant) return false;
  // Bi-temporal replay: a row is not yet valid before its valid-from instant.
  const validFrom = payload['t_valid'];
  if (filters?.asOf !== undefined && typeof validFrom === 'string' && Date.parse(validFrom) > filters.asOf.getTime()) {
    return false;
  }
  if (filters === undefined) {
    return true;
  }
  // v0.6: skill-aware filter fields are not generic equality checks — handle them first.
  if (filters.excludeSuperseded === true) {
    const supersededBy = payload['superseded_by'];
    if (supersededBy !== undefined && supersededBy !== null && supersededBy !== '') {
      return false;
    }
  }
  if (filters.kind !== undefined && payload['kind'] !== filters.kind) {
    return false;
  }
  // themory-category-filter-server-side T3.1 / EC-3 — empty-string filter
  // normalizes to no-filter at the store boundary so in-memory + pgvector +
  // LocalScopedMemory all share identical semantic. The generic loop below
  // would otherwise treat filters.category='' as "filter for rows where
  // payload.category === ''" which is NOT the intended ADR D5 behavior.
  if (filters.category !== undefined && filters.category !== '') {
    if (payload['category'] !== filters.category) {
      return false;
    }
  }
  // M8 hierarchical recall — overrides plain session_id/agent_id equality with the tier's
  // hierarchical predicate (mirrors composeFilters in pgvector-store). When set, it OWNS
  // session_id/agent_id (filtersFromScope does not also emit them as plain equalities).
  if (filters.scopeHierarchy !== undefined) {
    const isNull = (v: unknown): boolean => v === undefined || v === null;
    const sessionId = payload['session_id'];
    const agentId = payload['agent_id'];
    if (filters.scopeHierarchy === 'global') {
      // GLOBAL: durable user rows only.
      if (!isNull(sessionId) || !isNull(agentId)) return false;
    } else {
      // SESSION ∪ GLOBAL: this session's rows OR the user's global rows (no agent rows).
      if (!isNull(agentId)) return false;
      if (!isNull(sessionId) && sessionId !== filters.scopeHierarchy.session) return false;
    }
  }
  // Generic equality loop for the scope keys (user_id / session_id / agent_id). Skip the
  // v0.6 + category fields handled above so they don't get mis-evaluated as payload-equality checks.
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'asOf' || key === 'kind' || key === 'excludeSuperseded' || key === 'category' || key === 'scopeHierarchy') {
      continue;
    }
    // M8: when scopeHierarchy owns session_id/agent_id, skip their plain equality (kept in
    // the filter for the WRITE column derivation; the hierarchy branch above is the recall).
    if (filters.scopeHierarchy !== undefined && (key === 'session_id' || key === 'agent_id')) {
      continue;
    }
    if (payload[key] !== value) {
      return false;
    }
  }
  return true;
}

export class InMemoryVectorStore implements VectorStore {
  private rows = new Map<string, StoredRow>();
  private currentUserId = '';

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  async insert(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
  ): Promise<readonly InsertOutcome[]> {
    if (vectors.length !== ids.length || vectors.length !== payloads.length) {
      throw new Error('insert: vectors, ids, and payloads must have equal length');
    }
    const outcomes: InsertOutcome[] = [];
    for (let i = 0; i < vectors.length; i += 1) {
      const id = ids[i] as string;
      const vector = vectors[i] as readonly number[];
      const payload = payloads[i] as Payload;
      this.rows.set(id, { vector, payload, createdAt: new Date() });
      // principles-alignment-hardening T2.1 — InMemoryVectorStore has no
      // UPSERT semantics (Map.set overwrites silently). Each row is treated
      // as a fresh insert: confirmationCount=1, rejectedAsDuplicate=false.
      // PgvectorStore is the source of truth for dedup-collision semantics.
      outcomes.push({ id, confirmationCount: 1, rejectedAsDuplicate: false });
    }
    await Promise.resolve();
    return outcomes;
  }

  async search(
    query: readonly number[],
    topK = 10,
    filters?: Filters,
  ): Promise<readonly VectorStoreResult[]> {
    const candidates: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (!matchesFilters(row.payload, filters)) {
        continue;
      }
      candidates.push({ id, payload: row.payload, score: cosineSim(query, row.vector) });
    }
    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    await Promise.resolve();
    return candidates.slice(0, topK);
  }

  async keywordSearch(
    query: string,
    topK = 10,
    filters?: Filters,
    queryVector?: readonly number[],
  ): Promise<readonly VectorStoreResult[] | null> {
    const tokenize = (text: string): string[] => text.toLowerCase().split(/\W+/).filter((t) => t.length > 0);
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }
    // BM25 over the rows the search is scoped to (same corpus definition as PgvectorStore).
    const scoped = [...this.rows.entries()].filter(([, row]) => matchesFilters(row.payload, filters));
    const scores = bm25Scores(
      queryTokens,
      scoped.map(([id, row]) => ({ id, terms: tokenize(String(row.payload['text'] ?? '')) })),
    );
    const candidates: VectorStoreResult[] = scoped
      .filter(([id]) => scores.has(id))
      .map(([id, row]) => ({
        id,
        payload: row.payload,
        score: scores.get(id) ?? 0,
        ...(queryVector === undefined ? {} : { similarity: cosineSim(queryVector, row.vector) }),
      }));
    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    await Promise.resolve();
    return candidates.slice(0, topK);
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const row = this.rows.get(vectorId);
    await Promise.resolve();
    if (row === undefined) {
      return null;
    }
    return { id: vectorId, payload: row.payload, createdAt: row.createdAt };
  }

  async update(vectorId: string, vector: readonly number[], payload: Payload): Promise<void> {
    // Preserve the original createdAt across updates (mutation does NOT change
    // first-persisted timestamp per ADR-0003 ADD-only contract); fall back to
    // `new Date()` when the id was not seen before (callers may use update()
    // as an upsert-when-row-missing — rare but legal).
    const existingCreatedAt = this.rows.get(vectorId)?.createdAt ?? new Date();
    this.rows.set(vectorId, { vector, payload, createdAt: existingCreatedAt });
    await Promise.resolve();
  }

  async delete(vectorId: string): Promise<void> {
    this.rows.delete(vectorId);
    await Promise.resolve();
  }

  async supersede(filters: Filters, memoryIds: readonly string[], by: { readonly memoryId: string; readonly at: Date }): Promise<readonly string[]> {
    await Promise.resolve();
    const superseded: string[] = [];
    for (const id of new Set(memoryIds)) {
      const row = this.rows.get(id);
      if (row === undefined || id === by.memoryId || typeof row.payload['t_invalid'] === 'string') continue;
      if (((row.payload['workspace_id'] as string | undefined) ?? 'default') !== (filters.workspace_id ?? 'default')) continue;
      const outOfScope = (['user_id', 'session_id', 'agent_id'] as const)
        .some((col) => filters[col] !== undefined && filters[col] !== null && row.payload[col] !== filters[col]);
      if (outOfScope) continue;
      // Like Postgres, a row without an explicit valid time is valid from when it was stored.
      const validFrom = typeof row.payload['t_valid'] === 'string' ? Date.parse(row.payload['t_valid']) : row.createdAt.getTime();
      if (validFrom > by.at.getTime()) continue;
      this.rows.set(id, { ...row, payload: { ...row.payload, t_invalid: by.at.toISOString(), superseded_by_memory: by.memoryId } });
      superseded.push(id);
    }
    return superseded;
  }

  async setImportance(filters: Filters, memoryId: string, importance: number): Promise<boolean> {
    await Promise.resolve();
    const row = this.rows.get(memoryId);
    if (row === undefined || typeof row.payload['t_invalid'] === 'string') return false;
    if (((row.payload['workspace_id'] as string | undefined) ?? 'default') !== (filters.workspace_id ?? 'default')) return false;
    const outOfScope = (['user_id', 'session_id', 'agent_id'] as const)
      .some((col) => filters[col] !== undefined && filters[col] !== null && row.payload[col] !== filters[col]);
    if (outOfScope) return false;
    this.rows.set(memoryId, { ...row, payload: { ...row.payload, llm_importance_score: importance } });
    return true;
  }

  /** Scope-checked delete (themory-scoped-forget T1.1). In-memory has no
   *  `t_invalid`, so soft and hard both physically remove once the row's
   *  workspace + every bound scope-tier column match `filters`. Returns whether
   *  a row matched (mirrors PgvectorStore.deleteInScope; cross-scope → false). */
  async deleteInScope(vectorId: string, filters: Filters): Promise<boolean> {
    await Promise.resolve();
    const row = this.rows.get(vectorId);
    if (row === undefined) return false;
    const rowWs = (row.payload['workspace_id'] as string | undefined) ?? 'default';
    if (rowWs !== (filters.workspace_id ?? 'default')) return false;
    for (const col of ['user_id', 'session_id', 'agent_id'] as const) {
      const val = filters[col];
      if (val !== undefined && val !== null && row.payload[col] !== val) return false;
    }
    this.rows.delete(vectorId);
    return true;
  }

  async deleteCol(): Promise<void> {
    this.rows.clear();
    await Promise.resolve();
  }

  async list(
    filters?: Filters,
    topK = 100,
    _includeSoftDeleted = false,
    offset = 0,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    // Forget hard-deletes here; the only invalidated rows are superseded ones (ADR-0029),
    // which `includeSoftDeleted` returns like PgvectorStore does.
    const matching: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (!matchesFilters(row.payload, filters, _includeSoftDeleted)) {
        continue;
      }
      // dashboard-memories-tab-standardization T2.2 — project createdAt so
      // consumers (LocalScopedMemory.getAll) honor real row-temporal truth.
      // themory-category-filter-server-side T3.1 — project category from payload
      // so consumers reading VectorStoreResult.category (top-level) get the same
      // value as those reading payload.category (EC-12 dual-pathway symmetry).
      const rawCategory = row.payload['category'];
      const projected: VectorStoreResult & { category?: string } =
        typeof rawCategory === 'string' && rawCategory.length > 0
          ? { id, payload: row.payload, createdAt: row.createdAt, category: rawCategory }
          : { id, payload: row.payload, createdAt: row.createdAt };
      matching.push(projected);
    }
    // EC-6 — deterministic pagination order: sort by createdAt DESC, id ASC
    // (matches PgvectorStore.list T2.1 ORDER BY contract). Without this, Map
    // insertion order is V8-impl-defined and produces flickering Dashboard
    // pagination when two rows share the same millisecond timestamp.
    matching.sort((a, b) => {
      const dt = (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
      if (dt !== 0) {
        return dt;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    await Promise.resolve();
    return [matching.slice(offset, offset + topK), matching.length];
  }

  /**
   * Entity-filtered listing (theo-cloud#252) — the in-memory store tracks NO
   * entity links (`memory_entities` is a Pg-only structure), so the honest
   * answer is an empty page, never the scope fallback (returning the whole
   * scope here is exactly the bug the filter exists to close). Duck-typed
   * extension mirroring PgvectorStore.listByEntity.
   */
  async listByEntity(
    _filters?: Filters,
    _entityName?: string,
    _topK = 100,
    _offset = 0,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    await Promise.resolve();
    return [[], 0];
  }

  /**
   * Session enumeration (session-separation fix 2026-07-23) — distinct
   * `session_id` values under the `(workspace, user)` anchor in `filters`,
   * with live counts + newest activity, ordered by lastActivityAt DESC.
   * Duck-typed store extension (mirrors the skills-methods precedent): NOT part
   * of the VectorStore DIP; `LocalScopedMemory.listSessions` feature-detects it.
   */
  async listSessions(
    filters?: Filters,
  ): Promise<readonly { sessionId: string; memoryCount: number; lastActivityAt: Date }[]> {
    await Promise.resolve();
    const wsFilter = filters?.workspace_id ?? 'default';
    const userFilter = filters?.user_id;
    const byId = new Map<string, { memoryCount: number; lastActivityAt: Date }>();
    for (const row of this.rows.values()) {
      const sessionId = row.payload['session_id'];
      if (typeof sessionId !== 'string' || sessionId.length === 0) continue;
      if (((row.payload['workspace_id'] as string | undefined) ?? 'default') !== wsFilter) continue;
      if (userFilter !== undefined && userFilter !== null && row.payload['user_id'] !== userFilter) continue;
      const at = row.createdAt ?? new Date(0);
      const agg = byId.get(sessionId);
      if (agg === undefined) {
        byId.set(sessionId, { memoryCount: 1, lastActivityAt: at });
      } else {
        agg.memoryCount += 1;
        if (at > agg.lastActivityAt) agg.lastActivityAt = at;
      }
    }
    return [...byId.entries()]
      .map(([sessionId, a]) => ({ sessionId, ...a }))
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }

  /**
   * first-class-episodes M2 T2.1 — cursor-paginated temporal list.
   *
   * Mirrors PgvectorStore.listEpisodes ordering `(created_at, id)` so the
   * in-memory contract matches the GOAL (pgvector) behavior. Note: this store
   * hard-deletes (no `t_invalid` tombstones), so `options.asOf` bi-temporal
   * replay is a no-op here — the GOAL integration test (T4.1) covers asOf on the
   * real pgvector runtime. `queryText` is a literal case-insensitive substring
   * match (inherently non-wildcard; the SQL escape concern does not apply here).
   *
   */
  async listEpisodes(
    filters: Filters | undefined,
    options: EpisodeListOptions,
  ): Promise<readonly VectorStoreResult[]> {
    const cap = resolveEpisodeLimit(options.limit);
    const order: 'asc' | 'desc' = options.order ?? 'desc';
    const queryText = options.queryText?.toLowerCase();

    let rows: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (!matchesFilters(row.payload, filters)) {
        continue;
      }
      if (queryText !== undefined && queryText.length > 0) {
        const text = String(row.payload['text'] ?? '').toLowerCase();
        if (!text.includes(queryText)) {
          continue;
        }
      }
      rows.push({ id, payload: row.payload, createdAt: row.createdAt });
    }

    // Sort by (created_at, id) in the active order. id (string) is the
    // deterministic tie-break for identical timestamps. Reuses the single
    // canonical comparator (F-arch-4 DRY) so the cursor filter + sort never drift.
    const dir = order === 'asc' ? 1 : -1;
    rows.sort(
      (a, b) =>
        compareCreatedAtId(a.createdAt ?? new Date(0), a.id, b.createdAt ?? new Date(0), b.id) * dir,
    );

    // Cursor filter (after/before). At most one is honored; after wins.
    const cursorRaw = options.after ?? options.before;
    if (cursorRaw !== undefined) {
      const isAfter = options.after !== undefined;
      const cursor = decodeEpisodeCursor(cursorRaw);
      rows = rows.filter((r) => {
        const cmp = compareCreatedAtId(r.createdAt ?? new Date(0), r.id, cursor.createdAt, cursor.id);
        // In the active order, "after" keeps rows that come strictly later in the
        // sequence; "before" keeps rows strictly earlier. `dir` maps the
        // (created_at,id) comparison onto sequence position.
        const seq = cmp * dir; // <0 earlier-in-sequence, >0 later-in-sequence
        return isAfter ? seq > 0 : seq < 0;
      });
    }

    // Over-fetch cap+1 so the façade can detect more pages.
    await Promise.resolve();
    return rows.slice(0, cap + 1);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getUserId(): Promise<string> {
    return this.currentUserId;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async setUserId(userId: string): Promise<void> {
    this.currentUserId = userId;
  }

  /**
   * Look up the cached importance score by content hash (parity with
   * PgvectorStore.getImportanceByHash). Per plan T5.2 + ADR D8.
   */
  async getImportanceByHash(hash: string): Promise<number | null> {
    for (const row of this.rows.values()) {
      if (row.payload['hash'] === hash) {
        const score = row.payload['llm_importance_score'];
        if (typeof score === 'number') {
          return score;
        }
        return null;
      }
    }
    await Promise.resolve();
    return null;
  }

  /** Persist a cached importance score (parity). */
  async setImportanceByHash(hash: string, score: number): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.payload['hash'] === hash) {
        (row.payload as Record<string, string | number | boolean | null>)[
          'llm_importance_score'
        ] = score;
        await Promise.resolve();
        return;
      }
    }
  }

  /**
   * Persist a derived memory (parity with PgvectorStore.insertDerivedMemory)
   * per plan T4.3 + ADR D6 + ADR D7. In-memory adapter stores kind +
   * derived_from in payload (no schema columns).
   */
  async insertDerivedMemory(args: {
    text: string;
    hash: string;
    embedding: readonly number[];
    derivedFrom: readonly string[];
    attributedTo?: string;
    scope: { workspaceId?: string | null; userId?: string | null; sessionId?: string | null; agentId?: string | null };
  }): Promise<string> {
    const id = `derived-${String(this.rows.size)}-${Date.now()}-${String(Math.random()).slice(2, 8)}`;
    const sources=args.derivedFrom.flatMap(sourceId=>{const row=this.rows.get(sourceId);return row===undefined?[]:[row];});
    const deadlines=sources.flatMap(row=>typeof row.payload['expires_at']==='string'?[Date.parse(row.payload['expires_at'])]:[]);
    const origins=new Set<string>();
    for(const source of sources){
      const evidence=evidenceFromPayload(source.payload).evidence;
      const origin=evidence?.originSourceId??evidence?.sourceId;
      if(origin!==undefined)origins.add(origin);
      const inherited=source.payload['origin_source_ids'];
      if(typeof inherited==='string'){
        const decoded:unknown=JSON.parse(inherited);
        if(Array.isArray(decoded))for(const value of decoded)if(typeof value==='string')origins.add(value);
      }
    }
    const payload: Payload = {
      text: args.text,
      hash: args.hash,
      kind: 'derived',
      workspace_id: args.scope.workspaceId ?? 'default',
      distinct_source_count: origins.size,
      origin_source_ids: JSON.stringify([...origins]),
      ...(deadlines.length>0?{expires_at:new Date(Math.min(...deadlines)).toISOString()}:{}),
      derived_from: JSON.stringify([...args.derivedFrom]),
      ...(args.attributedTo === undefined ? {} : { attributed_to: args.attributedTo }),
    };
    if (args.scope.userId !== undefined && args.scope.userId !== null) {
      payload['user_id'] = args.scope.userId;
    }
    if (args.scope.sessionId !== undefined && args.scope.sessionId !== null) {
      payload['session_id'] = args.scope.sessionId;
    }
    if (args.scope.agentId !== undefined && args.scope.agentId !== null) {
      payload['agent_id'] = args.scope.agentId;
    }
    this.rows.set(id, { vector: args.embedding, payload, createdAt: new Date() });
    await Promise.resolve();
    return id;
  }

  /**
   * v0.6 — persist a `kind='skill'` row (parity with PgvectorStore.insertSkill).
   *
   * In-memory adapter stores all skill fields in the payload Record (no schema
   * columns). Rejects empty description / invalid codeLanguage with typed
   * InvalidSkillError BEFORE writing to the Map.
   */
  async insertSkill(args: InsertSkillArgs): Promise<string> {
    assertSkillArgs(args);
    const id = `skill-${String(this.rows.size)}-${Date.now()}-${String(Math.random()).slice(2, 8)}`;
    this.rows.set(id, {
      vector: args.embedding,
      payload: skillPayload(args, null),
      createdAt: new Date(),
    });
    await Promise.resolve();
    return id;
  }

  /**
   * v0.6 — persist a `kind='skill'` row with non-empty derived_from provenance
   * (parity with PgvectorStore.insertDerivedSkill).
   */
  async insertDerivedSkill(args: InsertDerivedSkillArgs): Promise<string> {
    assertSkillArgs(args);
    if (args.derivedFrom.length === 0) {
      throw new InvalidSkillError(
        'empty-derived-from',
        'insertDerivedSkill requires at least one source skill id',
      );
    }
    const id = `derived-skill-${String(this.rows.size)}-${Date.now()}-${String(Math.random()).slice(2, 8)}`;
    this.rows.set(id, {
      vector: args.embedding,
      payload: skillPayload(args, args.derivedFrom),
      createdAt: new Date(),
    });
    await Promise.resolve();
    return id;
  }

  /**
   * v0.6 — set `superseded_by` on every row whose id is in `sourceIds`.
   *
   * Iterates the Map and patches the payload in place. NEVER deletes rows.
   */
  async markSuperseded(
    sourceIds: readonly string[],
    supersededBy: string,
  ): Promise<void> {
    for (const id of sourceIds) {
      const row = this.rows.get(id);
      if (row !== undefined) {
        row.payload['superseded_by'] = supersededBy;
      }
    }
    await Promise.resolve();
  }

  /**
   * v0.6 — best-effort sequential `insertDerivedSkill` + `markSuperseded`.
   *
   * In-memory has no transactional semantics — if insertDerivedSkill succeeds
   * and markSuperseded throws, the derived skill row stays in the Map without
   * the sources being marked. Per plan v1.1 EC-2 absorption, this is documented
   * accepted-risk for tests/dev only; production path is always PgvectorStore.
   */
  async insertDerivedSkillAtomic(
    args: InsertDerivedSkillArgs,
    sourceIdsToSupersede: readonly string[],
  ): Promise<string> {
    const derivedId = await this.insertDerivedSkill(args);
    await this.markSuperseded(sourceIdsToSupersede, derivedId);
    return derivedId;
  }

  /**
   * skills-cross-repo-flat-list T1.1 — in-memory parity for the cross-repo
   * listing. Filters skill rows whose `agent_id` starts with `'{subject}:'` (the
   * `:` delimiter prevents a strict-prefix subject from leaking) within the
   * workspace (in-memory carries no workspace column → treated as `'default'`),
   * newest-first, with offset pagination + optional description substring filter.
   */
  async listSkillsBySubject(
    args: ListSkillsBySubjectArgs,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    const wantedPrefix = `${args.subject}:`;
    const q = args.q !== undefined && args.q.length > 0 ? args.q.toLowerCase() : undefined;
    const matching: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      const p = row.payload;
      if (p['kind'] !== 'skill') {
        continue;
      }
      const agentId = p['agent_id'];
      if (typeof agentId !== 'string' || !agentId.startsWith(wantedPrefix)) {
        continue;
      }
      if (String(p['workspace_id'] ?? 'default') !== args.workspaceId) {
        continue;
      }
      if (!args.includeSuperseded && typeof p['superseded_by'] === 'string' && p['superseded_by'].length > 0) {
        continue;
      }
      if (q !== undefined && !String(p['description'] ?? '').toLowerCase().includes(q)) {
        continue;
      }
      matching.push({ id, payload: p, createdAt: row.createdAt });
    }
    matching.sort((a, b) => {
      const dt = (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
      return dt !== 0 ? dt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    await Promise.resolve();
    return [matching.slice(args.offset, args.offset + args.limit), matching.length];
  }
}

const ALLOWED_SKILL_LANGUAGES: ReadonlySet<SkillLanguage> = new Set<SkillLanguage>([
  'typescript',
  'javascript',
]);

/**
 * Validate `insertSkill` / `insertDerivedSkill` args at the in-memory store
 * boundary — mirrors the pgvector store guard so both adapters surface
 * identical typed errors. T0.2 split: codeLanguage check accepts NULL on
 * derived skills (ADR D2).
 */
function assertSkillArgs(args: { description: string; codeLanguage: SkillLanguage | null }): void {
  if (args.description.trim().length === 0) {
    throw new InvalidSkillError(
      'empty-description',
      'description is required and must not be whitespace-only (it is the embedding target)',
    );
  }
  if (args.codeLanguage != null && !ALLOWED_SKILL_LANGUAGES.has(args.codeLanguage)) {
    throw new InvalidSkillError(
      'invalid-code-language',
      `codeLanguage must be one of [${[...ALLOWED_SKILL_LANGUAGES].join(', ')}] OR null; got ${JSON.stringify(args.codeLanguage)}`,
    );
  }
}

/** Build a Payload Record for a skill row (`derivedFrom = null` for non-derived skills). */
function skillPayload(
  args: {
    hash: string;
    code: string | null;
    description: string;
    codeLanguage: SkillLanguage | null;
    scope: { userId?: string | null; sessionId?: string | null; agentId?: string | null };
  },
  derivedFrom: readonly string[] | null,
): Payload {
  // T0.2: code + codeLanguage may be NULL on derived skills; persist as NULL,
  // not coerced to empty string (decoder distinguishes between the two states).
  const payload: Payload = {
    text: args.description,
    hash: args.hash,
    kind: 'skill',
    code: args.code,
    description: args.description,
    code_language: args.codeLanguage,
  };
  if (derivedFrom !== null) {
    payload['derived_from'] = JSON.stringify([...derivedFrom]);
  }
  if (args.scope.userId !== undefined && args.scope.userId !== null) {
    payload['user_id'] = args.scope.userId;
  }
  if (args.scope.sessionId !== undefined && args.scope.sessionId !== null) {
    payload['session_id'] = args.scope.sessionId;
  }
  if (args.scope.agentId !== undefined && args.scope.agentId !== null) {
    payload['agent_id'] = args.scope.agentId;
  }
  return payload;
}
