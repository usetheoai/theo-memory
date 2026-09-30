/**
 * Integration tests for env-driven MCP transport selection.
 *
 * Precedence (flag > scoped env > THEO_MCP_RESOURCE presence > stdio default). A server
 * configured with its canonical resource URI is a network server, so THEO_MCP_RESOURCE
 * selects streamable-http and the OAuth resource-server gate (usetheoai/theo#477).
 *
 * `THEMEMORY_API_KEY` used to drive both selections. API keys are no longer accepted by the
 * MCP transport, so its presence selects nothing — pinned below so the heuristic cannot
 * quietly come back.
 */
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnectStdio = vi.fn();
const mockConnectStreamableHttp = vi.fn();
const mockRunMigrations = vi.fn();
const mockWireMemoryFromPool = vi.fn();
const mockMcpServerStop = vi.fn();
const mockPoolEnd = vi.fn();

vi.mock('../../../packages/mcp/src/transports/stdio.js', () => ({
  connectStdio: mockConnectStdio,
}));

vi.mock('../../../packages/mcp/src/transports/streamable-http.js', () => ({
  connectStreamableHttp: mockConnectStreamableHttp,
}));

vi.mock('@usetheo/memory', async () => {
  const actual = await vi.importActual<typeof import('@usetheo/memory')>(
    '@usetheo/memory',
  );
  return { ...actual, runMigrations: mockRunMigrations };
});

vi.mock('../../../packages/agent-core/src/agent-tools-memory.js', async () => {
  const actual = await vi.importActual<typeof import('../../../packages/agent-core/src/agent-tools-memory.js')>(
    '../../../packages/agent-core/src/agent-tools-memory.js',
  );
  return { ...actual, wireMemoryFromPool: mockWireMemoryFromPool };
});

vi.mock('pg', () => ({
  Pool: class MockPool {
    end = mockPoolEnd;
    // The OAuth path measures the request role's posture before binding; answer as the
    // contained application role so the composition proceeds to the transport.
    query = vi.fn().mockResolvedValue({
      rows: [{ role: 'themory_app', superuser: false, bypass_rls: false }],
    });
  },
}));

vi.mock('../../../packages/mcp/src/server.js', () => ({
  McpServer: class MockMcpServer {
    stop = mockMcpServerStop;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockConnectStdio.mockReset().mockResolvedValue(undefined);
  mockConnectStreamableHttp.mockReset().mockResolvedValue(undefined);
  mockRunMigrations.mockReset().mockResolvedValue(undefined);
  mockWireMemoryFromPool.mockReset().mockResolvedValue({});
  mockMcpServerStop.mockReset().mockResolvedValue(undefined);
  mockPoolEnd.mockReset();
  // Test isolation: real env carrying THEMEMORY_API_KEY would silently flip
  // stdio-default tests to false-positive PASS. Explicitly stub all 3 envs.
  vi.stubEnv('THEOMEM_PG_URI', 'postgres://themem:themem@localhost:5432/themem');
  vi.stubEnv('OPENAI_API_KEY', 'sk-fake-test-key-for-boot');
  vi.stubEnv('THEMEMORY_API_KEY', '');
  vi.stubEnv('THEOMEM_MCP_TRANSPORT', '');
  vi.stubEnv('THEOMEM_MCP_AUTH', '');
  vi.stubEnv('THEO_MCP_RESOURCE', '');
  vi.stubEnv('THEO_OAUTH_ISSUER', 'https://auth.test.example/');
  vi.stubEnv('THEO_MCP_TLS_TERMINATED_UPSTREAM', '');
  vi.stubEnv('THEOMEM_MIGRATE_PG_URI', '');
});

const RESOURCE = 'https://app.test.example/mcp/memory';
type HttpOpts = { oauth?: { config?: { resource?: string } } };

afterEach(() => {
  vi.unstubAllEnvs();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('themory mcp — env-driven transport selection', () => {
  it('test_resource_env_with_no_flags_selects_streamable_http_behind_the_oauth_gate', async () => {
    vi.stubEnv('THEO_MCP_RESOURCE', RESOURCE);
    const { runMcpServer } = await import('../../../packages/mcp/src/run-mcp-server.js');
    await runMcpServer();
    expect(mockConnectStreamableHttp).toHaveBeenCalledOnce();
    expect(mockConnectStdio).not.toHaveBeenCalled();
    const callArgs = mockConnectStreamableHttp.mock.calls[0] as [unknown, HttpOpts];
    expect(callArgs[1]?.oauth?.config?.resource).toBe(RESOURCE);
  });

  it('test_resource_absent_preserves_stdio_default', async () => {
    const { runMcpServer } = await import('../../../packages/mcp/src/run-mcp-server.js');
    await runMcpServer();
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_resource_whitespace_only_treated_as_absent', async () => {
    vi.stubEnv('THEO_MCP_RESOURCE', '   ');
    const { runMcpServer } = await import('../../../packages/mcp/src/run-mcp-server.js');
    await runMcpServer();
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_api_key_env_no_longer_selects_the_http_transport', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummy_that_must_select_nothing');
    const { runMcpServer } = await import('../../../packages/mcp/src/run-mcp-server.js');
    await runMcpServer();
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });
});

describe('themory mcp — precedence regression guards', () => {
  it('test_explicit_transport_stdio_flag_wins_over_resource_env', async () => {
    vi.stubEnv('THEO_MCP_RESOURCE', RESOURCE);
    const { runMcpServer } = await import('../../../packages/mcp/src/run-mcp-server.js');
    await runMcpServer({ transport: 'stdio' });
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_explicit_auth_none_boots_http_without_the_gate', async () => {
    vi.stubEnv('THEO_MCP_RESOURCE', RESOURCE);
    const { runMcpServer } = await import('../../../packages/mcp/src/run-mcp-server.js');
    await runMcpServer({ auth: 'none' });
    expect(mockConnectStreamableHttp).toHaveBeenCalledOnce();
    const callArgs = mockConnectStreamableHttp.mock.calls[0] as [unknown, HttpOpts];
    expect(callArgs[1]?.oauth).toBeUndefined();
  });
});

// Silence unused Pool import warning — Pool is used via vi.mock at module
// scope, but eslint flags the import as unused since the mock factory doesn't
// statically reference it. The mock IS required (pg.Pool is constructed inside
// runMcpServer before any of our resolver assertions fire).
void Pool;
