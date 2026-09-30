/**
 * FC2-T1.1 RED — MCP-side stub-embedder stderr warning regression test.
 *
 * Mirrors the REST-side `FC1-T2.2-RED` pattern in `run-server.test.ts`
 * (lines 202-208). Pins the 3-line stderr warning emitted at
 * `packages/mcp/src/run-mcp-server.ts:91-103` (Stub embedder + Stub LLM
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
const mockAssertRequestPoolIsolated = vi.fn();
const mockTenantScopedPool = vi.fn();
const mockRequireStrictWorkspaceWrites = vi.fn();
let poolsConstructed = 0;

vi.mock('@usetheo/memory', () => ({
  createLocalMemory: mockCreateLocalMemory,
  runMigrations: mockRunMigrations,
  StubEmbedder: class MockStubEmbedder {},
  StubLLM: class MockStubLLM {},
  PgvectorStore: class MockPgvectorStore {},
  // Full-suite fix (M13 gate): mirror agent-tools-memory.ts's static import list —
  // a missing name fails the whole file at load.
  SandboxedSkillExecutor: class MockSandboxedSkillExecutor {},
  PgRoutingAuditStore: class MockPgRoutingAuditStore {},
  // M14 T2.2 — run-mcp-server wires PgMemoryEntityStore for the entity tools.
  PgMemoryEntityStore: class MockPgMemoryEntityStore {},
  // usetheoai/theo#477 — the OAuth path's tenancy bar. Mocked here because this file measures
  // the WIRING; the refusal against a real superuser is proven against Postgres in
  // tests/integration/mcp/oauth-tenant-isolation.test.ts.
  assertRequestPoolIsolated: mockAssertRequestPoolIsolated,
  tenantScopedPool: mockTenantScopedPool,
  requireStrictWorkspaceWrites: mockRequireStrictWorkspaceWrites,
}));

// FLAKY-boot-import — `@usetheo/memory/recall-trace-pg` nao estava mockado, e o
// `await import()` deste arquivo pagava a transformacao do grafo real dele. Medido
// no arquivo irmao (`run-server.test.ts`): 14 s -> 5,7 s so com este mock, contra
// um teto de 15 s. Sob carga da suite a margem sumia e o teste falhava de forma
// intermitente. Nenhum teste deste arquivo assere qualquer simbolo deste modulo.
vi.mock('@usetheo/memory/recall-trace-pg', () => ({
  PgRecallTraceStore: class MockPgRecallTraceStore {},
  PgRecallTraceRetention: class MockPgRecallTraceRetention {},
  startRecallTraceRetentionCron: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    constructor() {
      poolsConstructed += 1;
    }
    end = mockPoolEnd;
    query = vi.fn().mockResolvedValue({ rows: [] });
  },
}));

vi.mock('./server.js', () => ({
  McpServer: class MockMcpServer {
    stop = mockMcpServerStop;
  },
}));

vi.mock('./transports/stdio.js', () => ({
  connectStdio: mockConnectStdio,
}));

vi.mock('./transports/streamable-http.js', () => ({
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
  mockAssertRequestPoolIsolated.mockReset();
  mockAssertRequestPoolIsolated.mockResolvedValue({ role: 'themory_app', superuser: false, bypassRls: false });
  mockTenantScopedPool.mockReset();
  mockTenantScopedPool.mockImplementation((p: unknown) => p);
  mockRequireStrictWorkspaceWrites.mockReset();
  mockPoolEnd.mockResolvedValue(undefined);
  poolsConstructed = 0;
  // EC-2 absorption: stub BOTH env vars to keep transport on the stdio default
  // branch and out of the streamable-http mock-uncovered path even if a system
  // env carries THEOMEM_MCP_TRANSPORT=streamable-http.
  vi.stubEnv('THEOMEM_PG_URI', 'postgres://themem:themem@localhost:5432/themem');
  vi.stubEnv('THEOMEM_MCP_TRANSPORT', '');
  // T3.1 — invariant #9 + SEPA Pre-RED MAJOR: stub BOTH env vars to keep the
  // disclosure tests deterministic against a developer shell that may carry
  // THEMEMORY_API_KEY=… or THEOMEM_MCP_QUIET=1 from a prior session. Without
  // these stubs the false-GREEN risk is real (e.g., QUIET=1 in shell would
  // silently mute the disclosure under test).
  vi.stubEnv('THEMEMORY_API_KEY', '');
  vi.stubEnv('THEOMEM_MCP_AUTH', '');
  vi.stubEnv('THEOMEM_MCP_QUIET', '');
  vi.stubEnv('THEO_MCP_RESOURCE', '');
  vi.stubEnv('THEO_OAUTH_ISSUER', '');
  vi.stubEnv('THEO_MCP_TLS_TERMINATED_UPSTREAM', '');
  vi.stubEnv('THEOMEM_MIGRATE_PG_URI', '');
  // e43d801 alignment — run-mcp-server.ts hard-fails on missing OPENAI_API_KEY.
  vi.stubEnv('OPENAI_API_KEY', 'sk-fake-test-key-for-boot');
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  stderrSpy.mockRestore();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('T1.1 — runMcpServer startup banner (post-e43d801 real-providers regime)', () => {
/**
 * TIMEOUT EXPLICITO — calibrado contra medicao, nao arredondado para cima.
 *
 * Estes testes fazem `await import()` de um modulo de boot: o que eles medem, de
 * fato, e TRANSFORMACAO DE MODULO, nao comportamento. Com 12 workers do vitest
 * competindo pelo transform, o piso de infraestrutura passa dos 15 s do
 * `testTimeout` global, e o teste falha por latencia da maquina em vez de por
 * defeito no codigo.
 *
 * O custo EVITAVEL ja foi removido: `@usetheo/memory/recall-trace-pg` passou a
 * ser mockado nestes arquivos (medido em isolamento: 14,0 s -> 5,7 s). O que
 * resta e inerente ao import dinamico de um grafo real sob contencao.
 *
 * 30 s = ~4x o custo isolado medido (5,7-8,8 s), com folga para a contencao.
 * Se voltar a estourar, o caminho e quebrar a cadeia de import do boot — nao
 * subir este numero de novo.
 */
  it('FC2-T1.1 — runMcpServer writes the real-providers disclosure to stderr on startup', async () => {
    // Post-e43d801: stub-embedder warning is REMOVED. The replacement banner
    // announces real providers (LocalTransformerEmbedder + OpenAILLM).
    process.env['OPENAI_API_KEY'] = 'sk-fake-test-key-for-boot';
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    expect(captured).toMatch(/real providers wired/i);
    expect(captured).toMatch(/themory mcp/i);
  }, 30_000);
});

/** Env for the OAuth-protected HTTP path (usetheoai/theo#477). */
function stubOAuthEnv(): void {
  vi.stubEnv('THEO_MCP_RESOURCE', 'https://app.test.example/mcp/memory');
  vi.stubEnv('THEO_OAUTH_ISSUER', 'https://auth.test.example/');
}

function stderrText(): string {
  return stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
}

describe('T3.1 — runMcpServer transport+auth disclosure (ADR D3)', () => {
  it('test_stderr_discloses_env_driven_oauth_http_path_when_no_explicit_flag', async () => {
    stubOAuthEnv();
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    const captured = stderrText();
    expect(captured).toMatch(/transport=streamable-http \+ auth=oauth/);
    expect(captured).toMatch(/THEO_MCP_RESOURCE present/);
    expect(captured).toMatch(/--transport=stdio.*override/);
  });

  it('test_stderr_discloses_stdio_default_with_hint', async () => {
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    const captured = stderrText();
    expect(captured).toMatch(/transport=stdio \(default;/);
    expect(captured).toMatch(/set THEO_MCP_RESOURCE/);
  });

  it('test_stderr_explicit_flag_suppresses_disclosure', async () => {
    stubOAuthEnv();
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer({ transport: 'stdio' });
    const captured = stderrText();
    expect(captured).toMatch(/real providers wired/);
    expect(captured).not.toMatch(/transport=stdio \(default;/);
    expect(captured).not.toMatch(/transport=streamable-http \+ auth=oauth/);
  });

  it('test_stderr_quiet_env_suppresses_disclosure_under_env_driven_http', async () => {
    stubOAuthEnv();
    vi.stubEnv('THEOMEM_MCP_QUIET', '1');
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    const captured = stderrText();
    expect(captured).toMatch(/real providers wired/);
    expect(captured).not.toMatch(/transport=streamable-http \+ auth=oauth/);
  });
});

describe('T4.1 — resolveMcpModes precedence matrix (usetheoai/theo#477)', () => {
  type Transport = 'stdio' | 'streamable-http';
  type Auth = 'none' | 'oauth';
  interface Cell {
    readonly name: string;
    readonly opt: { transport?: Transport; auth?: Auth };
    readonly envTransport?: string;
    readonly envAuth?: string;
    readonly resource?: string;
    readonly apiKey?: string;
    readonly expected: { transport: Transport; auth: Auth };
  }
  const R = 'https://app.test.example/mcp/memory';
  const cells: readonly Cell[] = [
    { name: '01_empty_input_defaults_to_stdio_none', opt: {}, expected: { transport: 'stdio', auth: 'none' } },
    { name: '02_resource_env_selects_http_oauth', opt: {}, resource: R, expected: { transport: 'streamable-http', auth: 'oauth' } },
    { name: '03_flag_stdio_beats_resource_env', opt: { transport: 'stdio' }, resource: R, expected: { transport: 'stdio', auth: 'none' } },
    { name: '04_env_transport_stdio_beats_resource_env', opt: {}, envTransport: 'stdio', resource: R, expected: { transport: 'stdio', auth: 'none' } },
    { name: '05_flag_http_without_resource_defaults_auth_none', opt: { transport: 'streamable-http' }, expected: { transport: 'streamable-http', auth: 'none' } },
    { name: '06_flag_http_with_resource_selects_oauth', opt: { transport: 'streamable-http' }, resource: R, expected: { transport: 'streamable-http', auth: 'oauth' } },
    { name: '07_flag_auth_none_is_an_explicit_opt_out', opt: { transport: 'streamable-http', auth: 'none' }, resource: R, expected: { transport: 'streamable-http', auth: 'none' } },
    { name: '08_empty_resource_treated_as_absent', opt: {}, resource: '', expected: { transport: 'stdio', auth: 'none' } },
    { name: '09_whitespace_resource_treated_as_absent', opt: {}, resource: '   ', expected: { transport: 'stdio', auth: 'none' } },
    { name: '10_env_transport_http_without_resource_defaults_auth_none', opt: {}, envTransport: 'streamable-http', expected: { transport: 'streamable-http', auth: 'none' } },
    { name: '11_api_key_env_no_longer_selects_anything', opt: {}, apiKey: 'theo_live_x', expected: { transport: 'stdio', auth: 'none' } },
    { name: '12_env_auth_oauth_is_honoured', opt: { transport: 'streamable-http' }, envAuth: 'oauth', expected: { transport: 'streamable-http', auth: 'oauth' } },
    { name: '13_flag_stdio_overrides_env_transport_http', opt: { transport: 'stdio' }, envTransport: 'streamable-http', expected: { transport: 'stdio', auth: 'none' } },
  ];

  it.each(cells)('$name', async ({ opt, envTransport, envAuth, resource, apiKey, expected }) => {
    vi.stubEnv('THEOMEM_MCP_TRANSPORT', envTransport ?? '');
    vi.stubEnv('THEOMEM_MCP_AUTH', envAuth ?? '');
    vi.stubEnv('THEO_MCP_RESOURCE', resource ?? '');
    vi.stubEnv('THEMEMORY_API_KEY', apiKey ?? '');
    const { resolveMcpModes } = await import('./run-mcp-server.js');
    expect(resolveMcpModes(opt)).toEqual(expected);
  });

  it.each(['api-keys', 'oidc', 'both'])('test_removed_auth_mode_%s_in_env_is_refused_not_downgraded', async (mode) => {
    vi.stubEnv('THEOMEM_MCP_AUTH', mode);
    const { resolveMcpModes } = await import('./run-mcp-server.js');
    expect(() => resolveMcpModes({ transport: 'streamable-http' })).toThrow(/removed/);
  });

  it('test_removed_auth_mode_as_flag_is_refused', async () => {
    const { resolveMcpModes } = await import('./run-mcp-server.js');
    expect(() =>
      resolveMcpModes({ transport: 'streamable-http', auth: 'api-keys' as unknown as 'none' }),
    ).toThrow(/removed/);
  });
});

describe('runMcpServer — OAuth resource-server composition (usetheoai/theo#477)', () => {
  it('test_oauth_mode_refuses_to_start_without_the_resource_before_touching_the_database', async () => {
    vi.stubEnv('THEO_OAUTH_ISSUER', 'https://auth.test.example/');
    const { runMcpServer } = await import('./run-mcp-server.js');
    await expect(runMcpServer({ transport: 'streamable-http', auth: 'oauth' })).rejects.toThrow(
      /THEO_MCP_RESOURCE/,
    );
    expect(poolsConstructed).toBe(0);
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_oauth_mode_wires_the_gate_into_the_transport', async () => {
    stubOAuthEnv();
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer({ transport: 'streamable-http', auth: 'oauth' });
    const opts = mockConnectStreamableHttp.mock.calls[0]?.[1] as {
      oauth?: { config: { resource: string } };
      tlsTerminatedUpstream?: boolean;
    };
    expect(opts.oauth?.config.resource).toBe('https://app.test.example/mcp/memory');
    expect(opts.tlsTerminatedUpstream).toBe(false);
  });

  it('test_oauth_mode_serves_over_the_tenant_scoped_pool_with_strict_writes', async () => {
    stubOAuthEnv();
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer({ transport: 'streamable-http', auth: 'oauth' });
    expect(mockAssertRequestPoolIsolated).toHaveBeenCalledTimes(1);
    expect(mockTenantScopedPool).toHaveBeenCalledTimes(1);
    expect(mockRequireStrictWorkspaceWrites).toHaveBeenCalledTimes(1);
  });

  it('test_oauth_mode_refuses_to_start_when_the_role_bypasses_row_level_security', async () => {
    stubOAuthEnv();
    mockAssertRequestPoolIsolated.mockRejectedValueOnce(new Error('role "postgres" is SUPERUSER'));
    const { runMcpServer } = await import('./run-mcp-server.js');
    await expect(runMcpServer({ transport: 'streamable-http', auth: 'oauth' })).rejects.toThrow(
      /row-level security/,
    );
    expect(mockConnectStreamableHttp).not.toHaveBeenCalled();
  });

  it('test_tls_terminated_upstream_env_reaches_the_transport', async () => {
    stubOAuthEnv();
    vi.stubEnv('THEO_MCP_TLS_TERMINATED_UPSTREAM', 'true');
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer({ transport: 'streamable-http', auth: 'oauth' });
    const opts = mockConnectStreamableHttp.mock.calls[0]?.[1] as { tlsTerminatedUpstream?: boolean };
    expect(opts.tlsTerminatedUpstream).toBe(true);
  });

  it('test_tls_terminated_upstream_env_with_an_unrecognised_value_is_refused', async () => {
    stubOAuthEnv();
    vi.stubEnv('THEO_MCP_TLS_TERMINATED_UPSTREAM', 'yes');
    const { runMcpServer } = await import('./run-mcp-server.js');
    await expect(runMcpServer({ transport: 'streamable-http', auth: 'oauth' })).rejects.toThrow(
      /THEO_MCP_TLS_TERMINATED_UPSTREAM/,
    );
  });

  it('test_stdio_stays_single_tenant_over_the_raw_pool', async () => {
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer({ transport: 'stdio' });
    expect(mockTenantScopedPool).not.toHaveBeenCalled();
    expect(mockAssertRequestPoolIsolated).not.toHaveBeenCalled();
  });
});
