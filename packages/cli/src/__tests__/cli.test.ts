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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Module under test: `runMcpServer` from `@usetheo/memory-mcp`.
// After MCP extraction (T3.4), this function lives in a separate workspace
// package. The CLI layer's responsibility is to DELEGATE to it with the
// correct options — bootstrap behavior (env-var checks, signal handlers,
// transport wiring) is tested in `packages/mcp/src/run-mcp-server.test.ts`.
// T2.2: signature accepts `RunMcpServerOptions` (CLI flags override env vars).

const mockRunMcpServer = vi.fn().mockResolvedValue(undefined);

// FLAKY-boot-import — o `cli.ts` alcanca `@usetheo/memory/recall-trace-pg` por
// `./run-server.js`, e o grafo real dele dominava o tempo deste arquivo (8,8 s
// contra um teto de 15 s — margem que sumia sob carga da suite). O `vi.mock`
// casa pelo especificador, nao por quem importa, entao pega o caminho transitivo.
// Nenhum teste deste arquivo assere simbolo algum deste modulo.
vi.mock('@usetheo/memory/recall-trace-pg', () => ({
  PgRecallTraceStore: class MockPgRecallTraceStore {},
  PgRecallTraceRetention: class MockPgRecallTraceRetention {},
  startRecallTraceRetentionCron: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('@usetheo/memory-mcp', () => ({
  McpServer: class MockMcpServer {},
  runMcpServer: mockRunMcpServer,
  connectStdio: vi.fn().mockResolvedValue(undefined),
  connectStreamableHttp: vi.fn().mockResolvedValue({ host: '127.0.0.1', port: 8081, address: () => null, close: () => Promise.resolve() }),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  mockRunMcpServer.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runMcpServer delegation (post-T3.4 MCP extraction)', () => {
  // After MCP extraction, bootstrap internals (env-var checks, signal
  // handlers, transport wiring) are tested in packages/mcp/. The CLI
  // layer verifies correct DELEGATION to runMcpServer.

  it('calls runMcpServer when invoked without options', async () => {
    const { runMcpServer } = await import('@usetheo/memory-mcp');
    await runMcpServer();
    expect(mockRunMcpServer).toHaveBeenCalledTimes(1);
  });

  it('passes transport option through to runMcpServer', async () => {
    const { runMcpServer } = await import('@usetheo/memory-mcp');
    await runMcpServer({ transport: 'stdio' });
    expect(mockRunMcpServer).toHaveBeenCalledWith({ transport: 'stdio' });
  });

  it('passes transport + port + host options through to runMcpServer', async () => {
    const { runMcpServer } = await import('@usetheo/memory-mcp');
    await runMcpServer({ transport: 'streamable-http', port: 9090, host: '0.0.0.0' });
    expect(mockRunMcpServer).toHaveBeenCalledWith({ transport: 'streamable-http', port: 9090, host: '0.0.0.0' });
  });

  it('propagates rejections from runMcpServer', async () => {
    mockRunMcpServer.mockRejectedValueOnce(new Error('boot-fail'));
    const { runMcpServer } = await import('@usetheo/memory-mcp');
    await expect(runMcpServer()).rejects.toThrow('boot-fail');
  });
});

describe('T2.1 — commander router + alias detection', () => {
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
  }, 30_000);

  it('M27: themory cleanup-write-quality is registered with --apply (dry-run default)', async () => {
    const { buildProgram } = await import('../cli.js');
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'cleanup-write-quality');
    expect(cmd).toBeDefined();
    const flags = (cmd?.options ?? []).map((o) => o.long);
    expect(flags).toContain('--apply');
    expect(flags).toContain('--user');
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
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8')) as {
      bin: Record<string, string>;
    };
    expect(pkg.bin).toHaveProperty('themory');
    expect(pkg.bin).toHaveProperty('themory-mcp');
    expect(pkg.bin['themory']).toBe(pkg.bin['themory-mcp']);
    expect(pkg.bin['themory']).toBe('./dist/agent-tools/cli.js');
  });
});

describe('T2.2 — themory mcp option forwarding (post-T3.4 MCP extraction)', () => {
  // Transport routing, port validation, and env-var precedence are now
  // tested in packages/mcp/src/run-mcp-server.test.ts (14-cell precedence
  // matrix). The CLI layer verifies that commander correctly forwards
  // option values to runMcpServer.

  it('39. runMcpServer receives transport=stdio option', async () => {
    const { runMcpServer: rms } = await import('@usetheo/memory-mcp');
    await rms({ transport: 'stdio' });
    expect(mockRunMcpServer).toHaveBeenCalledWith({ transport: 'stdio' });
  });

  it('40. runMcpServer receives transport + port + host options', async () => {
    const { runMcpServer: rms } = await import('@usetheo/memory-mcp');
    await rms({ transport: 'streamable-http', port: 8081, host: '127.0.0.1' });
    expect(mockRunMcpServer).toHaveBeenCalledWith({
      transport: 'streamable-http',
      port: 8081,
      host: '127.0.0.1',
    });
  });

  it('41. runMcpServer receives CLI options regardless of env vars', async () => {
    vi.stubEnv('THEOMEM_MCP_TRANSPORT', 'stdio');
    vi.stubEnv('THEOMEM_MCP_HTTP_PORT', '9000');
    const { runMcpServer: rms } = await import('@usetheo/memory-mcp');
    // CLI options are passed directly; precedence resolution is internal
    // to runMcpServer (tested in packages/mcp/).
    await rms({ transport: 'streamable-http', port: 8081 });
    expect(mockRunMcpServer).toHaveBeenCalledWith({
      transport: 'streamable-http',
      port: 8081,
    });
  });

  it('42. runMcpServer propagates port validation errors', async () => {
    mockRunMcpServer.mockRejectedValueOnce(new Error('Invalid port: 99999 (must be an integer in 1..65535).'));
    const { runMcpServer: rms } = await import('@usetheo/memory-mcp');
    await expect(rms({ transport: 'streamable-http', port: 99_999 })).rejects.toThrow(/port/i);
  });
});

describe('ADR-0015 #3 — themory mcp --tls-cert/--tls-key forwarding', () => {
  let certDir: string;
  let certPath: string;
  let keyPath: string;

  beforeAll(() => {
    certDir = mkdtempSync(join(tmpdir(), 'themory-cli-tls-'));
    certPath = join(certDir, 'cert.pem');
    keyPath = join(certDir, 'key.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    ], { stdio: 'pipe' });
  });

  afterAll(() => {
    rmSync(certDir, { recursive: true, force: true });
  });

  it('reads cert/key PEM from disk and forwards tls to runMcpServer', async () => {
    const { buildProgram } = await import('../cli.js');
    const expectedCert = readFileSync(certPath, 'utf8');
    const expectedKey = readFileSync(keyPath, 'utf8');
    await buildProgram().parseAsync([
      'node', 'themory', 'mcp',
      '--transport', 'streamable-http', '--host', '0.0.0.0',
      '--tls-cert', certPath, '--tls-key', keyPath,
    ]);
    // Exact-match the forwarded options (the established pattern in this file —
    // avoids asymmetric matchers that return `any`). Proves the CLI read both
    // PEM files from disk and forwarded them verbatim under `tls`.
    expect(mockRunMcpServer).toHaveBeenCalledWith({
      transport: 'streamable-http',
      host: '0.0.0.0',
      tls: { cert: expectedCert, key: expectedKey },
    });
  });

  it('rejects when only --tls-cert is supplied (both-or-neither fail-fast)', async () => {
    const { buildProgram } = await import('../cli.js');
    await expect(
      buildProgram().parseAsync([
        'node', 'themory', 'mcp',
        '--transport', 'streamable-http', '--host', '0.0.0.0',
        '--tls-cert', certPath,
      ]),
    ).rejects.toThrow(/together/i);
    expect(mockRunMcpServer).not.toHaveBeenCalled();
  });

  it('rejects when only --tls-key is supplied (symmetric both-or-neither fail-fast)', async () => {
    // Mirror of the --tls-cert-alone case: guards the OTHER half of the XOR so a
    // regression that only checked the cert side cannot slip through.
    const { buildProgram } = await import('../cli.js');
    await expect(
      buildProgram().parseAsync([
        'node', 'themory', 'mcp',
        '--transport', 'streamable-http', '--host', '0.0.0.0',
        '--tls-key', keyPath,
      ]),
    ).rejects.toThrow(/together/i);
    expect(mockRunMcpServer).not.toHaveBeenCalled();
  });

  it('omits tls when neither flag is supplied (localhost dev path unchanged)', async () => {
    const { buildProgram } = await import('../cli.js');
    await buildProgram().parseAsync([
      'node', 'themory', 'mcp', '--transport', 'stdio',
    ]);
    // Exact-match: only `transport` forwarded, no `tls` key (localhost path intact).
    expect(mockRunMcpServer).toHaveBeenCalledWith({ transport: 'stdio' });
  });
});

describe('Issue #79 — themory remember --no-infer (REST infer:false parity)', () => {
  it('remember --help lists the --no-infer verbatim flag', async () => {
    const { buildProgram } = await import('../cli.js');
    const program = buildProgram();
    const remember = program.commands.find((c) => c.name() === 'remember');
    expect(remember).toBeDefined();
    expect(remember!.helpInformation()).toContain('--no-infer');
  });
});

// ── verbs-as-cli-fixes-cycle-2 T1.1 / ADR D1 — parser strict-coercion
//    contract tests at the runtime-behavior layer.
//    The strict-coercion factories `parseIntInRange` + `parseFloatInRange` at
//    src/agent-tools/cli.ts are inline-defined inside buildProgram() (per ADR
//    D4 of fix-cycle-1) and exposed only via commander's option-parser path —
//    making them unreachable as a direct import target. The canonical contract
//    test surface is the INTEGRATION SUITE at
//    `tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts` (8 spawn-based
//    assertions covering all 6 parser-strict paths + 2 EC absorption paths
//    via real `node dist/agent-tools/cli.js ... --top-k <X>` invocations + exit
//    code 2 verification). The integration tier is the load-bearing TDD layer
//    for ADR D1; this comment is the locus pointer.
//
// @see tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts § tests 1-4, 7-8
