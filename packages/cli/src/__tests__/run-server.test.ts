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

const mockRequireStrictWorkspaceWrites = vi.fn();
const mockAssertRequestPoolIsolated = vi.fn(() =>
  Promise.resolve({ role: 'themory_app', superuser: false, bypassRls: false }),
);
const mockAssertBackgroundPoolCrossWorkspace = vi.fn(() =>
  Promise.resolve({ role: 'themory_worker', bypassRls: false, policy: 'recall_traces_worker_cross_workspace' }),
);

vi.mock('@usetheo/memory', () => ({
  createLocalMemory: mockCreateLocalMemory,
  runMigrations: mockRunMigrations,
  StubEmbedder: class MockStubEmbedder {},
  StubLLM: class MockStubLLM {},
  PgvectorStore: class MockPgvectorStore {},
  PgMemoryEntityStore: class MockPgMemoryEntityStore {},
  PgMemoryGraphStore: class MockPgMemoryGraphStore {},
  PgUsageCounterStore: class MockPgUsageCounterStore {},
  // M11/M13 full-suite fix: run-server.ts also imports these two — the mock
  // must mirror the import list or vitest fails the whole file at load.
  PgRoutingPolicyStore: class MockPgRoutingPolicyStore {},
  PgRoutingAuditStore: class MockPgRoutingAuditStore {},
  // Tenant isolation (migration 0029): runServer wraps the raw pool so every
  // store receives the workspace-scoped view. Identity here — these tests assert
  // composition wiring, not RLS behaviour, which is covered against a real
  // database in the integration suite.
  tenantScopedPool: (p: unknown) => p,
  // O guard de modo de escrita: o servidor multi-inquilino o chama DEPOIS da
  // fiação e se recusa a subir se os stores tiverem sido construídos sobre um
  // pool cru. O que este arquivo prova é que a chamada existe e acontece na
  // ordem certa; o COMPORTAMENTO do guard é provado sem banco em
  // packages/core/src/infrastructure/db/workspace-write-scope.unit.test.ts.
  requireStrictWorkspaceWrites: mockRequireStrictWorkspaceWrites,
  // O guard que mede se o papel do banco é contido pelas policies. O servidor o
  // chama ANTES de bindar a porta; o comportamento dele é provado sem banco em
  // packages/core/src/infrastructure/db/request-pool-guard.unit.test.ts e contra
  // papéis reais em tests/integration/tenant-isolation/request-pool-guard.test.ts.
  assertRequestPoolIsolated: mockAssertRequestPoolIsolated,
  assertBackgroundPoolCrossWorkspace: mockAssertBackgroundPoolCrossWorkspace,
}));

// FLAKY-boot-import — `run-server.ts` importa `@usetheo/memory-agent-core` e
// `@usetheo/memory/recall-trace-pg` sem mock. O `await import('../run-server.js')` de cada teste pagava a
// transformacao do grafo REAL desses tres pacotes: 10-14 s medidos em isolamento
// contra um teto de 15 s. Sob carga da suite completa a margem sumia, e os
// testes falhavam de forma intermitente (medido: 0 / 3 / 4 falhas em tres runs
// da mesma arvore).
//
// Nenhum teste deste arquivo assere qualquer simbolo destes tres pacotes — o
// sujeito aqui e a ORDEM de `runServer` (migrar antes de bindar) e a porta.
// Mockar uma fronteira que o teste nao exercita e teste unitario correto, nao
// remendo: aumentar o teto e que esconderia o custo em vez de remove-lo.
vi.mock('@usetheo/memory/recall-trace-pg', () => ({
  PgRecallTraceStore: class MockPgRecallTraceStore {},
  PgRecallTraceRetention: class MockPgRecallTraceRetention {},
  startRecallTraceRetentionCron: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('@usetheo/memory/embedders/stub', () => ({
  DeterministicStubEmbedder: class MockDeterministicStubEmbedder {
    async embed(): Promise<readonly number[]> {
      return [0.1, 0.2, 0.3];
    }
    async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      return texts.map(() => [0.1, 0.2, 0.3]);
    }
  },
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
  // T3.2 alignment — run-server.ts hard-fails on missing OPENAI_API_KEY.
  vi.stubEnv('OPENAI_API_KEY', 'sk-fake-test-key-for-boot');
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  stderrSpy.mockRestore();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('T2.3 — runServer composition contract', () => {
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
  it('43. binds port 9999 via @hono/node-server serve', async () => {
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9999 });
    expect(mockServeListener).toHaveBeenCalledTimes(1);
    expect(mockServeListener.mock.calls[0]?.[0]).toMatchObject({ port: 9999 });
  }, 30_000);

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

    // O guard de modo de escrita roda DEPOIS da fiação e ANTES de a instância
    // ficar pronta. Se ele parasse de ser chamado, um servidor multi-inquilino
    // construído sobre um pool cru subiria e gravaria tudo no balde `default`
    // até alguém ler o banco e estranhar — que é o modo de falha que este
    // trabalho inteiro existe para eliminar.
    expect(mockRequireStrictWorkspaceWrites).toHaveBeenCalled();
    // E o guard do pool de requisição, que é a pré-condição de tudo: sem ele o
    // servidor pode subir sobre um papel que ignora RLS, e aí nenhuma das outras
    // camadas está protegendo nada.
    expect(mockAssertRequestPoolIsolated).toHaveBeenCalled();
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

  it('FC1-T2.2. runServer writes the real-providers disclosure to stderr on startup (post-T3.2)', async () => {
    // Post-T3.2 (mirror of MCP e43d801): stub-embedder warning REMOVED;
    // replacement banner announces real providers (LocalTransformerEmbedder
    // + OpenAILLM).
    process.env['OPENAI_API_KEY'] = 'sk-fake-test-key-for-boot';
    const { runServer } = await import('../run-server.js');
    await runServer({ port: 9991 });
    const captured = stderrSpy.mock.calls.flat().map((arg: unknown) => String(arg)).join(' ');
    expect(captured).toMatch(/real providers wired/i);
    expect(captured).toMatch(/themory server/i);
  });
});
