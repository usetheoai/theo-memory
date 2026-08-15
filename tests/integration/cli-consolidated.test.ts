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
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createIsolatedDb } from './_helpers/isolated-db.js';

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
      // killAfterMs is a SAFETY NET for a genuine hang, NOT the expected path:
      // the CLI exits(2) on its own in <1s once the dist module graph loads.
      // A generous 20s ceiling absorbs cold-boot variance on a loaded CI box
      // (parallel Node processes) so the SIGTERM never fires prematurely and
      // truncates stderr to '' — the flake this replaces. Happy path unaffected.
      const result = await spawnCli(aliasBin, { THEOMEM_PG_URI: '' }, 20_000);

      expect(result.stderr).toMatch(/DEPRECATED/i);
      expect(result.stderr).toMatch(/themory[- ]mcp/i);
      expect(result.stderr).toMatch(/themory mcp/);
    }, 30_000);

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
      // message containing the example postgres:// URI. killAfterMs is a
      // SAFETY NET for a genuine hang, NOT the expected path: the EC-7 guard
      // fires and exit(2)s in <1s once the dist module graph loads. A generous
      // 20s ceiling absorbs cold-boot variance on a loaded CI box so the
      // SIGTERM never truncates stderr to '' (the flake this replaces).
      const result = await spawnCli(aliasBin, { THEOMEM_PG_URI: '' }, 20_000);

      // EC-7 hard-fail evidence — proves runMcpServer was invoked, NOT a
      // not-implemented stub (which would write "not yet implemented").
      expect(result.stderr).toContain('THEOMEM_PG_URI');
      expect(result.stderr).toMatch(/postgres:\/\//);
      expect(result.stderr).not.toMatch(/not yet implemented/);
      expect(result.exitCode).toBe(2);
    }, 30_000);
  },
);

// T2.3 — `themory server` subcommand child-process tests.
// Gates: dist build present AND THEOMEM_PG_URI configured (real pg pool).
const HAS_PG_URI =
  process.env['THEOMEM_PG_URI'] !== undefined && process.env['THEOMEM_PG_URI'] !== '';

describe.skipIf(!existsSync(CLI_DIST) || !HAS_PG_URI)(
  'T2.3 — themory server subcommand (real pg)',
  () => {
    // Track child processes so afterAll can kill any leak.
    const activeChildren: import('node:child_process').ChildProcess[] = [];

    // Isolated DB: `themory server` boot runs runMigrations({ embeddingDim: 384 })
    // (run-server.ts), which would migrate the SHARED db to 384 and break every
    // 1536-dim test that runs later. Point the spawned server at its own DB.
    // MIGRA pelo papel de setup (DDL), ATENDE pelo papel contido. É a separação
    // que produção exige, e o guard de boot recusa superusuário — apontar o
    // servidor para o pool de setup faria o boot ser recusado e o teste falharia
    // com `listen timeout`, sem dizer por quê.
    let setupUri = '';
    let appUri = '';
    let dropIso: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      const iso = await createIsolatedDb();
      setupUri = iso.setupUri;
      appUri = iso.uri;
      dropIso = iso.dropDb;
      // O papel e seus privilégios vêm do harness: `themory_app` é provisionado
      // pelo global-setup antes do template ser migrado, então o clone já chega
      // com os GRANTs da 0032. Nada a criar aqui.
    });

    function spawnServer(
      args: readonly string[],
      env: NodeJS.ProcessEnv,
    ): import('node:child_process').ChildProcess {
      // T3.2 / EC-2 — run-server.ts hard-fails when OPENAI_API_KEY is unset
      // (mirror of commit e43d801 MCP fix). These boot-shape tests don't
      // exercise LLM calls, so a fake key is sufficient for the spawn to
      // reach the listening state.
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? 'sk-fake-test-key-for-boot',
        // Atende pelo papel contido; MIGRA pelo dono. É a separação que produção
        // exige — o papel de aplicação não tem DDL, por desenho.
        THEOMEM_PG_URI: appUri,
        THEOMEM_MIGRATE_PG_URI: setupUri,
        ...env,
      };
      const child = spawn(process.execPath, [CLI_DIST, 'server', ...args], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      activeChildren.push(child);
      return child;
    }

    afterAll(async () => {
      for (const child of activeChildren) {
        if (!child.killed) child.kill('SIGKILL');
      }
      if (dropIso) await dropIso();
    });

    test('39. SIGTERM closes server with exit 0 (EC-32)', async () => {
      const child = spawnServer(['--port', '18380', '--host', '127.0.0.1'], {});
      // Wait for stdout `listening` line that signals serve() bound.
      await new Promise<void>((resolveReady, rejectReady) => {
        const timer = setTimeout(() => rejectReady(new Error('listen timeout')), 10_000);
        child.stdout?.on('data', (chunk: Buffer) => {
          if (chunk.toString('utf-8').includes('listening')) {
            clearTimeout(timer);
            resolveReady();
          }
        });
      });

      const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolveExit) => {
          child.on('close', (code, signal) => resolveExit({ code, signal }));
        },
      );
      child.kill('SIGTERM');
      const { code, signal } = await exit;
      expect(signal).toBeNull();
      expect(code).toBe(0);
    }, 15_000);

    test('41. themory migrate applies pending migrations; second invocation is no-op (EC-36)', async () => {
      // Fresh isolated DB so the first invocation has work to do AND the
      // DROP/migrate never touches the shared DB. This test was the suite's
      // root schema-state polluter (it dropped consolidation_history +
      // reflection_counters + __drizzle_migrations on the SHARED db, breaking
      // every later test that assumed the schema) — integration-suite-stabilization.
      const { createIsolatedDb } = await import('./_helpers/isolated-db.js');
      // `themory migrate` é DDL: roda pelo papel de setup, como em produção. O
      // papel de aplicação não tem DDL por desenho, e apontar a migrate para ele
      // falha com `must be owner of …`.
      const { setupUri, dropDb } = await createIsolatedDb({ fresh: true });
      try {
        const runOnce = async (): Promise<{ exitCode: number | null; stdout: string }> => {
          const child = spawn(process.execPath, [CLI_DIST, 'migrate'], {
            env: { ...process.env, THEOMEM_PG_URI: setupUri },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stdout = '';
          child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
          });
          const code = await new Promise<number | null>((resolveExit) => {
            child.on('close', (c) => resolveExit(c));
          });
          return { exitCode: code, stdout };
        };

        const first = await runOnce();
        const second = await runOnce();

        expect(first.exitCode).toBe(0);
        expect(second.exitCode).toBe(0);
        expect(first.stdout).toMatch(/applied/i);
        // Second invocation must succeed and not crash on duplicate-table errors.
        expect(second.stdout).toMatch(/applied/i);
      } finally {
        await dropDb();
      }
    }, 30_000);

    test('40. EADDRINUSE — second server on busy port exits 1 with clear stderr (EC-31)', async () => {
      // Reserve a port using a listening socket; spawn the CLI against that
      // exact port; expect serve() to surface EADDRINUSE.
      const sentinel = createNetServer();
      const port: number = await new Promise<number>((resolveListen) => {
        sentinel.listen(0, '127.0.0.1', () => {
          const addr = sentinel.address();
          if (addr === null || typeof addr === 'string') throw new Error('no address');
          resolveListen(addr.port);
        });
      });
      try {
        const child = spawnServer(['--port', String(port), '--host', '127.0.0.1'], {});
        const result: { stderr: string; code: number | null } = await new Promise(
          (resolveExit) => {
            let stderr = '';
            child.stderr?.on('data', (chunk: Buffer) => {
              stderr += chunk.toString('utf-8');
            });
            child.on('close', (code) => resolveExit({ stderr, code }));
            // integration-suite-stabilization (flaky-timing fix): the internal
            // SIGKILL guard was 8_000ms, which under full-suite load is shorter
            // than the CLI cold-start (node + dotenvx env injection) + eager
            // bind + EADDRINUSE-exit cycle — the process was correctly exiting 1
            // but got SIGKILL'd first, yielding `code === null` (observed
            // 8089ms in-suite; passes cleanly in isolation). Raised below the
            // test's own timeout so a genuine HANG (no exit at all) is still
            // caught as `null !== 1`.
            setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL');
            }, 13_000);
          },
        );
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(new RegExp(`Port\\s+${String(port)}\\s+already in use`, 'i'));
      } finally {
        await new Promise<void>((resolveClose) => sentinel.close(() => resolveClose()));
      }
    }, 20_000);
  },
);
