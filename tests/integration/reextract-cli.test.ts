/**
 * M13 T3.2 — `themory reextract` CLI verb E2E (spawn against dist).
 *
 * Requires `npm run build` (dist/agent-tools/cli.js) — SKIPs when absent,
 * mirroring the verbs-cli precedent. The dry-run case needs THEOMEM_PG_URI
 * (seeds 3 targets); it must NOT require OPENAI_API_KEY (dry-run never
 * touches the LLM). TRUNCATEs shared tables — run sequentially.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { runMigrations } from '@usetheo/memory';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
const DIST_EXISTS = existsSync(CLI_PATH);
const PG_URI = process.env['THEOMEM_PG_URI'];
const ZERO_VEC = `[${new Array(1536).fill(0).join(',')}]`;

interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], env: Record<string, string | undefined>): SpawnResult {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: env as NodeJS.ProcessEnv,
    cwd: REPO_ROOT,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

if (PG_URI === undefined || PG_URI === '' || !DIST_EXISTS) {
  describe.skip('reextract CLI (THEOMEM_PG_URI or dist missing)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 2 });

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges RESTART IDENTITY CASCADE');
  });

  describe('themory reextract (T3.2)', () => {
    test('test_cli_reextract_dry_run_reports_targets_and_exits_zero', async () => {
      // Given 3 graphless target memories
      for (let i = 0; i < 3; i += 1) {
        await pool.query(
          `INSERT INTO memories (text, hash, embedding, payload, workspace_id, user_id)
           VALUES ($1,$2,$3::vector,'{}'::jsonb,'ws1','alice')`,
          [`target memory number ${String(i)} with enough text`, randomUUID(), ZERO_VEC],
        );
      }
      // When: dry-run WITHOUT any OPENAI_API_KEY (dry-run never calls the LLM)
      const res = runCli(['reextract', '--dry-run', '--json'], {
        PATH: process.env['PATH'],
        THEOMEM_PG_URI: PG_URI,
      });
      // Then
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout) as { targets: number; llmCalls: number; estTokens: number };
      expect(parsed.targets).toBe(3);
      expect(parsed.llmCalls).toBe(0);
      expect(parsed.estTokens).toBeGreaterThan(0);
    });

    test('test_cli_reextract_missing_env_exits_2', () => {
      const res = runCli(['reextract', '--dry-run'], { PATH: process.env['PATH'] });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('THEOMEM_PG_URI');
    });

    test('test_cli_retire_requires_explicit_commit', () => {
      // --commit without --retire-mechanism → usage error, exit 2 (#252 discipline)
      const stray = runCli(['reextract', '--commit'], { PATH: process.env['PATH'], THEOMEM_PG_URI: PG_URI });
      expect(stray.status).toBe(2);
      expect(stray.stderr).toContain('--retire-mechanism');
      // /review F-dom-cli-1: contradictory --dry-run + --commit → fail closed, exit 2
      const contradictory = runCli(['reextract', '--retire-mechanism', '--commit', '--dry-run'], { PATH: process.env['PATH'], THEOMEM_PG_URI: PG_URI });
      expect(contradictory.status).toBe(2);
      expect(contradictory.stderr).toContain('contradictory');
      // --retire-mechanism without --commit → DRY-RUN report, zero writes
      const dry = runCli(['reextract', '--retire-mechanism', '--json'], { PATH: process.env['PATH'], THEOMEM_PG_URI: PG_URI });
      expect(dry.status).toBe(0);
      const parsed = JSON.parse(dry.stdout) as { dryRun: boolean; retired: number };
      expect(parsed.dryRun).toBe(true);
      expect(parsed.retired).toBe(0);
    });

    test('test_cli_reextract_help_lists_flags', () => {
      const res = runCli(['reextract', '--help'], { PATH: process.env['PATH'] });
      expect(res.status).toBe(0);
      for (const flag of ['--dry-run', '--resume', '--limit', '--concurrency']) {
        expect(res.stdout).toContain(flag);
      }
    });
  });
}
