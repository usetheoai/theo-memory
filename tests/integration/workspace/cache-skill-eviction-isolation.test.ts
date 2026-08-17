/**
 * T3.1 — secondary-store workspace isolation (Slice 1 → 100%).
 *
 * Plan multi-tenant-rbac-and-slice1-completion § T3.1. The PRIMARY 4-verb
 * `memories` path was isolated by the parent slice (store-isolation.test.ts +
 * the goal test). This suite closes the three deferred OPT-IN secondary stores:
 *
 *   1. recall-cache — a byte-identical query under the same scope in two
 *      workspaces must NOT cross-hit (EC-8): ws-B recall returns its own
 *      (empty) result, never ws-A's cached rows.
 *   2. skill-store — a ws-A skill is invisible to a ws-B skill recall.
 *   3. eviction — a capacity-triggered eviction pass in ws-A never soft-deletes
 *      a ws-B row (the COUNT, candidate load + scoring are workspace-bound).
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { createLocalMemory, PgvectorStore } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

// extraction is bypassed via { infer: false }; reflection (unused here) expects
// a JSON array — return [] so no path invents rows.
const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<string> {
    return Promise.resolve('[]');
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ content: '[]', role: 'assistant' });
  },
};

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('secondary-store workspace isolation (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('secondary-store workspace isolation (Slice 1 100%)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      // Atravessa de propósito: o arquivo mede o isolamento das lojas
      // SECUNDÁRIAS (cache de recall, skills, eviction) — a chave do cache e o
      // filtro da varredura. Sobre o pool contido, a policy responderia por elas
      // e o teste passaria mesmo com a chave do cache voltando a ser
      // workspace-agnóstica, que é exatamente o vazamento que ele procura.
      pool = iso.crossWorkspacePool('mede o isolamento das lojas secundárias, não o da policy');
      dropDb = iso.dropDb;
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
      await pool.query(`DELETE FROM recall_cache`);
    });

    test('recall-cache: a ws-A cache entry never satisfies a ws-B lookup (EC-8)', async () => {
      const userId = `alice-${randomUUID()}`;
      const base: Memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
        recallCache: { threshold: 0.8 },
      });
      const wsA = base.withWorkspace!('ws-a');
      const wsB = base.withWorkspace!('ws-b');

      await wsA.user(userId).remember('the deploy script needs --force on tuesdays', { infer: false });

      // ws-A recall populates the cache for (ws-a, user:userId, query).
      const first = await wsA.user(userId).recall('deploy force flag', { threshold: 0 });
      expect(first.length).toBeGreaterThanOrEqual(1);

      // ws-B issues the byte-identical query under the same user. If the cache
      // key were workspace-agnostic, ws-B would HIT ws-A's cached result set and
      // leak it. With the workspace-prefixed key, ws-B misses → computes → finds
      // no ws-B rows → empty.
      const crossHit = await wsB.user(userId).recall('deploy force flag', { threshold: 0 });
      expect(crossHit).toHaveLength(0);
    });

    test('skill-store: a ws-A skill is invisible to a ws-B skill recall', async () => {
      const repoId = `repo-${randomUUID()}`;
      const base: Memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
      });
      const wsA = base.withWorkspace!('ws-a');
      const wsB = base.withWorkspace!('ws-b');

      const description = 'retry a flaky operation once';
      await wsA.skills(repoId).add({
        code: 'export const retry = (fn) => fn();',
        description,
        codeLanguage: 'typescript',
      });

      // Query verbatim so the deterministic-stub embedding match clears the
      // semantic gate (the stub is non-semantic — see the cache disclosure).
      // ws-A sees its own skill.
      const aSkills = await wsA.skills(repoId).recall(description, { threshold: 0 });
      expect(aSkills.length).toBeGreaterThanOrEqual(1);

      // ws-B (same repoId) sees nothing — skills are workspace-isolated.
      const bSkills = await wsB.skills(repoId).recall(description, { threshold: 0 });
      expect(bSkills).toHaveLength(0);
    });

    test('eviction: a capacity pass in ws-A never soft-deletes a ws-B row', async () => {
      const userId = `bob-${randomUUID()}`;
      const base: Memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
        eviction: { trigger: 'capacity', maxMemoriesPerScope: 5 },
      });
      const wsA = base.withWorkspace!('ws-a');
      const wsB = base.withWorkspace!('ws-b');

      // ws-B seeds 3 rows under userId (3 <= cap 5 → no self-eviction).
      for (let i = 0; i < 3; i++) {
        await wsB.user(userId).remember(`ws-b note number ${i}`, { infer: false });
      }
      const wsBIds = (
        await pool.query<{ id: string }>(
          `SELECT id FROM memories WHERE user_id = $1 AND workspace_id = 'ws-b'`,
          [userId],
        )
      ).rows.map((r) => r.id);
      expect(wsBIds).toHaveLength(3);

      // ws-A writes 6 rows under the SAME userId → ws-A scope count 6 > cap 5 →
      // a capacity eviction pass fires on the last write. If the COUNT/candidates
      // were workspace-agnostic, the pass would see 9 rows (ws-a + ws-b) and could
      // soft-delete a ws-B row.
      for (let i = 0; i < 6; i++) {
        await wsA.user(userId).remember(`ws-a note number ${i}`, { infer: false });
      }

      // EVERY ws-B row is still alive — eviction stayed inside ws-A.
      const wsBAlive = await pool.query<{ alive: boolean }>(
        `SELECT bool_and(t_invalid IS NULL) AS alive
           FROM memories WHERE id = ANY($1::uuid[])`,
        [wsBIds],
      );
      expect(wsBAlive.rows[0]?.alive).toBe(true);

      // ws-A actually evicted (proves the pass ran, not a no-op) — at least one
      // ws-A row is soft-deleted.
      const wsAEvicted = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM memories WHERE user_id = $1 AND workspace_id = 'ws-a' AND t_invalid IS NOT NULL`,
        [userId],
      );
      expect(Number(wsAEvicted.rows[0]?.n ?? '0')).toBeGreaterThanOrEqual(1);
    });
  });
}
