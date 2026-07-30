/**
 * T0.1 RED — verbs-as-CLI fix-cycle integration tests (8 assertions).
 *
 * Locks the post-fix-cycle behavioral contract for the 11 MAJORs surfaced by
 * `/review verbs-as-cli-themory-remember-recall-forget-reflect` (2026-06-04).
 *
 * Test map (sub-goal → test → MAJOR):
 *   test 1  — Sub-goal 1 / Theme 1 (reflect parity)        — F-dom-api-1
 *   test 2  — Sub-goal 1 / Theme 1 (CliReflectResult drop) — F-dom-api-1
 *   test 3  — Sub-goal 4 / Theme 3 (fail-fast)             — F-dom-cli-2
 *   test 4  — Sub-goal 4 / Theme 3 (dotenv silence)        — F-dom-cli-1
 *   test 5  — Sub-goal 6 / Theme 4 (locked verbs)          — F-dom-api-3
 *   test 6  — Sub-goal 6 / Theme 4 (locked flags)          — F-dom-api-3
 *   test 7  — Sub-goal 5 / Theme 3 (README docs)           — F-dom-cli-3
 *   test 8  — Sub-goal 5 / Theme 3 (CHANGELOG warm-up)     — F-dom-api-2
 *
 * Plus EC-4 sentinel test 9: agent-tools-memory.ts MUST NOT carry redundant
 * explicit `reflectionPolicy:` wire post-T1.1 default at factory level.
 *
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
const README_PATH = join(REPO_ROOT, 'README.md');
const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');
const CLI_SRC_PATH = join(REPO_ROOT, 'packages', 'cli', 'src', 'cli.ts');
const AGENT_TOOLS_MEMORY_PATH = join(REPO_ROOT, 'packages', 'agent-core', 'src', 'agent-tools-memory.ts');

const DIST_EXISTS = existsSync(CLI_PATH);
const HAS_OPENAI =
  process.env['OPENAI_API_KEY'] !== undefined && process.env['OPENAI_API_KEY'] !== '';
const HAS_PG_URI =
  process.env['THEOMEM_PG_URI'] !== undefined && process.env['THEOMEM_PG_URI'] !== '';

if (!DIST_EXISTS) {
  // eslint-disable-next-line no-console
  console.warn(
    'verbs-cli-fixes SKIP — dist/agent-tools/cli.js missing. Run `npm run build` first.',
  );
}

interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

/**
 * Spawn CLI without injecting DOTENV_CONFIG_QUIET — tests the RUNTIME-shipped
 * silence behavior (T3.1 at top of cli.ts), NOT the test harness workaround.
 */
function runCliRaw(args: readonly string[], extraEnv: Record<string, string> = {}): SpawnResult {
  const t0 = performance.now();
  const result = spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    elapsedMs: performance.now() - t0,
  };
}

describe.skipIf(!DIST_EXISTS)('verbs-as-CLI fix-cycle integration', () => {
  // ─── Theme 1: reflect parity ──────────────────────────────────────────────

  test.skipIf(!HAS_OPENAI || !HAS_PG_URI)(
    'test 1 — reflect --json output uses raw ReflectionResult shape (F-dom-api-1)',
    async () => {
      // Given: a fresh user scope with at least one remembered fact
      const userId = randomUUID();
      const writeResult = runCliRaw([
        'remember',
        'I prefer dark coffee in the morning before the first meeting',
        '--user',
        userId,
      ]);
      expect(
        writeResult.status,
        `remember failed: stdout=${writeResult.stdout} stderr=${writeResult.stderr}`,
      ).toBe(0);

      // When: invoking reflect --json
      const result = runCliRaw(['reflect', '--user', userId]);

      // Then: stdout parses as JSON containing the RAW ReflectionResult keys,
      // NOT the projected CliReflectResult keys.
      expect(
        result.status,
        `reflect failed: stdout=${result.stdout} stderr=${result.stderr}`,
      ).toBe(0);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(parsed).toHaveProperty('higherOrderMemories');
      expect(parsed).toHaveProperty('sourceIds');
      expect(parsed).toHaveProperty('derivedMemoriesCreated');
      expect(parsed).not.toHaveProperty('sourceCount');
      expect(parsed).not.toHaveProperty('derivedCount');
      expect(parsed).not.toHaveProperty('derived');
    },
    120_000,
  );

  test('test 2 — cli-output module does NOT export CliReflectResult (F-dom-api-1 regression sentinel)', async () => {
    const cliOutput = await import('../../../packages/cli/src/cli-output.js');
    // CliReflectResult was a TYPE, not a runtime value — assert by grepping
    // the SOURCE file, which is the only honest signal for a TS interface drop.
    const cliOutputSrcPath = join(REPO_ROOT, 'packages', 'cli', 'src', 'cli-output.ts');
    const src = readFileSync(cliOutputSrcPath, 'utf8');
    expect(src, 'CliReflectResult interface MUST be removed from cli-output.ts').not.toMatch(
      /\bCliReflectResult\b/,
    );
    // Also sanity-check the runtime export surface stays intact.
    expect(cliOutput.renderCliOutput).toBeTypeOf('function');
  });

  // ─── Theme 3: consumer DX ─────────────────────────────────────────────────

  test.skipIf(!HAS_PG_URI)(
    'test 3 — multi-scope fails fast (no Memory-factory warm-up) with exit 2 (F-dom-cli-2)',
    () => {
      // Contract: scope validation rejects mutually-exclusive --user + --session
      // BEFORE the ~2-5s createAgentToolsMemory warm-up (embedder + LLM probe).
      //
      // integration-suite-stabilization (flaky-timing fix): the prior assertion
      // used an ABSOLUTE 2000ms wall-clock budget, which is dominated by node +
      // commander + dotenv cold-start and false-fails under suite load (observed
      // 3174ms in-suite vs 2281ms idle — both WITHOUT any warm-up). The honest,
      // load-robust signal is RELATIVE: the fail-fast path must not be more than
      // a warm-up's worth slower than a plain CLI invocation that also pays only
      // cold-start (`--help` does no factory work). If the handler regressed to
      // warm the factory before validating, that fixed 2-5s cost would push the
      // delta past the floor below, regardless of absolute machine speed.
      const WARMUP_FLOOR_MS = 1500;

      const baseline = runCliRaw(['--help']);
      const result = runCliRaw([
        'remember',
        'fact-that-never-persists',
        '--user',
        'alice',
        '--session',
        'sess-123',
      ]);

      // Then: exit code 2 + the validation error (proves validation ran), AND
      // the fail-fast path added no factory-warm-up cost over plain cold-start.
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/exactly one required/);
      const overheadMs = result.elapsedMs - baseline.elapsedMs;
      expect(
        overheadMs,
        `fail-fast added ${overheadMs.toFixed(0)}ms over \`--help\` cold-start ` +
          `(baseline ${baseline.elapsedMs.toFixed(0)}ms, fail ${result.elapsedMs.toFixed(0)}ms) ` +
          `— handler likely warmed the Memory factory BEFORE scope validation`,
      ).toBeLessThan(WARMUP_FLOOR_MS);
    },
    30_000,
  );

  test('test 4 — cli --help stdout clean of dotenv banner (F-dom-cli-1)', () => {
    // Run WITHOUT DOTENV_CONFIG_QUIET in env — runtime silence must come
    // from the cli.ts top-of-module mutation (T3.1), NOT from a test harness env.
    const env = { ...process.env };
    delete env['DOTENV_CONFIG_QUIET'];

    const t0 = performance.now();
    const result = spawnSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf8',
      timeout: 10_000,
      env,
    });

    const stdout = result.stdout ?? '';
    expect(stdout).not.toMatch(/◇\s*injected\s+env/);
    // Sanity check that --help printed something meaningful (commander
    // help text starts with the program name 'Usage:').
    expect(stdout).toMatch(/Usage:\s+themory/);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });

  // ─── Theme 4: locked names ────────────────────────────────────────────────

  test('test 5 — cli.ts contains the 4 locked verb-command names INSIDE .command() (F-dom-api-3 + ADR D6 regex-pinned)', () => {
    const src = readFileSync(CLI_SRC_PATH, 'utf8');
    // verbs-as-cli-fixes-cycle-2 T3.3 / ADR D6: regex-pinned to .command()
    // call site (M6 closure) — substring grep would match comments + other
    // contexts; the regex requires the verb to be inside `.command(...)`.
    expect(src).toMatch(/\.command\(\s*['"]remember <text>['"]/);
    expect(src).toMatch(/\.command\(\s*['"]recall <query>['"]/);
    expect(src).toMatch(/\.command\(\s*['"]forget <id>['"]/);
    expect(src).toMatch(/\.command\(\s*['"]reflect['"]/);
  });

  test('test 6 — cli.ts contains all 9 locked flag strings INSIDE .option() (F-dom-api-3 + EC-4 boundary char)', () => {
    const src = readFileSync(CLI_SRC_PATH, 'utf8');
    // verbs-as-cli-fixes-cycle-2 T3.3 / ADR D6 + EC-4: regex pinned to
    // .option() WITH BOUNDARY CHAR after flag name. Boundary char class
    // [\s'"<] prevents false-positive matches against `--user-name` (compound
    // option) AND against `parseIntInRange('--top-k', 1, 100)` factory args.
    const FLAGS_WITH_BOUNDARY: readonly RegExp[] = [
      /\.option\(\s*['"]--user[\s'"<]/,
      /\.option\(\s*['"]--session[\s'"<]/,
      /\.option\(\s*['"]--agent[\s'"<]/,
      /\.option\(\s*['"]--top-k[\s'"<]/,
      /\.option\(\s*['"]--threshold[\s'"<]/,
      /\.option\(\s*['"]--diversify[\s'"<]/,
      /\.option\(\s*['"]--hard[\s'"<]/,
      /\.option\(\s*['"]--json[\s'"<]/,
      /\.option\(\s*['"]--text[\s'"<]/,
    ];
    for (const pattern of FLAGS_WITH_BOUNDARY) {
      expect(src, `cli.ts missing flag matching ${pattern.source}`).toMatch(pattern);
    }
  });

  // ─── Theme 3 (docs): README + CHANGELOG ───────────────────────────────────

  test('test 7 — README has ## CLI verbs section AND all 4 verb names (F-dom-cli-3)', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    // A propriedade e "os quatro verbos estao documentados na secao de CLI", NAO "existe um titulo
    // com estas duas palavras exatas". O README foi reestruturado para `## CLI` com uma subsecao
    // `### Memory verbs` — mais claro, e o conteudo exigido continua todo la. A versao anterior
    // prendia-se a `/^##\s+CLI\s+verbs$/` e ficou VERMELHA na arvore por uma renomeacao de titulo,
    // enquanto um README que perdesse os verbos passaria contanto que mantivesse o titulo.
    //
    // Testar o titulo era testar a implementacao; testar os verbos e testar o contrato.
    const cliVerbsIndex = readme.search(/^##\s+CLI\s*$/m);
    expect(cliVerbsIndex, 'o README precisa de uma secao `## CLI`').toBeGreaterThan(-1);
    const afterCliVerbs = readme.slice(cliVerbsIndex);
    expect(afterCliVerbs).toMatch(/\bremember\b/);
    expect(afterCliVerbs).toMatch(/\brecall\b/);
    expect(afterCliVerbs).toMatch(/\bforget\b/);
    expect(afterCliVerbs).toMatch(/\breflect\b/);
  });

  test('test 8 — CHANGELOG documents the CLI/MCP warm-up cost (F-dom-api-2)', () => {
    // integration-suite-stabilization (stale-assertion triage, D2): the warm-up
    // caveat was authored in [Unreleased] while verbs-as-CLI was unreleased; it
    // SHIPPED in v0.3.0, so per CHANGELOG discipline (Inquebravel Rule 6) the
    // entry correctly moved under [0.3.0] and MUST NOT be re-duplicated into
    // [Unreleased]. The operator-facing contract is "the warm-up cost is
    // documented in the CHANGELOG", not "in [Unreleased] forever" — assert the
    // durable contract.
    const changelog = readFileSync(CHANGELOG_PATH, 'utf8');
    // The CHANGELOG MUST still carry a [Unreleased] header (Keep a Changelog).
    expect(changelog, '[Unreleased] section MUST exist in CHANGELOG').toMatch(
      /^##\s*\[Unreleased\]\s*$/m,
    );
    // Warm-up caveat must be documented somewhere — match any equivalent phrasing.
    expect(changelog).toMatch(/warm[\s-]?up|2-5s|cold[\s-]?start/i);
  });

  // ─── EC-4 sentinel — DRY hardening source ─────────────────────────────────

  test('test 9 — agent-tools-memory.ts MUST NOT carry redundant explicit reflectionPolicy wire (EC-4)', () => {
    if (!existsSync(AGENT_TOOLS_MEMORY_PATH)) {
      // Before T2.1 rename, the file does not exist — test is naturally RED.
      throw new Error(
        `agent-tools-memory.ts not yet created at ${AGENT_TOOLS_MEMORY_PATH} (expected post-T2.1 rename).`,
      );
    }
    const src = readFileSync(AGENT_TOOLS_MEMORY_PATH, 'utf8');
    // Post-T1.1 default at factory level, explicit reflectionPolicy: wire is
    // dead code AND a DRY violation visible at the refactor source. JSDoc
    // mentions are expected (the file documents the EC-4 absorption); strip
    // JSDoc + line comments before regex match so only EXECUTABLE code is
    // sentinel-checked.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // strip /* ... */ block comments
      .replace(/\/\/.*$/gm, ''); // strip // line comments
    expect(
      codeOnly,
      'agent-tools-memory.ts SHOULD rely on createLocalMemory factory default — no explicit reflectionPolicy: wire',
    ).not.toMatch(/reflectionPolicy\s*:/);
  });
});
