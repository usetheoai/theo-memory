/**
 * T2.3 RED — `themory server` runtime contract (in-process slice).
 *
 * Covers the SOLO HTTP/composition behavior of `runServer(options)`:
 *  - readiness gate 503 → 200 during Memory factory warm-up (EC-33)
 *  - migrate-on-startup BEFORE port binding (ADR D8)
 *  - THEMEMORY_SKIP_MIGRATIONS=true positive opt-in escape hatch
 *  - DB-unreachable fast-fail exit 1
 *
 * SIGTERM (EC-32) + EADDRINUSE (EC-31) require real signals + real port
 * collisions and are covered by `tests/integration/cli-consolidated.test.ts`
 * via child-process spawning.
 *
 * @see Plan theo-memory-standalone-p0 § T2.3 + ADR D8 + EC-31/32/33
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockServeClose = vi.fn();
const mockServeOn = vi.fn();
const mockServeListener = vi.fn();
const mockPoolEnd = vi.fn();
const mockRunMigrations = vi.fn();
const mockCreateLocalMemory = vi.fn();

vi.mock('@hono/node-server', () => ({
  serve: (
    config: { fetch: unknown; port: number; hostname?: string },
    cb?: (info: { port: number }) => void,
  ): { close: typeof mockServeClose; on: typeof mockServeOn } => {
    if (cb !== undefined) cb({ port: config.port });
    mockServeListener(config);
    return { close: mockServeClose, on: mockServeOn };
  },
}));

vi.mock('../../local/index.js', () => ({
  createLocalMemory: mockCreateLocalMemory,
  runMigrations: mockRunMigrations,
  StubEmbedder: class MockStubEmbedder {},
  StubLLM: class MockStubLLM {},
}));

vi.mock('../../embedders/stub.js', () => ({
  DeterministicStubEmbedder: class MockDeterministicStubEmbedder {
    async embed(): Promise<readonly number[]> {
      return [0.1, 0.2, 0.3];
    }
    async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      return texts.map(() => [0.1, 0.2, 0.3]);
    }
  },
}));

vi.mock('../../local/pgvector-store.js', () => ({
  PgvectorStore: class MockPgvectorStore {},
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    end = mockPoolEnd;
    query = vi.fn().mockResolvedValue({ rows: [] });
  },
}));

// EC-6 absorption (fixes-cycle-1 T2.2): mock process.stderr.write in beforeEach
// so the new T2.2 stub-embedder warning does NOT pollute the test log output
// across the 8 existing tests. The dedicated EC-6/T2.2 RED test reads from
// the shared spy's call record.
interface StderrSpy {
  mockRestore: () => void;
  mock: { calls: unknown[][] };
}
let stderrSpy: StderrSpy;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockServeClose.mockReset();
  mockServeOn.mockReset();
  mockServeListener.mockReset();
  mockPoolEnd.mockReset();
  mockRunMigrations.mockReset();
  mockCreateLocalMemory.mockReset();
  mockRunMigrations.mockResolvedValue(undefined);
  mockCreateLocalMemory.mockResolvedValue({});
  vi.stubEnv('THEOMEM_PG_URI', 'postgres://themem:themem@localhost:5432/themem');
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  stderrSpy.mockRestore();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('T2.3 — runServer composition contract', () => {
  it('43. binds port 9999 via @hono/node-server serve', async () => {
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9999 });
    expect(mockServeListener).toHaveBeenCalledTimes(1);
    expect(mockServeListener.mock.calls[0]?.[0]).toMatchObject({ port: 9999 });
  });

  it('44. runs migrations BEFORE binding port (ADR D8)', async () => {
    // Capture call order: migrations must complete before serve() is invoked.
    const calls: string[] = [];
    mockRunMigrations.mockImplementation(async () => {
      calls.push('migrate');
      await Promise.resolve();
    });
    mockServeListener.mockImplementation(() => {
      calls.push('serve');
    });
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9998 });
    const migrateIdx = calls.indexOf('migrate');
    const serveIdx = calls.indexOf('serve');
    expect(migrateIdx).toBeGreaterThanOrEqual(0);
    expect(serveIdx).toBeGreaterThan(migrateIdx);
  });

  it('45. skips migrations when THEMEMORY_SKIP_MIGRATIONS=true (positive opt-in)', async () => {
    vi.stubEnv('THEMEMORY_SKIP_MIGRATIONS', 'true');
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9997 });
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  it('46. runs migrations when THEMEMORY_SKIP_MIGRATIONS=false (fail-safe default)', async () => {
    vi.stubEnv('THEMEMORY_SKIP_MIGRATIONS', 'false');
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9996 });
    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
  });

  it('47. EC-33 readiness gate — /v1/health returns 503 while Memory factory warming', async () => {
    // Defer factory resolution so we can probe /v1/health during warm-up.
    let resolveMemory: () => void = () => undefined;
    mockCreateLocalMemory.mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveMemory = () => resolve({});
        }),
    );
    const { runServer } = await import('../run-server.js');
    const runPromise = runServer({ port: 9995 });
    // Yield so serve() binds + readiness state initializes false.
    await new Promise<void>((r) => setImmediate(r));
    expect(mockServeListener).toHaveBeenCalledTimes(1);
    const serveConfig = mockServeListener.mock.calls[0]?.[0] as { fetch: (req: Request) => Promise<Response> };
    const warmingRes = await serveConfig.fetch(new Request('http://localhost/v1/health'));
    expect(warmingRes.status).toBe(503);
    // Now resolve the factory → readiness flips to true.
    resolveMemory();
    await runPromise;
    const readyRes = await serveConfig.fetch(new Request('http://localhost/v1/health'));
    expect(readyRes.status).toBe(200);
  });

  it('48. fails fast with exit 1 when migrations throw (DB unreachable proxy)', async () => {
    mockRunMigrations.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit-called');
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runServer } = await import('../run-server.js');
    await expect(runServer({ port: 9994 })).rejects.toThrow('process.exit-called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/ECONNREFUSED|migrat/i);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('49. registers BOTH SIGTERM and SIGINT shutdown handlers (EC-32)', async () => {
    const beforeSigterm = process.listenerCount('SIGTERM');
    const beforeSigint = process.listenerCount('SIGINT');
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9993 });
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1);
  });

  it('50. EC-7 absorption — exits 2 when THEOMEM_PG_URI absent', async () => {
    vi.stubEnv('THEOMEM_PG_URI', '');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit-called');
    }) as never);
    // Use a SECOND spy here (in addition to the beforeEach one) because this
    // test pre-dates the EC-6 absorption and asserts a specific narrow path.
    const localStderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runServer } = await import('../run-server.js');
    await expect(runServer({ port: 9992 })).rejects.toThrow('process.exit-called');
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderr = localStderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toContain('THEOMEM_PG_URI');
    exitSpy.mockRestore();
    localStderrSpy.mockRestore();
  });

  it('FC1-T2.2-RED. runServer writes stub-embedder warning to stderr on startup (F-rev-9 + EC-6)', async () => {
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9991 });
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    expect(captured).toMatch(/stub embedder/i);
    expect(captured).toMatch(/themory server/i);
  });
});
