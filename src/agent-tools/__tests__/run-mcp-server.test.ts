/**
 * FC2-T1.1 RED — MCP-side stub-embedder stderr warning regression test.
 *
 * Mirrors the REST-side `FC1-T2.2-RED` pattern in `run-server.test.ts`
 * (lines 202-208). Pins the 3-line stderr warning emitted at
 * `src/agent-tools/run-mcp-server.ts:91-103` (Stub embedder + Stub LLM
 * disclosure, per Inquebrável Rule 3 honesty discipline at the consumer
 * boundary). Without this test, a future refactor could silently drop
 * the warning lines and the CI gate would NOT catch it.
 *
 * EC-2 absorption: `beforeEach` stubs BOTH `THEOMEM_PG_URI` AND
 * `THEOMEM_MCP_TRANSPORT` (empty string). Without the second stub,
 * a system env carrying `THEOMEM_MCP_TRANSPORT=streamable-http` would
 * route to `connectStreamableHttp` (mock-uncovered path) — empty-string
 * env normalizes to the `'stdio'` default branch in `resolveTransport`.
 *
 * EC-6 absorption (FOLLOW-UP coupling): this test pins the CURRENT
 * UNCONDITIONAL behavior. When the FOLLOW-UP at `run-mcp-server.ts:93-94`
 * lands (gating the warning when real provider configured), this test
 * MUST be updated to assert conditional emission (stub path emits;
 * real-provider path does NOT emit). A future test-updater grepping
 * for `FOLLOW-UP at run-mcp-server.ts:93-94` lands on this test.
 *
 * @see Plan theo-memory-standalone-p0-fixes-cycle-2 § T1.1
 * @see F-arch-7 = F-wire-1 absorption (cycle-1 review report)
 * @see FOLLOW-UP at run-mcp-server.ts:93-94 — conditional gating sequel
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPoolEnd = vi.fn();
const mockRunMigrations = vi.fn();
const mockCreateLocalMemory = vi.fn();
const mockMcpServerStop = vi.fn();
const mockConnectStdio = vi.fn();
const mockConnectStreamableHttp = vi.fn();

vi.mock('../../local/index.js', () => ({
  createLocalMemory: mockCreateLocalMemory,
  runMigrations: mockRunMigrations,
  StubEmbedder: class MockStubEmbedder {},
  StubLLM: class MockStubLLM {},
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

vi.mock('../server.js', () => ({
  McpServer: class MockMcpServer {
    stop = mockMcpServerStop;
  },
}));

vi.mock('../transports/stdio.js', () => ({
  connectStdio: mockConnectStdio,
}));

vi.mock('../transports/streamable-http.js', () => ({
  connectStreamableHttp: mockConnectStreamableHttp,
}));

interface StderrSpy {
  mockRestore: () => void;
  mock: { calls: unknown[][] };
}
let stderrSpy: StderrSpy;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockPoolEnd.mockReset();
  mockRunMigrations.mockReset();
  mockCreateLocalMemory.mockReset();
  mockMcpServerStop.mockReset();
  mockConnectStdio.mockReset();
  mockConnectStreamableHttp.mockReset();
  mockRunMigrations.mockResolvedValue(undefined);
  mockCreateLocalMemory.mockResolvedValue({});
  mockMcpServerStop.mockResolvedValue(undefined);
  mockConnectStdio.mockResolvedValue(undefined);
  mockConnectStreamableHttp.mockResolvedValue(undefined);
  // EC-2 absorption: stub BOTH env vars to keep transport on the stdio default
  // branch and out of the streamable-http mock-uncovered path even if a system
  // env carries THEOMEM_MCP_TRANSPORT=streamable-http.
  vi.stubEnv('THEOMEM_PG_URI', 'postgres://themem:themem@localhost:5432/themem');
  vi.stubEnv('THEOMEM_MCP_TRANSPORT', '');
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  stderrSpy.mockRestore();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('T1.1 — runMcpServer stub-embedder warning', () => {
  it('FC2-T1.1-RED — runMcpServer writes stub-embedder warning to stderr on startup (F-arch-7 = F-wire-1)', async () => {
    const { runMcpServer } = await import('../run-mcp-server.js');
    await runMcpServer();
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    expect(captured).toMatch(/stub embedder/i);
    expect(captured).toMatch(/themory mcp/i);
  });
});
