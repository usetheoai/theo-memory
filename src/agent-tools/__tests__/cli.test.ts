/**
 * CLI bootstrap tests — T6.1.
 *
 * Covers main() bootstrap behavior + EC-7 absorption (SIGINT+SIGTERM + THEOMEM_PG_URI hard-fail).
 *
 * @see ADR D1 — stdio transport (primary)
 * @see EC-7 (plan v1.1) — SIGINT + SIGTERM + env-var hard-fail absorbed inline
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module under test (loaded lazily so vi.mock applies before import)
let main: (argv?: readonly string[]) => Promise<void>;

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
  // Lazily import cli AFTER vi.mock takes effect
  const cliModule = await import('../cli.js');
  main = cliModule.main;
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('CLI main bootstrap (T6.1)', () => {
  it('bootstraps with env vars: connects stdio transport via server.start', async () => {
    await main();
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('uses THEOMEM_PG_URI for memory factory (calls createLocalMemory with parsed pool)', async () => {
    const { createLocalMemory } = await import('../../local/index.js');
    await main();
    expect(vi.mocked(createLocalMemory)).toHaveBeenCalledTimes(1);
  });
});

describe('EC-7 absorption — env-var hard-fail + signal handlers (T6.1)', () => {
  it('exits with code 2 when THEOMEM_PG_URI is absent', async () => {
    vi.stubEnv('THEOMEM_PG_URI', '');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit-called');
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(main()).rejects.toThrow('process.exit-called');

    expect(exitSpy).toHaveBeenCalledWith(2);
    // EC-7 contract: stderr message must include the example URI per plan line 828
    const writtenText = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(writtenText).toContain('THEOMEM_PG_URI');
    expect(writtenText).toMatch(/postgres:\/\//);
  });

  it('registers BOTH SIGINT and SIGTERM handlers', async () => {
    const beforeSigterm = process.listenerCount('SIGTERM');
    const beforeSigint = process.listenerCount('SIGINT');
    await main();
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1);
  });

  it('calls server.stop on SIGTERM (shutdown discipline)', async () => {
    mockStop.mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as never);
    await main();

    // Trigger SIGTERM handler manually
    process.emit('SIGTERM');
    // Yield to microtasks so the async shutdown handler runs
    await new Promise<void>((r) => setImmediate(r));

    expect(mockStop).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('SIGINT triggers shutdown handler (Ctrl-C operator scenario)', async () => {
    mockStop.mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as never);
    await main();

    process.emit('SIGINT');
    await new Promise<void>((r) => setImmediate(r));

    expect(mockStop).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
