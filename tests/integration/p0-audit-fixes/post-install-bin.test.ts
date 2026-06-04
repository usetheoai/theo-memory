/**
 * T0.1 RED — post-install bin contract sentinel.
 *
 * Locks the post-install behavioral contract that the parent plan's T3.3 dist
 * sentinel could NOT catch: `npm pack` produces a tarball whose extracted tree
 * lets `node -e "require('./dist/agent-tools/cli.js')"` succeed end-to-end.
 *
 * Background:
 *   - `package.json#bin` points BOTH `themory` and `themory-mcp` at
 *     `./dist/agent-tools/cli.js`.
 *   - `dist/agent-tools/cli.js` imports its 4 subcommand modules via relative
 *     paths: `./run-mcp-server.js`, `./run-server.js`, `./run-migrate.js`,
 *     `./run-health.js`.
 *   - Pre-fix, `package.json#files` declares source-only — so `npm install
 *     @usetheo/memory` ships only the auto-included `cli.js` (npm bin auto-include
 *     behavior); the 4 siblings are missing and `require()` would throw
 *     `Cannot find module './run-mcp-server.js'`.
 *   - EC-1 (MUST FIX absorbed in plan v1.1): the same gap exists for
 *     `dist/local/migrations/*.sql` — `runMigrations()` at
 *     `src/local/index.ts:1452-1456` resolves migrationsFolder via
 *     `dirname(fileURLToPath(import.meta.url)) + 'migrations'` which lands at
 *     `dist/local/migrations/`. Without those .sql in the pack, `themory
 *     migrate` post-install reproduces the F-T7-1-3 regression registered in
 *     `architecture.md § 10.1`.
 *
 * EC-4 prereq (DOCUMENT absorbed in plan v1.1): Requires npm >= 7 for
 * `--json` + `--pack-destination` flags. Node 22 bundles npm 10+ so CI on
 * recent Node satisfies. Older CI runtimes (npm 6 from Node 14) would
 * fail this test for a missing flag, NOT for a real regression — surface
 * that distinction in the SKIP message.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-plan.md § T0.1
 * @see .claude/rules/architecture.md § 10.1 (F-T7-1-3 publish-readiness regression class)
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const DIST_CLI = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
const DIST_EXISTS = existsSync(DIST_CLI);
const NPM_PROBE = spawnSync('npm', ['--version'], { encoding: 'utf8' });
const NPM_AVAILABLE = NPM_PROBE.status === 0;
const TAR_PROBE = spawnSync('tar', ['--version'], { encoding: 'utf8' });
const TAR_AVAILABLE = TAR_PROBE.status === 0;

if (!DIST_EXISTS) {
  // eslint-disable-next-line no-console
  console.warn(
    'T0.1 SKIP — dist/agent-tools/cli.js missing. Run `npm run build` before this test (per plan EC-3 absorption; T4.1 § Execution prepends `npm run build`).',
  );
}
if (!NPM_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    'T0.1 SKIP — npm binary not available on PATH (EC-4 prereq: npm >= 7 required for --json + --pack-destination).',
  );
}
if (!TAR_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn('T0.1 SKIP — tar binary not available on PATH.');
}

const SIBLINGS = [
  'run-mcp-server.js',
  'run-server.js',
  'run-migrate.js',
  'run-health.js',
] as const;

const D_TS_SIBLINGS = [
  'run-mcp-server.d.ts',
  'run-server.d.ts',
  'run-migrate.d.ts',
  'run-health.d.ts',
] as const;

interface PackFileEntry {
  readonly path: string;
}
interface PackResult {
  readonly name: string;
  readonly version: string;
  readonly files: readonly PackFileEntry[];
  readonly entryCount: number;
}

let packDir = '';
let extractDir = '';
let packResult: PackResult | undefined;
let extractedPackageDir = '';

describe.skipIf(!DIST_EXISTS || !NPM_AVAILABLE || !TAR_AVAILABLE)(
  'T0.1 — post-install bin contract sentinel',
  () => {
    beforeAll(() => {
      packDir = mkdtempSync(join(tmpdir(), 'themory-pack-'));
      extractDir = mkdtempSync(join(tmpdir(), 'themory-extract-'));

      const packRun = spawnSync(
        'npm',
        ['pack', '--pack-destination', packDir, '--json'],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 },
      );
      if (packRun.status !== 0) {
        throw new Error(`npm pack failed: ${packRun.stderr}`);
      }
      const parsed = JSON.parse(packRun.stdout) as readonly PackResult[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('npm pack --json returned unexpected shape');
      }
      packResult = parsed[0]!;

      const tarballPath = join(packDir, packResult.name.replace('@', '').replace('/', '-') + '-' + packResult.version + '.tgz');
      const tarRun = spawnSync('tar', ['-xzf', tarballPath, '-C', extractDir], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (tarRun.status !== 0) {
        throw new Error(`tar -xzf failed: ${tarRun.stderr}`);
      }
      extractedPackageDir = join(extractDir, 'package');
      // Simulate post-install dependency resolution by symlinking the project's
      // node_modules into the extracted package dir. `npm install @usetheo/memory`
      // would create an equivalent layout via npm's dep resolver. Without this,
      // the `require()` round-trip fails for bare specifiers like `commander`,
      // `hono`, `pg` — which is a npm-install-environment limitation, NOT a
      // regression of our publish manifest.
      symlinkSync(join(REPO_ROOT, 'node_modules'), join(extractedPackageDir, 'node_modules'), 'dir');
    });

    afterAll(() => {
      if (packDir !== '') {
        rmSync(packDir, { recursive: true, force: true });
      }
      if (extractDir !== '') {
        rmSync(extractDir, { recursive: true, force: true });
      }
    });

    test('1. dist 4 sibling .js files exist in extracted tarball', () => {
      for (const sibling of SIBLINGS) {
        const siblingPath = join(extractedPackageDir, 'dist', 'agent-tools', sibling);
        expect(existsSync(siblingPath), `expected ${siblingPath} to exist post-extract`).toBe(true);
      }
    });

    test('2. cli require() round-trip succeeds post-extract', () => {
      const cliPath = join(extractedPackageDir, 'dist', 'agent-tools', 'cli.js');
      const cliRun = spawnSync(
        'node',
        ['-e', `import(${JSON.stringify(cliPath)}).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });`],
        { encoding: 'utf8', timeout: 30_000 },
      );
      expect(cliRun.status, `node import failed: stderr=${cliRun.stderr}`).toBe(0);
    });

    test('3. dist .d.ts files exist for 4 siblings', () => {
      for (const dts of D_TS_SIBLINGS) {
        const dtsPath = join(extractedPackageDir, 'dist', 'agent-tools', dts);
        expect(existsSync(dtsPath), `expected ${dtsPath} to exist post-extract`).toBe(true);
      }
    });

    test('4. npm pack ships >= 9 dist/ entries (cli + 4 siblings + 4 d.ts)', () => {
      const distPaths = packResult!.files.filter((f) => f.path.startsWith('dist/'));
      expect(distPaths.length, `dist/ entry count was ${distPaths.length}`).toBeGreaterThanOrEqual(9);
    });

    test('5. run-mcp-server.ts JSDoc has zero stubs tokens', () => {
      const src = readFileSync(join(REPO_ROOT, 'src', 'agent-tools', 'run-mcp-server.ts'), 'utf8');
      const jsdocMatch = src.match(/^\/\*\*[\s\S]*?\*\//);
      expect(jsdocMatch, 'expected JSDoc block at start of file').not.toBeNull();
      const jsdoc = jsdocMatch![0];
      expect(jsdoc).not.toMatch(/\bstubs?\b/i);
    });

    test('6. run-mcp-server.ts JSDoc names the real-providers wiring', () => {
      const src = readFileSync(join(REPO_ROOT, 'src', 'agent-tools', 'run-mcp-server.ts'), 'utf8');
      const jsdocMatch = src.match(/^\/\*\*[\s\S]*?\*\//);
      expect(jsdocMatch).not.toBeNull();
      const jsdoc = jsdocMatch![0];
      expect(jsdoc).toMatch(/LocalTransformerEmbedder|OpenAILLM|real providers?/i);
    });

    test('7. EC-1 — dist/local/migrations/*.sql files exist in extracted tarball', () => {
      const sourceMigrationsDir = join(REPO_ROOT, 'src', 'local', 'migrations');
      const expectedSql = readdirSync(sourceMigrationsDir).filter((f) => f.endsWith('.sql'));
      expect(expectedSql.length, 'sanity — at least one .sql in source dir').toBeGreaterThan(0);
      for (const sqlFile of expectedSql) {
        const extractedSqlPath = join(extractedPackageDir, 'dist', 'local', 'migrations', sqlFile);
        expect(existsSync(extractedSqlPath), `expected ${extractedSqlPath} post-extract (F-T7-1-3 guard)`).toBe(true);
      }
    });

    test('8. EC-1 — npm pack file list contains every dist/local/migrations/*.sql', () => {
      const sourceMigrationsDir = join(REPO_ROOT, 'src', 'local', 'migrations');
      const expectedSql = readdirSync(sourceMigrationsDir).filter((f) => f.endsWith('.sql'));
      const packPaths = packResult!.files.map((f) => f.path);
      for (const sqlFile of expectedSql) {
        expect(packPaths).toContain(`dist/local/migrations/${sqlFile}`);
      }
    });

    test('9. EC-1 hotfix (BLOCKER F-dom-cli-blocker-1) — dist/local/migrations/meta/_journal.json exists in extract', () => {
      const journalPath = join(extractedPackageDir, 'dist', 'local', 'migrations', 'meta', '_journal.json');
      expect(existsSync(journalPath), `expected ${journalPath} post-extract — Drizzle migrate() reads meta/_journal.json BEFORE any .sql file (architecture rule § 10.1); without it themory migrate fails Can't find meta/_journal.json`).toBe(true);
    });

    test('10. EC-1 hotfix — npm pack ships every src/local/migrations/meta/*.json under dist/local/migrations/meta/', () => {
      const sourceMetaDir = join(REPO_ROOT, 'src', 'local', 'migrations', 'meta');
      const expectedJson = readdirSync(sourceMetaDir).filter((f) => f.endsWith('.json'));
      expect(expectedJson.length, 'sanity — meta json files exist in source').toBeGreaterThan(0);
      const packPaths = packResult!.files.map((f) => f.path);
      for (const jsonFile of expectedJson) {
        expect(packPaths).toContain(`dist/local/migrations/meta/${jsonFile}`);
      }
    });
  },
);
