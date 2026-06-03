/**
 * CLI bootstrap + commander router tests.
 *
 * Originally T6.1 covered `main()` bootstrap behavior (EC-7). T2.1 (this
 * file) RETAINS those assertions but moves them to `runMcpServer` from
 * `../run-mcp-server.js` (the extracted MCP composition root — see ADR D8 +
 * plan T2.1) and ADDS commander-router + alias-detection coverage.
 *
 * @see ADR D1 — stdio transport (primary)
 * @see EC-7 (plan v1.1) — SIGINT + SIGTERM + env-var hard-fail
 * @see Plan theo-memory-standalone-p0 § T2.1 + EC-27 + EC-28 + EC-29
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module under test (loaded lazily so vi.mock applies before import)
let runMcpServer: (argv?: readonly string[]) => Promise<void>;

const mockConnect = vi.fn();
const mockStop = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class MockStdioServerTransport {}
  return { StdioServerTransport: MockStdioServerTransport };
});

vi.mock('../server.js', () => {
  class MockMcpServer {
    start = mockConnect;
    stop = mockStop;
  }
  return { McpServer: MockMcpServer };
});

vi.mock('../../local/index.js', () => ({
  createLocalMemory: vi.fn().mockResolvedValue({ /* fake Memory */ }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  StubEmbedder: class MockStubEmbedder {},
  StubLLM: class MockStubLLM {},
}));

vi.mock('../../local/pgvector-store.js', () => ({
  PgvectorStore: class MockPgvectorStore {},
}));

vi.mock('pg', () => ({
  Pool: class MockPool {},
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mockConnect.mockReset();
  mockStop.mockReset();
  vi.stubEnv('THEOMEM_PG_URI', 'postgres://themem:themem@localhost:5432/themem');
  // Lazily import AFTER vi.mock takes effect
  const mcpModule = await import('../run-mcp-server.js');
  runMcpServer = mcpModule.runMcpServer;
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('runMcpServer bootstrap (post-T2.1 extraction)', () => {
  it('bootstraps with env vars: connects stdio transport via server.start', async () => {
    await runMcpServer();
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('uses THEOMEM_PG_URI for memory factory (calls createLocalMemory with parsed pool)', async () => {
    const { createLocalMemory } = await import('../../local/index.js');
    await runMcpServer();
    expect(vi.mocked(createLocalMemory)).toHaveBeenCalledTimes(1);
  });
});

describe('EC-7 absorption — env-var hard-fail + signal handlers', () => {
  it('exits with code 2 when THEOMEM_PG_URI is absent', async () => {
    vi.stubEnv('THEOMEM_PG_URI', '');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit-called');
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runMcpServer()).rejects.toThrow('process.exit-called');

    expect(exitSpy).toHaveBeenCalledWith(2);
    const writtenText = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(writtenText).toContain('THEOMEM_PG_URI');
    expect(writtenText).toMatch(/postgres:\/\//);
  });

  it('registers BOTH SIGINT and SIGTERM handlers', async () => {
    const beforeSigterm = process.listenerCount('SIGTERM');
    const beforeSigint = process.listenerCount('SIGINT');
    await runMcpServer();
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1);
  });

  it('calls server.stop on SIGTERM (shutdown discipline)', async () => {
    mockStop.mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as never);
    await runMcpServer();

    process.emit('SIGTERM');
    await new Promise<void>((r) => setImmediate(r));

    expect(mockStop).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('SIGINT triggers shutdown handler (Ctrl-C operator scenario)', async () => {
    mockStop.mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as never);
    await runMcpServer();

    process.emit('SIGINT');
    await new Promise<void>((r) => setImmediate(r));

    expect(mockStop).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('T2.1 — commander router + alias detection', () => {
  it('32. themory --help lists exactly 4 subcommands (mcp, server, migrate, health)', async () => {
    const { buildProgram } = await import('../cli.js');
    const program = buildProgram();
    const helpText = program.helpInformation();
    expect(helpText).toContain('mcp');
    expect(helpText).toContain('server');
    expect(helpText).toContain('migrate');
    expect(helpText).toContain('health');
    // Strict count: parse the Commands block.
    const commandLines = helpText.split('\n').filter((l) => /^\s{2}\w+(\s|$)/.test(l));
    const knownSubcommands = commandLines.filter((l) =>
      /^\s{2}(mcp|server|migrate|health)\b/.test(l),
    );
    expect(knownSubcommands).toHaveLength(4);
  });

  it('33. themory-mcp alias detected via direct path basename (EC-27)', async () => {
    const { detectMcpAlias } = await import('../cli.js');
    expect(detectMcpAlias('/usr/local/bin/themory-mcp')).toBe(true);
    expect(detectMcpAlias('./dist/agent-tools/cli.js')).toBe(false);
    expect(detectMcpAlias('themory')).toBe(false);
    expect(detectMcpAlias(undefined)).toBe(false);
  });

  it('34. themory-mcp alias detected via npm exec wrapper + npx temp paths (EC-27)', async () => {
    const { detectMcpAlias } = await import('../cli.js');
    // npm exec wrapper
    expect(detectMcpAlias('/home/u/.npm/_npx/abc/node_modules/.bin/themory-mcp')).toBe(true);
    // npx Windows-flavored path
    expect(detectMcpAlias('C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\1\\node_modules\\.bin\\themory-mcp')).toBe(true);
    // direct .js suffix (build output)
    expect(detectMcpAlias('/opt/dist/themory-mcp.js')).toBe(true);
    // .mjs / .cjs variants
    expect(detectMcpAlias('/x/themory-mcp.mjs')).toBe(true);
    expect(detectMcpAlias('/x/themory-mcp.cjs')).toBe(true);
  });

  it('35. applyAliasArgvShim splices "mcp" idempotently (EC-29)', async () => {
    const { applyAliasArgvShim } = await import('../cli.js');
    // Plain alias call: themory-mcp --port 8080
    expect(applyAliasArgvShim(['node', 'themory-mcp', '--port', '8080'])).toEqual([
      'node',
      'themory-mcp',
      'mcp',
      '--port',
      '8080',
    ]);
    // Idempotent: user already typed `themory-mcp mcp` → unchanged
    expect(applyAliasArgvShim(['node', 'themory-mcp', 'mcp', '--port', '8080'])).toEqual([
      'node',
      'themory-mcp',
      'mcp',
      '--port',
      '8080',
    ]);
  });

  it('36. package.json bin lists BOTH themory and themory-mcp entries (EC-28)', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8')) as {
      bin: Record<string, string>;
    };
    expect(pkg.bin).toHaveProperty('themory');
    expect(pkg.bin).toHaveProperty('themory-mcp');
    expect(pkg.bin['themory']).toBe(pkg.bin['themory-mcp']);
    expect(pkg.bin['themory']).toBe('./dist/agent-tools/cli.js');
  });
});
