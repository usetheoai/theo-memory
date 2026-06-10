/**
 * T2.5 RED — `themory health` readiness probe contract.
 *
 * Checks (EC-37):
 *   Mandatory (always run):
 *     1. `pool.query('SELECT 1')` within 2s timeout (EC-17 parity).
 *     2. `createLocalMemory({...})` composes without throw.
 *   Optional (`--deep`):
 *     3. `embedder.embed("ping")` returns a vector.
 *     4. `llm.generateChat([...])` returns a non-empty content string.
 *
 * `--deep` at P0 is honest-scaffold: stubs return deterministic results so
 * the call is a smoke-check of method-presence + composition. Against
 * real OpenAI/local impls the same probe becomes a network round-trip.
 *
 * Exit codes:
 *   0  all enabled checks passed
 *   1  any mandatory or enabled --deep check failed
 *   2  THEOMEM_PG_URI missing (EC-7 parity)
 *
 * @see Plan theo-memory-standalone-p0 § T2.5 + EC-37 + EC-17
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPoolEnd = vi.fn();
const mockPoolQuery = vi.fn();
const mockCreateLocalMemory = vi.fn();
const mockEmbed = vi.fn();
const mockGenerateChat = vi.fn();

vi.mock('@usetheo/memory', () => ({
  createLocalMemory: mockCreateLocalMemory,
  StubEmbedder: class MockStubEmbedder {
    embed = mockEmbed;
    embedBatch = vi.fn();
  },
  StubLLM: class MockStubLLM {
    generateChat = mockGenerateChat;
    generateResponse = vi.fn();
  },
}));

vi.mock('@usetheo/memory', () => ({
  PgvectorStore: class MockPgvectorStore {},
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    end = mockPoolEnd;
    query = mockPoolQuery;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockPoolEnd.mockReset();
  mockPoolQuery.mockReset();
  mockCreateLocalMemory.mockReset();
  mockEmbed.mockReset();
  mockGenerateChat.mockReset();
  mockPoolEnd.mockResolvedValue(undefined);
  mockPoolQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  mockCreateLocalMemory.mockResolvedValue({});
  mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  mockGenerateChat.mockResolvedValue({ content: 'ok' });
  vi.stubEnv('THEOMEM_PG_URI', 'postgres://themem:themem@localhost:5432/themem');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('T2.5 — runHealth contract', () => {
  it('56. valid DB URI + composable Memory → returns 0', async () => {
    const { runHealth } = await import('../run-health.js');
    const exitCode = await runHealth();
    expect(exitCode).toBe(0);
    expect(mockPoolQuery).toHaveBeenCalledWith('SELECT 1');
    expect(mockCreateLocalMemory).toHaveBeenCalledTimes(1);
  });

  it('57. invalid DB URI (query fails) → returns 1 with stderr', async () => {
    mockPoolQuery.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runHealth } = await import('../run-health.js');
    const exitCode = await runHealth();
    expect(exitCode).toBe(1);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/db|ECONNREFUSED|SELECT 1/i);
    stderrSpy.mockRestore();
  });

  it('58. Memory factory throws → returns 1 with stderr mentioning factory failure', async () => {
    mockCreateLocalMemory.mockRejectedValue(new Error('embedder ctor blew up'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runHealth } = await import('../run-health.js');
    const exitCode = await runHealth();
    expect(exitCode).toBe(1);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/memory factory|composition|embedder/i);
    stderrSpy.mockRestore();
  });

  it('59. --deep pings embedder + llm → returns 0 on success', async () => {
    const { runHealth } = await import('../run-health.js');
    const exitCode = await runHealth({ deep: true });
    expect(exitCode).toBe(0);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockEmbed).toHaveBeenCalledWith('ping');
    expect(mockGenerateChat).toHaveBeenCalledTimes(1);
  });

  it('60. --deep embedder failure → returns 1 with stderr', async () => {
    mockEmbed.mockRejectedValue(new Error('embed network reset'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runHealth } = await import('../run-health.js');
    const exitCode = await runHealth({ deep: true });
    expect(exitCode).toBe(1);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/embed|deep/i);
    stderrSpy.mockRestore();
  });

  it('61. EC-7 absorption — exits 2 when THEOMEM_PG_URI absent', async () => {
    vi.stubEnv('THEOMEM_PG_URI', '');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runHealth } = await import('../run-health.js');
    const exitCode = await runHealth();
    expect(exitCode).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toContain('THEOMEM_PG_URI');
    stderrSpy.mockRestore();
  });

  it('62. EC-17 — pool.query times out at 2s (fails health check)', async () => {
    // Hang the query forever; runHealth must Promise.race with 2s timeout
    // and exit 1.
    mockPoolQuery.mockImplementation(() => new Promise(() => undefined));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { runHealth } = await import('../run-health.js');
    const start = Date.now();
    const exitCode = await runHealth();
    const elapsed = Date.now() - start;
    expect(exitCode).toBe(1);
    // Allow some slack for vi mock overhead but must complete within ~3s.
    expect(elapsed).toBeLessThan(3_500);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderr).toMatch(/timeout|2s|db/i);
    stderrSpy.mockRestore();
  }, 5_000);
});
