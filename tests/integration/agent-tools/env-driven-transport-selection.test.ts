/**
 * Integration tests for env-driven MCP transport selection — T1.1 + T1.2.
 *
 * Locks the env-presence precedence contract per plan
 * themory-mcp-bearer-by-env-faang ADR D1 (3-tier precedence: flag > scoped
 * env > THEMEMORY_API_KEY presence > stdio default) + ADR D2 (when env-driven
 * HTTP path activates, auth auto-selects 'api-keys').
 *
 * Pre-impl state (T1.1 RED contract): the 4 RED tests below MUST FAIL against
 * `develop` HEAD because `resolveTransport`/`resolveAuthMode` does not yet
 * consult `THEMEMORY_API_KEY` (Tier-3 unimplemented). They turn GREEN when
 * T2.1 + T2.2 land. The 5th test (T1.2) is a regression-guard locking the
 * existing Tier-1 behavior — passes today, MUST keep passing after T2.x.
 *
 * SEPA-pre-RED MAJOR findings absorbed:
 * - vi.mock module-mock pattern (NOT plain vi.spyOn) — ESM `.js` binding
 *   interception requires module-mock; spyOn on imported bindings does NOT
 *   intercept the run-mcp-server.ts call sites.
 * - vi.stubEnv discipline in beforeEach + vi.unstubAllEnvs in afterEach —
 *   real env carrying THEMEMORY_API_KEY would silently flip stdio-default
 *   test to false-positive PASS otherwise.
 * - EC-1 whitespace-only treated as absent — added as RED #3b (the spec is
 *   `.trim() !== ''`, so empty-string + whitespace-only are both "absent").
 */
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnectStdio = vi.fn();
const mockConnectStreamableHttp = vi.fn();
const mockRunMigrations = vi.fn();
const mockWireMemoryFromPool = vi.fn();
const mockMcpServerStop = vi.fn();
const mockPoolEnd = vi.fn();

vi.mock('../../../src/agent-tools/transports/stdio.js', () => ({
  connectStdio: mockConnectStdio,
}));

vi.mock('../../../src/agent-tools/transports/streamable-http.js', () => ({
  connectStreamableHttp: mockConnectStreamableHttp,
}));

vi.mock('../../../src/local/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/local/index.js')>(
    '../../../src/local/index.js',
  );
  return { ...actual, runMigrations: mockRunMigrations };
});

vi.mock('../../../src/agent-tools/agent-tools-memory.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/agent-tools/agent-tools-memory.js')>(
    '../../../src/agent-tools/agent-tools-memory.js',
  );
  return { ...actual, wireMemoryFromPool: mockWireMemoryFromPool };
});

vi.mock('pg', () => ({
  Pool: class MockPool {
    end = mockPoolEnd;
    query = vi.fn().mockResolvedValue({ rows: [] });
  },
}));

vi.mock('../../../src/agent-tools/server.js', () => ({
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
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('themory mcp — env-driven transport selection (T1.1)', () => {
  it('test_themory_api_key_set_no_flags_selects_streamable_http_plus_api_keys', async () => {
    // Given: THEMEMORY_API_KEY env present + no --transport/--auth flags
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummytoken_for_red_assertion');
    // When: runMcpServer invoked with empty options bag
    const { runMcpServer } = await import('../../../src/agent-tools/run-mcp-server.js');
    await runMcpServer();
    // Then: streamable-http transport selected; stdio NOT called
    expect(mockConnectStreamableHttp).toHaveBeenCalledOnce();
    expect(mockConnectStdio).not.toHaveBeenCalled();
    // And: bearerAuth.apiKey was wired (ApiKeyAuthVerifier instance) — proves
    // ADR D2 auto-selection. Test expects 2 args: (server, options).
    const callArgs = mockConnectStreamableHttp.mock.calls[0] as [unknown, { bearerAuth?: { apiKey?: unknown } }];
    expect(callArgs[1]?.bearerAuth?.apiKey).toBeDefined();
  });

  it('test_themory_api_key_absent_preserves_stdio_default', async () => {
    // Given: no env (beforeEach stubbed THEMEMORY_API_KEY='')
    // When: runMcpServer invoked
    const { runMcpServer } = await import('../../../src/agent-tools/run-mcp-server.js');
    await runMcpServer();
    // Then: stdio default preserved; streamable-http NOT called
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_themory_api_key_empty_string_treated_as_absent', async () => {
    // Given: env present but empty string (operator typo / partial paste)
    vi.stubEnv('THEMEMORY_API_KEY', '');
    // When: runMcpServer invoked
    const { runMcpServer } = await import('../../../src/agent-tools/run-mcp-server.js');
    await runMcpServer();
    // Then: treated as absent → stdio default
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_themory_api_key_whitespace_only_treated_as_absent_per_ec1', async () => {
    // EC-1 absorption (plan v1.1): whitespace-only MUST be treated as absent.
    // Without `.trim() !== ''`, `!== ''` would let "   " auto-flip transport
    // → operator confusion + token-less Bearer requests + 401 storm.
    vi.stubEnv('THEMEMORY_API_KEY', '   ');
    const { runMcpServer } = await import('../../../src/agent-tools/run-mcp-server.js');
    await runMcpServer();
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_themory_api_key_set_no_flags_auth_mode_is_api_keys', async () => {
    // ADR D2 lock: auth mode MUST be 'api-keys' (NOT 'none') when env-driven
    // HTTP activates. Falling back to 'none' would be a silent security
    // downgrade: token present in env but ignored by server.
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummy_for_auth_assertion');
    const { runMcpServer } = await import('../../../src/agent-tools/run-mcp-server.js');
    await runMcpServer();
    expect(mockConnectStreamableHttp).toHaveBeenCalledOnce();
    const callArgs = mockConnectStreamableHttp.mock.calls[0] as [unknown, { bearerAuth?: { apiKey?: unknown; oidc?: unknown } }];
    // bearerAuth.apiKey defined AND oidc undefined proves auth='api-keys' (not 'both' / 'none' / 'oidc')
    expect(callArgs[1]?.bearerAuth?.apiKey).toBeDefined();
    expect(callArgs[1]?.bearerAuth?.oidc).toBeUndefined();
  });
});

describe('themory mcp — precedence regression guards (T1.2)', () => {
  it('test_explicit_transport_stdio_flag_wins_over_themory_api_key_env_presence', async () => {
    // ADR D1 Tier-1 lock: explicit --transport=stdio flag MUST win over
    // env-presence heuristic. This test PASSES against develop today (regression
    // guard) and MUST keep passing after T2.1+T2.2 GREEN.
    // Reference: src/agent-tools/run-mcp-server.ts:84-89 current resolveTransport.
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummy_should_be_ignored_by_flag');
    const { runMcpServer } = await import('../../../src/agent-tools/run-mcp-server.js');
    await runMcpServer({ transport: 'stdio' });
    expect(mockConnectStdio).toHaveBeenCalledOnce();
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });
});

// Silence unused Pool import warning — Pool is used via vi.mock at module
// scope, but eslint flags the import as unused since the mock factory doesn't
// statically reference it. The mock IS required (pg.Pool is constructed inside
// runMcpServer before any of our resolver assertions fire).
void Pool;
