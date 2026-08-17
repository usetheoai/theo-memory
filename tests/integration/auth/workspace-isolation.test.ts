/**
 * THE GOAL TEST — multi-tenant-workspace-isolation § T3.1.
 *
 * Exercises the end-to-end isolation property through the Memory.withWorkspace
 * seam the REST handlers use: a workspace-bound memory only ever reads/writes
 * its own workspace's rows, and a cross-workspace forget is a 404 (WorkspaceMismatch)
 * that never touches the other workspace's row (EC-5 / ADR D6).
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { createLocalMemory, LastWriteWinsConflictPolicy, PgvectorStore, WorkspaceMismatch } from '@usetheo/memory';
import { DeterministicStubEmbedder } from '@usetheo/memory/embedders/stub';
import type { LLM, LLMResponse, Memory, Message } from '@usetheo/memory';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

// Stub LLM: extraction is bypassed by { infer: false }; the reflection path
// expects a JSON ARRAY of drafts — return an empty array (0 drafts) so the
// consolidation pipeline still runs (the LWW policy operates on the workspace-
// filtered candidate set) without inventing derived rows.
const emptyJsonLlm: LLM = {
  async generateResponse(): Promise<string> {
    return Promise.resolve('[]');
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ content: '[]', role: 'assistant' });
  },
};

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('workspace isolation GOAL TEST (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('THE GOAL TEST — workspace isolation (IDOR matrix)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let base: Memory;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.crossWorkspacePool('mede o isolamento aplicado pelo servidor entre dois workspaces');
      dropDb = iso.dropDb;
      base = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new DeterministicStubEmbedder(),
        llm: emptyJsonLlm,
      });
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories`);
    });

    test('cross-workspace recall is empty; create derives workspace from the binding', async () => {
      const userId = `alice-${randomUUID()}`;
      const wsA = base.withWorkspace!('ws-a');
      const wsB = base.withWorkspace!('ws-b');

      // ws-A writes (workspace derived from the binding, NOT a body field).
      await wsA.user(userId).remember('the launch code is hunter2', { infer: false });

      // The persisted row carries workspace_id = 'ws-a'.
      const { rows } = await pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM memories WHERE user_id = $1`,
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.workspace_id).toBe('ws-a');

      // ws-B recall for the same user + query → EMPTY (no cross-workspace leak).
      const bResults = await wsB.user(userId).recall('launch code', { threshold: 0 });
      expect(bResults).toHaveLength(0);

      // ws-A recall → sees its own row.
      const aResults = await wsA.user(userId).recall('launch code', { threshold: 0 });
      expect(aResults.length).toBeGreaterThanOrEqual(1);
    });

    test('cross-workspace forget is a 404 (WorkspaceMismatch) and never touches the other workspace row (EC-5)', async () => {
      const userId = `bob-${randomUUID()}`;
      const wsA = base.withWorkspace!('ws-a');
      const wsB = base.withWorkspace!('ws-b');

      await wsA.user(userId).remember('ws-a private note', { infer: false });
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM memories WHERE user_id = $1 AND workspace_id = 'ws-a'`,
        [userId],
      );
      const wsAId = rows[0]?.id;
      expect(wsAId).toBeDefined();

      // ws-B tries to forget ws-A's id → WorkspaceMismatch (→ 404 at the handler).
      await expect(wsB.forget(wsAId as string)).rejects.toBeInstanceOf(WorkspaceMismatch);

      // ws-A's row is UNTOUCHED (still valid — not soft-deleted).
      const after = await pool.query<{ alive: boolean }>(
        `SELECT t_invalid IS NULL AS alive FROM memories WHERE id = $1`,
        [wsAId],
      );
      expect(after.rows[0]?.alive).toBe(true);
    });

    test('forget WITHIN the workspace succeeds (control)', async () => {
      const userId = `carol-${randomUUID()}`;
      const wsA = base.withWorkspace!('ws-a');
      await wsA.user(userId).remember('forgettable', { infer: false });
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM memories WHERE user_id = $1`,
        [userId],
      );
      const id = rows[0]?.id;
      await expect(wsA.forget(id as string)).resolves.toBeUndefined();
    });

    test('reflect() in ws-A never reads or soft-deletes ws-B rows (/review F-dom-api-1/2 CRITICAL)', async () => {
      const userId = `dave-${randomUUID()}`;
      const wsA = base.withWorkspace!('ws-a');
      const wsB = base.withWorkspace!('ws-b');

      // Both workspaces seed an extracted memory under the same user/tier.
      await wsA.user(userId).remember('ws-a coffee preference', { infer: false });
      await wsB.user(userId).remember('ws-b coffee preference', { infer: false });

      const wsBIdRow = await pool.query<{ id: string }>(
        `SELECT id FROM memories WHERE user_id = $1 AND workspace_id = 'ws-b'`,
        [userId],
      );
      const wsBId = wsBIdRow.rows[0]?.id;
      expect(wsBId).toBeDefined();

      // ws-A reflects with a LWW consolidation policy. If the consolidation
      // candidate query leaked across workspaces, ws-B's row would enter the
      // merge and could be soft-deleted as "rejected".
      await wsA.user(userId).reflect({ conflictResolution: new LastWriteWinsConflictPolicy() });

      // ws-B's row is UNTOUCHED — never read into ws-A's consolidation, never
      // soft-deleted (cross-workspace read + destructive IDOR closed).
      const wsBAfter = await pool.query<{ alive: boolean }>(
        `SELECT t_invalid IS NULL AS alive FROM memories WHERE id = $1`,
        [wsBId],
      );
      expect(wsBAfter.rows[0]?.alive).toBe(true);

      // Any reflect-derived row stays in ws-A (not mis-tenanted to 'default').
      const derived = await pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM memories WHERE user_id = $1 AND kind = 'derived'`,
        [userId],
      );
      for (const row of derived.rows) {
        expect(row.workspace_id).toBe('ws-a');
      }
    });
  });
}
