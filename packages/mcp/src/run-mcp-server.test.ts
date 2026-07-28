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
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPoolEnd = vi.fn();
const mockRunMigrations = vi.fn();
const mockCreateLocalMemory = vi.fn();
const mockMcpServerStop = vi.fn();
const mockConnectStdio = vi.fn();
const mockConnectStreamableHttp = vi.fn();

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
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
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
  it('FC2-T1.1 — runMcpServer writes the real-providers disclosure to stderr on startup', async () => {
    // Post-e43d801: stub-embedder warning is REMOVED. The replacement banner
    // announces real providers (LocalTransformerEmbedder + OpenAILLM).
    process.env['OPENAI_API_KEY'] = 'sk-fake-test-key-for-boot';
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    expect(captured).toMatch(/real providers wired/i);
    expect(captured).toMatch(/themory mcp/i);
  });
});

describe('T3.1 — runMcpServer transport+auth disclosure (ADR D3)', () => {
  it('test_stderr_discloses_env_driven_http_path_when_no_explicit_flag', async () => {
    // Given: THEMEMORY_API_KEY env present, no --transport/--auth flag, no env override
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummy_for_disclosure_test');
    // When: runMcpServer invoked with empty opts (Tier-3 heuristic fires)
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    // Then: disclosure line announces auto-selected HTTP + api-keys + override hint
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    expect(captured).toMatch(/transport=streamable-http/);
    expect(captured).toMatch(/auth=api-keys/);
    expect(captured).toMatch(/THEMEMORY_API_KEY present/);
    expect(captured).toMatch(/--transport=stdio.*override/);
  });

  it('test_stderr_discloses_stdio_default_with_hint', async () => {
    // Given: no env (beforeEach stubbed THEMEMORY_API_KEY='') — stdio default fires
    // When: runMcpServer invoked
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    // Then: disclosure line hints at HTTP+Bearer mode via env
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    expect(captured).toMatch(/transport=stdio/);
    expect(captured).toMatch(/default/);
    expect(captured).toMatch(/set THEMEMORY_API_KEY for HTTP\+Bearer mode/);
  });

  it('test_stderr_explicit_flag_suppresses_disclosure', async () => {
    // ADR D3 invariant: explicit operator intent (CLI flag OR scoped env)
    // suppresses the disclosure — no need to announce what was explicit.
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummy_should_be_silent_under_explicit_flag');
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer({ transport: 'stdio' });
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    // FC2-T1.1 "real providers wired" line stays unconditional (NOT suppressed)
    expect(captured).toMatch(/real providers wired/);
    // But the NEW T3.1 transport+auth disclosure block is suppressed
    expect(captured).not.toMatch(/transport=stdio \(default;/);
    expect(captured).not.toMatch(/transport=streamable-http \+ auth=api-keys/);
  });

  it('test_stderr_quiet_env_suppresses_disclosure_under_env_driven_http', async () => {
    // EC-6 escape: THEOMEM_MCP_QUIET=1 suppresses the new disclosure block
    // (embedded use case where stderr is captured by the consumer). MUST NOT
    // suppress the pre-existing "real providers wired" line (FC2-T1.1 contract).
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummy_under_quiet_env');
    vi.stubEnv('THEOMEM_MCP_QUIET', '1');
    const { runMcpServer } = await import('./run-mcp-server.js');
    await runMcpServer();
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    // FC2-T1.1 line still fires (scope discipline)
    expect(captured).toMatch(/real providers wired/);
    // EC-6 disclosure block suppressed even though env-driven HTTP path activated
    expect(captured).not.toMatch(/transport=streamable-http \+ auth=api-keys/);
    expect(captured).not.toMatch(/THEMEMORY_API_KEY present/);
  });
});

describe('T4.1 — resolveMcpModes 14-cell precedence matrix (ADR D1 + ADR D2 + EC-1 + EC-3)', () => {
  type Transport = 'stdio' | 'streamable-http';
  type Auth = 'none' | 'api-keys' | 'oidc' | 'both';

  interface MatrixCell {
    readonly name: string;
    readonly opt: { transport?: Transport; auth?: Auth };
    readonly envTransport?: string;
    readonly envAuth?: string;
    readonly apiKey?: string;
    readonly expected: { transport: Transport; auth: Auth };
  }

  const MATRIX: readonly MatrixCell[] = [
    // Cell 01 — empty input → defaults
    { name: '01_empty_input_defaults_to_stdio_none', opt: {}, expected: { transport: 'stdio', auth: 'none' } },

    // Cell 02 — Tier-3 heuristic fires (key present, no flags, no env)
    { name: '02_only_api_key_env_triggers_http_api_keys', opt: {}, apiKey: 'theo_live_x', expected: { transport: 'streamable-http', auth: 'api-keys' } },

    // Cell 03 — Tier-1 flag beats Tier-3 heuristic (ADR D1)
    { name: '03_flag_stdio_beats_api_key_env_presence', opt: { transport: 'stdio' }, apiKey: 'theo_live_x', expected: { transport: 'stdio', auth: 'none' } },

    // Cell 04 — Tier-2 env beats Tier-3 heuristic (ADR D1)
    { name: '04_env_transport_stdio_beats_api_key_env_presence', opt: {}, envTransport: 'stdio', apiKey: 'theo_live_x', expected: { transport: 'stdio', auth: 'none' } },

    // Cell 05 — flag http without key → auth defaults none
    { name: '05_flag_http_without_api_key_defaults_auth_none', opt: { transport: 'streamable-http' }, expected: { transport: 'streamable-http', auth: 'none' } },

    // Cell 06 — flag http + key → Tier-3 auth-mode heuristic fires
    { name: '06_flag_http_with_api_key_triggers_auth_api_keys', opt: { transport: 'streamable-http' }, apiKey: 'theo_live_x', expected: { transport: 'streamable-http', auth: 'api-keys' } },

    // Cell 07 — ADR D2 explicit opt-out: flag auth=none MUST win over Tier-3 heuristic
    { name: '07_flag_auth_none_overrides_env_driven_api_keys_heuristic', opt: { transport: 'streamable-http', auth: 'none' }, apiKey: 'theo_live_x', expected: { transport: 'streamable-http', auth: 'none' } },

    // Cell 08 — EC-1 empty-string key treated as absent
    { name: '08_empty_string_api_key_treated_as_absent', opt: {}, apiKey: '', expected: { transport: 'stdio', auth: 'none' } },

    // Cell 09 — EC-1 whitespace-only key treated as absent
    { name: '09_whitespace_only_api_key_treated_as_absent_ec1', opt: {}, apiKey: '   ', expected: { transport: 'stdio', auth: 'none' } },

    // Cell 10 — env-transport http without key → auth defaults none
    { name: '10_env_transport_http_without_key_defaults_auth_none', opt: {}, envTransport: 'streamable-http', expected: { transport: 'streamable-http', auth: 'none' } },

    // Cell 11 — env-transport http + key → both Tier-2 + Tier-3 fire
    { name: '11_env_transport_http_with_api_key_triggers_auth_api_keys', opt: {}, envTransport: 'streamable-http', apiKey: 'theo_live_x', expected: { transport: 'streamable-http', auth: 'api-keys' } },

    // Cell 12 — ADR D2: env-auth wins over Tier-3 heuristic (Tier-2 strictly above Tier-3)
    { name: '12_env_auth_oidc_overrides_tier3_api_keys_heuristic', opt: {}, envTransport: 'streamable-http', envAuth: 'oidc', apiKey: 'theo_live_x', expected: { transport: 'streamable-http', auth: 'oidc' } },

    // Cell 13 — Tier-1 flag beats Tier-2 env (precedence ladder)
    { name: '13_flag_stdio_overrides_env_transport_http', opt: { transport: 'stdio' }, envTransport: 'streamable-http', expected: { transport: 'stdio', auth: 'none' } },

    // Cell 14 — EC-3: garbage env transport falls through to Tier-3 (with key set)
    { name: '14_garbage_env_transport_falls_through_to_tier3', opt: {}, envTransport: 'streamablehttp', apiKey: 'theo_live_x', expected: { transport: 'streamable-http', auth: 'api-keys' } },
  ];

  it.each(MATRIX)('cell $name', async ({ opt, envTransport, envAuth, apiKey, expected }) => {
    // Per-cell env stubs (beforeEach defaulted them to '' for isolation)
    if (envTransport !== undefined) vi.stubEnv('THEOMEM_MCP_TRANSPORT', envTransport);
    if (envAuth !== undefined) vi.stubEnv('THEOMEM_MCP_AUTH', envAuth);
    if (apiKey !== undefined) vi.stubEnv('THEMEMORY_API_KEY', apiKey);
    const { resolveMcpModes } = await import('./run-mcp-server.js');
    const result = resolveMcpModes(opt);
    expect(result.transport).toBe(expected.transport);
    expect(result.auth).toBe(expected.auth);
  });
});

describe('resolveBearerAuth — requireCredential wiring (M16 #84)', () => {
  it('test_env_require_credential_reaches_bearer_options', async () => {
    const { resolveBearerAuth } = await import('./run-mcp-server.js');
    const fakePool = {} as unknown as Pool;
    const prev = process.env['THEMEMORY_REQUIRE_CREDENTIAL'];
    process.env['THEMEMORY_REQUIRE_CREDENTIAL'] = 'true';
    try {
      const opts = await resolveBearerAuth('api-keys', fakePool, { host: '127.0.0.1', port: 0 });
      // Without this, the #84 fail-closed gate in withBearerAuth is inert in production —
      // the operator sets the env and nothing changes.
      expect(opts?.requireCredential).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['THEMEMORY_REQUIRE_CREDENTIAL'];
      else process.env['THEMEMORY_REQUIRE_CREDENTIAL'] = prev;
    }
  });

  it('test_require_credential_absent_by_default', async () => {
    const { resolveBearerAuth } = await import('./run-mcp-server.js');
    const fakePool = {} as unknown as Pool;
    const prev = process.env['THEMEMORY_REQUIRE_CREDENTIAL'];
    delete process.env['THEMEMORY_REQUIRE_CREDENTIAL'];
    try {
      const opts = await resolveBearerAuth('api-keys', fakePool, { host: '127.0.0.1', port: 0 });
      expect(opts?.requireCredential).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env['THEMEMORY_REQUIRE_CREDENTIAL'] = prev;
    }
  });
});
