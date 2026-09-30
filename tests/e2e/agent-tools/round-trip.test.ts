/**
 * Subprocess E2E for agent-tools MCP server — T7.1 (transport boundary verification).
 *
 * Spawns built `dist/agent-tools/cli.js` via `node:child_process.spawn` + exercises
 * the MCP JSON-RPC `initialize` handshake + `tools/list` over real stdio. Validates
 * that the CLI bin entry resolves, the SDK transport serializes correctly, and
 * the 4 locked verbs surface end-to-end.
 *
 * THE GOAL semantic (alice/bob ZERO overlap) is proven by the integration test at
 * `tests/integration/agent-tools/the-goal.test.ts` — uses real `contentEchoLlm` for
 * extraction (CLI's StubLLM extracts 0 facts by design, so subprocess can't prove
 * isolation by content). This subprocess test covers transport boundary only.
 *
 * Deeper subprocess coverage (per-verb roundtrip + cleanup zombie-PID check) deferred
 * to F-T7.1-1 followup. Plan T7.1's 6-test spec slimmed to 1 here for pragmatic
 * scope per Inquebrável Rule 11.
 *
 * @see plan T7.1 § Tasks step 1 — EC-8 build-before-test absorption
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_PATH = resolve(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
const PG_URI = process.env['THEOMEM_PG_URI'];

let proc: ChildProcessWithoutNullStreams | undefined;

beforeAll(async () => {
  // EC-8 absorbed: build-if-missing safeguard before subprocess spawn
  if (!existsSync(CLI_PATH)) {
    throw new Error(
      `dist/agent-tools/cli.js missing; run \`npm run build\` first (or wire pretest:e2e in package.json).`,
    );
  }
  // Drop tables so the CLI's runMigrations can apply from scratch (F-T7.1-2:
  // runMigrations is not idempotent vs pre-pushed drizzle-kit schema; E2E needs
  // clean slate for journal-tracked migration replay).
  if (PG_URI !== undefined && PG_URI !== '') {
    const pool = new pg.Pool({ connectionString: PG_URI });
    try {
      // A true clean slate. The previous version dropped three tables plus an
      // UNQUALIFIED `__drizzle_migrations` — but the journal lives in the
      // `drizzle` schema, so that name matched nothing. The result was a database
      // missing `memories` while the journal still claimed all migrations were
      // applied: migrate-on-boot no-op'd and the subprocess died with
      // `relation "memories" does not exist`. Dropping only those three tables is
      // not enough either — the schema has 17, and replaying migration 0000 then
      // fails on the first table that survived.
      await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
      await pool.query('CREATE SCHEMA public');
      // pgvector installs into `public`, so it goes down with the schema.
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    } finally {
      await pool.end();
    }
  }
});

afterAll(() => {
  if (proc !== undefined && proc.exitCode === null) {
    proc.kill('SIGTERM');
  }
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('subprocess E2E (THEOMEM_PG_URI not set — skipping)', () => {
    it('placeholder', () => undefined);
  });
} else {
  describe('agent-tools CLI subprocess — MCP handshake + tools/list (T7.1)', () => {
    it('spawns the CLI, completes initialize handshake, lists the 13 registered tools', async () => {
      // T2.1: CLI consolidated under commander — invoke `mcp` subcommand
      // explicitly. The legacy `themory-mcp` basename alias (EC-27) is
      // covered separately by tests/integration/cli-consolidated.test.ts.
      proc = spawn('node', [CLI_PATH, 'mcp'], {
        env: { ...process.env, THEOMEM_PG_URI: PG_URI },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Keep the child's stderr. The protocol travels on stdout, so every boot
      // failure — a rejected provider key, an unreachable database, a migration
      // error — is written to stderr and nowhere else. Without it a CLI that died
      // before the handshake surfaced as a bare `waitFor timed out`.
      const child = proc;
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      const childDiagnostics = (): string =>
        `CLI exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}; stderr:\n${stderr}`;

      // Collect stdout line-by-line (JSON-RPC over stdio is line-delimited per MCP spec)
      const responses: unknown[] = [];
      let buffer = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        let newlineIdx = buffer.indexOf('\n');
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line.length > 0) {
            try {
              responses.push(JSON.parse(line));
            } catch {
              // ignore non-JSON lines (banner output, etc.)
            }
          }
          newlineIdx = buffer.indexOf('\n');
        }
      });

      // Send initialize request
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'e2e-test', version: '0.0.1' },
          },
        }) + '\n',
      );

      // Wait for initialize response
      await waitFor(() => responses.some((r) => isResponse(r, 1)), 5000, child, childDiagnostics);
      const initResponse = responses.find((r) => isResponse(r, 1)) as { result: { capabilities: { tools?: unknown } } };
      expect(initResponse.result.capabilities.tools).toBeDefined();

      // Send tools/list request
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }) + '\n',
      );

      await waitFor(() => responses.some((r) => isResponse(r, 2)), 5000, child, childDiagnostics);
      const listResponse = responses.find((r) => isResponse(r, 2)) as {
        result: { tools: { name: string }[] };
      };
      const names = listResponse.result.tools.map((t) => t.name);
      // 4 locked verbs + episodes (G3-MCP) + skills tools + read/inspect surface.
      // This list said 8 while thirteen tools shipped: the suite was never wired
      // into CI, so nothing caught the drift.
      // Mirrors buildToolsListResponse declaration order (list-handler.ts).
      expect(names).toEqual([
        'remember',
        'recall',
        'forget',
        'reflect',
        'episodes',
        'add_skill',
        'forget_skill',
        'execute_skill',
        'explain_recall',
        'get_memory',
        'list_entities',
        'update_memory',
        'delete_entities',
      ]);

      // Graceful shutdown via SIGTERM (T6.1 EC-7 absorption)
      proc.kill('SIGTERM');
      await waitFor(() => proc!.exitCode !== null, 5000);
      expect(proc.exitCode).toBe(0);
    }, 30_000);
  });
}

function isResponse(msg: unknown, expectedId: number): boolean {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { id?: unknown }).id === expectedId
  );
}

/**
 * Poll `predicate` until it holds. When `child` is given, fail as soon as the
 * child exits (it can no longer answer) and attach `diagnostics()` to both that
 * error and the timeout, so the cause is in the test output instead of lost.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  child?: ChildProcessWithoutNullStreams,
  diagnostics?: () => string,
): Promise<void> {
  const start = Date.now();
  const detail = (): string => (diagnostics === undefined ? '' : `\n${diagnostics()}`);
  while (!predicate()) {
    if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`child process exited before the expected response${detail()}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${String(timeoutMs)}ms${detail()}`);
    }
    await new Promise<void>((r) => setTimeout(r, 50));
  }
}
