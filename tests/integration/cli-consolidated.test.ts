/**
 * T2.1 integration — themory CLI consolidado: alias deprecation warning +
 * v0.3 regression (themory-mcp still boots the MCP server with the same
 * stdio transport behavior as before).
 *
 * Both tests spawn the built `dist/agent-tools/cli.js` as a child process so
 * the real bin entry exercises EC-27 alias detection through the actual
 * argv shape Node delivers (process.argv[1] = path to cli.js OR npm-linked
 * symlink). Tests gate on the build artifact's presence — `describe.skipIf`
 * keeps the suite green on fresh checkouts that haven't run `npm run build`.
 *
 * @see Plan theo-memory-standalone-p0 § T2.1 + EC-27 + EC-28
 * @see v0.3 e2e regression — tests/e2e/agent-tools/round-trip.test.ts
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const CLI_DIST = resolve(REPO_ROOT, 'dist/agent-tools/cli.js');

interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

function spawnCli(binPath: string, env: NodeJS.ProcessEnv, killAfterMs: number): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolveSpawn) => {
    const child = spawn(process.execPath, [binPath], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, killAfterMs);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolveSpawn({ stdout, stderr, exitCode, signal });
    });
  });
}

describe.skipIf(!existsSync(CLI_DIST))(
  'T2.1 integration — CLI consolidado',
  () => {
    test('37. themory-mcp alias emits DEPRECATED warning to stderr', async () => {
      // Symlink dist/agent-tools/cli.js as `themory-mcp` so process.argv[1]
      // matches the alias regex when Node invokes it. Bare `node cli.js`
      // would not exercise EC-27.
      const tmpDir = mkdtempSync(join(tmpdir(), 'themory-cli-alias-'));
      const aliasBin = join(tmpDir, 'themory-mcp');
      symlinkSync(CLI_DIST, aliasBin);

      // No THEOMEM_PG_URI → runMcpServer will exit(2) quickly after the
      // deprecation warning fires. We only assert the warning landed.
      const result = await spawnCli(aliasBin, { THEOMEM_PG_URI: '' }, 5_000);

      expect(result.stderr).toMatch(/DEPRECATED/i);
      expect(result.stderr).toMatch(/themory[- ]mcp/i);
      expect(result.stderr).toMatch(/themory mcp/);
    }, 10_000);

    test('38. themory-mcp alias still runs MCP server bootstrap (v0.3 regression)', async () => {
      // Same alias path, this time with a clearly-invalid pg URI so the
      // bootstrap reaches createLocalMemory → pg.Pool.connect and surfaces
      // an error. We assert the MCP code path executed (EC-7 stderr token)
      // rather than the no-impl stub stderr that `server`/`migrate`/`health`
      // would produce.
      const tmpDir = mkdtempSync(join(tmpdir(), 'themory-cli-regress-'));
      const aliasBin = join(tmpDir, 'themory-mcp');
      symlinkSync(CLI_DIST, aliasBin);

      // Empty THEOMEM_PG_URI → runMcpServer EC-7 path: exit(2) + stderr
      // message containing the example postgres:// URI.
      const result = await spawnCli(aliasBin, { THEOMEM_PG_URI: '' }, 5_000);

      // EC-7 hard-fail evidence — proves runMcpServer was invoked, NOT a
      // not-implemented stub (which would write "not yet implemented").
      expect(result.stderr).toContain('THEOMEM_PG_URI');
      expect(result.stderr).toMatch(/postgres:\/\//);
      expect(result.stderr).not.toMatch(/not yet implemented/);
      expect(result.exitCode).toBe(2);
    }, 10_000);
  },
);
