/**
 * Map-backed VectorStore — T3.2 of v0-1-local-runtime plan v1.3.
 *
 * Pure-JS implementation of the VectorStore DIP. Zero I/O, zero deps.
 * Purpose:
 *  - Unit-test fixture for extraction + retrieval pipelines (Mem0 mockEmbedding pattern)
 *  - Dev quickstart for consumers experimenting without spinning up Postgres
 *  - Reference implementation that any other adapter is compared against
 *
 * Scoring: cosine similarity computed by dot product (assumes unit vectors when
 * possible; falls back to full cosine for non-normalized input).
 *
 * Filter semantics: ANDed across user_id / session_id / agent_id. Missing keys
 * in the Filters object are skipped (NOT filtered to NULL — passes-through).
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T3.2
 * @see blueprint Recommendation 6 + ADR D6
 */
import type { VectorStore, VectorStoreResult } from '../core/dip/vector-store.js';
import type { Filters } from '../core/scope.js';

type Payload = Record<string, string | number | boolean | null>;

interface StoredRow {
  readonly vector: readonly number[];
  readonly payload: Payload;
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

function matchesFilters(payload: Payload, filters: Filters | undefined): boolean {
  if (filters === undefined) {
    return true;
  }
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) {
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
  ): Promise<void> {
    if (vectors.length !== ids.length || vectors.length !== payloads.length) {
      throw new Error('insert: vectors, ids, and payloads must have equal length');
    }
    for (let i = 0; i < vectors.length; i += 1) {
      const id = ids[i] as string;
      const vector = vectors[i] as readonly number[];
      const payload = payloads[i] as Payload;
      this.rows.set(id, { vector, payload });
    }
    await Promise.resolve();
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
  ): Promise<readonly VectorStoreResult[] | null> {
    const queryTokens = new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 0));
    if (queryTokens.size === 0) {
      return [];
    }
    const candidates: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (!matchesFilters(row.payload, filters)) {
        continue;
      }
      const text = String(row.payload['text'] ?? '');
      const tokens = text.toLowerCase().split(/\W+/);
      let overlap = 0;
      for (const tok of tokens) {
        if (queryTokens.has(tok)) {
          overlap += 1;
        }
      }
      if (overlap > 0) {
        candidates.push({ id, payload: row.payload, score: overlap });
      }
    }
    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    await Promise.resolve();
    return candidates.slice(0, topK);
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const row = this.rows.get(vectorId);
    await Promise.resolve();
    if (row === undefined) {
      return null;
    }
    return { id: vectorId, payload: row.payload };
  }

  async update(vectorId: string, vector: readonly number[], payload: Payload): Promise<void> {
    this.rows.set(vectorId, { vector, payload });
    await Promise.resolve();
  }

  async delete(vectorId: string): Promise<void> {
    this.rows.delete(vectorId);
    await Promise.resolve();
  }

  async deleteCol(): Promise<void> {
    this.rows.clear();
    await Promise.resolve();
  }

  async list(
    filters?: Filters,
    topK = 100,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    const matching: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (!matchesFilters(row.payload, filters)) {
        continue;
      }
      matching.push({ id, payload: row.payload });
    }
    await Promise.resolve();
    return [matching.slice(0, topK), matching.length];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getUserId(): Promise<string> {
    return this.currentUserId;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async setUserId(userId: string): Promise<void> {
    this.currentUserId = userId;
  }
}
