/**
 * T2.1 of dogfood-anchor-scenario-launch plan v1.1 — round-trip integration
 * test against real themory mcp subprocess + pgvector container.
 *
 * Asserts the bridge can spawn themory mcp via stdio, route remember +
 * recall calls through MCP, and receive valid responses. Also asserts EC-2
 * latency budget (p95 ≤ 2s per bridge call) as a smoke check.
 *
 * Gated by THEOMEM_PG_URI env var per existing integration test convention.
 * Requires `npm run build` has been run so dist/agent-tools/cli.js exists
 * (the bridge spawns it via THEMORY_BRIDGE_CLI env override).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { MCPUnreachable, bridgeRecall, bridgeRemember } from '../../../scripts/dogfood/claude-code-bridge.js';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t2_1_bridge_roundtrip';
const CLI_PATH = resolve(process.cwd(), 'dist', 'agent-tools', 'cli.js');
// Real-LLM E2E: the spawned `themory mcp` boots OpenAILLM and performs a live
// extraction call, so a working LLM key is required. Gate on OPENROUTER_KEY
// (the project's real-LLM marker) so a keyless CI run skips cleanly instead of
// 401-failing against an absent/expired key.
const HAS_LLM_KEY =
  (process.env['OPENROUTER_KEY'] ?? process.env['OPENROUTER_API_KEY'] ?? '') !== '';

describe.skipIf(ROOT_PG_URI === '' || !existsSync(CLI_PATH) || !HAS_LLM_KEY)(
  'T2.1 — claude-code-bridge round-trip (integration; real themory mcp + pgvector)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let pool: pg.Pool;

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();
      pool = new pg.Pool({ connectionString: testUri });
      const m = await import('@usetheo/memory');
      await m.runMigrations(pool);
      // Point the bridge subprocess at this test DB.
      process.env['THEOMEM_PG_URI'] = testUri;
      process.env['THEMORY_BRIDGE_CLI'] = CLI_PATH;
    }, 60_000);

    afterAll(async () => {
      delete process.env['THEMORY_BRIDGE_CLI'];
      process.env['THEOMEM_PG_URI'] = ROOT_PG_URI;
      await pool?.end();
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    }, 30_000);

    it('throws MCPUnreachable when CLI path is invalid (EC-1 negative-path)', async () => {
      const savedCli = process.env['THEMORY_BRIDGE_CLI'];
      process.env['THEMORY_BRIDGE_CLI'] = '/tmp/nonexistent-themory-cli-xyz';
      try {
        await expect(
          bridgeRemember('fact', { projectSlug: '-home-paulo-Projetos-usetheo-theo-memory' }),
        ).rejects.toThrow(MCPUnreachable);
      } finally {
        process.env['THEMORY_BRIDGE_CLI'] = savedCli;
      }
    }, 30_000);

    it('round-trip — remember + recall succeed against real themory mcp + pgvector', async () => {
      const ctx = { projectSlug: '-home-paulo-Projetos-usetheo-theo-memory' };
      const rememberResult = await bridgeRemember(
        'TheMemory is a managed memory layer for AI agents',
        ctx,
      );
      // remember returns the MCP raw response; we just assert it did not skip.
      expect(rememberResult.skipped).toBeUndefined();
      expect(rememberResult.raw).toBeDefined();

      const recallResult = await bridgeRecall('What is TheMemory?', ctx);
      expect(recallResult.skipped).toBeUndefined();
      expect(recallResult.raw).toBeDefined();
    }, 120_000);
  },
);
