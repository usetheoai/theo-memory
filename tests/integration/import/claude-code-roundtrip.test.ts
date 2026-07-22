/**
 * M12 T3.1 — THE GOAL TEST: `themory import claude-code` idempotent round-trip on real pgvector.
 *
 * A temp Claude-Code-shaped source (3 memory nodes, 1 secret-bearing) is imported (`--commit`)
 * against a real `createServer` app backed by ankane/pgvector:
 *   (1) 3 imported; the secret-bearing node is stored REDACTED (the secret never reaches the DB);
 *   (2) re-running the exact import reports deduped==3 / imported==0 and the row count is unchanged
 *       (the REDACTED-pattern idempotency assertion on our real boundary — blueprint Corner 1).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import type { AddressInfo } from 'node:net';

import { createLocalMemory, PgvectorStore, StubEmbedder } from '@usetheo/memory';
import type { LLM, Memory, Message } from '@usetheo/memory/contract';
import { createServer } from '@usetheo/memory-api';
import { serve } from '@hono/node-server';

import { planMigration, importBatch } from '../../../packages/cli/src/import/migrate-claude-code.mjs';
import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const emptyLlm: LLM = {
  generateResponse: () => Promise.resolve([]),
  generateChat: (_m: readonly Message[]) => Promise.resolve({ role: 'assistant' as const, content: '[]' }),
};

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('M12 import round-trip (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('M12 T3.1 — themory import claude-code idempotent round-trip (real pgvector)', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;
    let memory: Memory;
    let server: ReturnType<typeof serve>;
    let endpoint: string;
    let sourceRoot: string;
    const SECRET = 'theo_live_LEAKtest0123456789abcdefghijklmn';

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.pool;
      dropDb = iso.dropDb;
      memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder: new StubEmbedder(), llm: emptyLlm });
      const app = createServer({ memory });
      server = serve({ fetch: app.fetch, port: 0 });
      const addr = server.address() as AddressInfo;
      endpoint = `http://127.0.0.1:${addr.port}`;

      // Claude-Code-shaped source: <root>/<project-slug>/memory/*.md
      sourceRoot = mkdtempSync(join(tmpdir(), 'm12-src-'));
      const memDir = join(sourceRoot, 'proj-a', 'memory');
      mkdirSync(memDir, { recursive: true });
      const fm = (name: string, body: string): string =>
        `---\nname: ${name}\ndescription: ${name} note\nmetadata:\n  type: project\n---\n\n${body}\n`;
      // Plain-word bodies: the scrub treats long random tokens (incl. UUIDs) as suspected secrets,
      // so fixture text must be prose. The secret note's body is long enough that the ONE real
      // secret stays under the secret-dominated ratio → imported WITH redaction (the target case).
      writeFileSync(join(memDir, 'note-one.md'), fm('note-one', 'the user prefers dark roast coffee over light roast every single morning'));
      writeFileSync(join(memDir, 'note-two.md'), fm('note-two', 'the staging environment deploys automatically after the integration suite passes'));
      writeFileSync(
        join(memDir, 'note-secret.md'),
        fm(
          'note-secret',
          `the deploy pipeline authenticates with the token ${SECRET} which the operator rotates monthly; keep the rotation calendar entry up to date and never paste this value into chat logs or dashboards`,
        ),
      );
    }, 30_000);

    afterAll(async () => {
      server?.close();
      await memory.dispose();
      await dropDb();
      rmSync(sourceRoot, { recursive: true, force: true });
    });

    test('test_import_roundtrip_idempotent_and_scrubbed', async () => {
      const plan = planMigration(sourceRoot) as { items: unknown[]; report: { scanned: number; redacted: number } };
      expect(plan.report.scanned).toBe(3);
      expect(plan.items).toHaveLength(3);
      expect(plan.report.redacted).toBe(1); // the secret-bearing node
      const items = plan.items;

      // First commit: 3 imported.
      const first = await importBatch(items, { endpoint });
      expect(first.imported).toBe(3);
      expect(first.failed).toBe(0);

      // The secret NEVER reached the DB — stored text carries the redaction marker.
      const { rows } = await pool.query<{ text: string }>(`SELECT text FROM memories`);
      expect(rows).toHaveLength(3);
      const stored = rows.map((r) => r.text).join('\n');
      expect(stored).not.toContain(SECRET);
      expect(stored).toContain('[REDACTED:');

      // Second commit of the SAME items: idempotent — all deduped, zero new rows.
      const second = await importBatch(items, { endpoint });
      expect(second.imported).toBe(0);
      expect(second.deduped).toBe(3);
      const { rows: after } = await pool.query(`SELECT count(*)::int AS n FROM memories`);
      expect((after[0] as { n: number }).n).toBe(3);
    });
  });
}
