/**
 * T4.1 — THE GOAL TEST for p0-api-sdk-mcp-correctness-audit plan v1.1.
 *
 * Single test file aggregating ≥ 30 assertions across the 5 sub-goals
 * declared in the plan's `## Goal` SMART statement. Per EC-10 absorption,
 * assertions are organized in 6 nested `describe` blocks so failure
 * attribution surfaces the broken sub-goal in the first vitest output
 * line — no grep-the-stacktrace debug pass needed.
 *
 * The test delegates to the same shape gates as the per-task sentinels
 * (T0.1, T1.1, T1.3, T2.1, T2.2, T3.1) so a failure here ALWAYS surfaces
 * in the upstream sentinel too — but THE GOAL TEST is the single contract
 * the plan's verdict cites.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § Goal + T4.1
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { walkStaticImports, toRelativePaths } from './_helpers/static-walk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const require_ = createRequire(import.meta.url);

function isInstalled(pkg: string): boolean {
  try {
    require_.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

async function importFromSource(relPath: string): Promise<Record<string, unknown>> {
  const absPath = join(REPO_ROOT, 'src', ...relPath.split('/'));
  return (await import(absPath)) as Record<string, unknown>;
}

const XENOVA_OK = isInstalled('@xenova/transformers');
const OPENAI_OK = isInstalled('openai');

describe('THE GOAL TEST — p0-api-sdk-mcp-correctness-audit (≥ 30 assertions)', () => {
  // ────────────────────────────────────────────────────────────────────
  describe('Sub-goal 1: API correctness (public exports surface)', () => {
    const rootContent = readFileSync(join(REPO_ROOT, 'src', 'index.ts'), 'utf8');
    const contractContent = readFileSync(join(REPO_ROOT, 'src', 'core', 'index.ts'), 'utf8');

    test('1. src/index.ts declares 8 export statements (T0.1 baseline)', () => {
      const lines = rootContent.split('\n').filter((l) => l.startsWith('export '));
      expect(lines.length).toBe(8);
    });

    test('2. src/core/index.ts declares 41 export statements (T0.1 baseline)', () => {
      const lines = contractContent.split('\n').filter((l) => l.startsWith('export '));
      expect(lines.length).toBe(41);
    });

    test('3. src/index.ts contains zero `any` occurrences (public-surface floor)', () => {
      const count = (rootContent.match(/\bany\b/g) ?? []).length;
      expect(count).toBe(0);
    });

    test('4. src/core/index.ts contains zero `any` occurrences (contract-surface floor)', () => {
      const count = (contractContent.match(/\bany\b/g) ?? []).length;
      expect(count).toBe(0);
    });

    test('5. src/index.ts has JSDoc + @see on every export statement (T1.1)', () => {
      // T1.1 sentinel already exercises this; here we just smoke-check
      // for the 8 @see references that should be present.
      const seeCount = (rootContent.match(/@see\s+\./g) ?? []).length;
      expect(seeCount).toBeGreaterThanOrEqual(8);
    });

    test('6. src/core/index.ts has JSDoc + @see on every export statement (T1.2)', () => {
      // T1.2 sentinel already exercises this; smoke-check 41 @see refs.
      const seeCount = (contractContent.match(/@see\s+\./g) ?? []).length;
      expect(seeCount).toBeGreaterThanOrEqual(41);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('Sub-goal 2: SDK functional / subpath smoke imports (13 subpaths)', () => {
    test('7. `.` (root) smoke-imports', async () => {
      const mod = await importFromSource('index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('8. `./contract` smoke-imports', async () => {
      const mod = await importFromSource('core/index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('9. `./agent-tools` smoke-imports', async () => {
      const mod = await importFromSource('agent-tools/index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('10. `./cache-pg` smoke-imports', async () => {
      const mod = await importFromSource('local/recall-cache/index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('11. `./embedders` smoke-imports', async () => {
      const mod = await importFromSource('embedders/index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test.skipIf(!XENOVA_OK)('12. `./embedders/local` smoke-imports (xenova installed)', async () => {
      const mod = await importFromSource('embedders/local.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test.skipIf(!OPENAI_OK)('13. `./embedders/openai` smoke-imports (openai SDK installed)', async () => {
      const mod = await importFromSource('embedders/openai.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('14. `./embedders/stub` smoke-imports', async () => {
      const mod = await importFromSource('embedders/stub.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('15. `./llms` smoke-imports', async () => {
      const mod = await importFromSource('llms/index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test.skipIf(!OPENAI_OK)('16. `./llms/openai` smoke-imports (openai SDK installed)', async () => {
      const mod = await importFromSource('llms/openai.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('17. `./llms/stub` smoke-imports', async () => {
      const mod = await importFromSource('llms/stub.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('18. `./server` smoke-imports', async () => {
      const mod = await importFromSource('server/index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });

    test('19. `./theokit` smoke-imports', async () => {
      const mod = await importFromSource('theokit/index.ts');
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('Sub-goal 3: Bundle isolation (9 subpath impl files)', () => {
    const visited = walkStaticImports(join(REPO_ROOT, 'src', 'index.ts'), REPO_ROOT);
    const reachable = new Set(toRelativePaths(visited, REPO_ROOT));

    const NINE_IMPL_FILES = [
      'src/local/recall-cache/pgvector-recall-cache-store.ts',
      'src/server/index.ts',
      'src/agent-tools/index.ts',
      'src/embedders/index.ts',
      'src/embedders/local.ts',
      'src/embedders/openai.ts',
      'src/llms/index.ts',
      'src/llms/openai.ts',
      'src/theokit/index.ts',
    ];

    for (let i = 0; i < NINE_IMPL_FILES.length; i++) {
      const impl = NINE_IMPL_FILES[i]!;
      test(`${String(20 + i)}. default barrel does NOT statically reach ${impl}`, () => {
        expect(reachable.has(impl)).toBe(false);
      });
    }
  });

  // ────────────────────────────────────────────────────────────────────
  describe('Sub-goal 4: Paper-name policy compliance (5 tokens × 0 hits in src/**)', () => {
    function countToken(token: string): number {
      const result = spawnSync(
        'bash',
        ['-c', `grep -rE "\\b${token}\\b" src/ --include="*.ts" 2>/dev/null | grep -v "knowledge-base" | wc -l`],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      return parseInt(result.stdout.trim(), 10);
    }

    test('29. `REDACTED` paper-name count in src/**/*.ts is 0', () => {
      expect(countToken('REDACTED')).toBe(0);
    });

    test('30. `REDACTED` paper-name count in src/**/*.ts is 0', () => {
      expect(countToken('REDACTED')).toBe(0);
    });

    test('31. `REDACTED` paper-name count in src/**/*.ts is 0', () => {
      expect(countToken('REDACTED')).toBe(0);
    });

    test('32. `REDACTED` paper-name count in src/**/*.ts is 0', () => {
      expect(countToken('REDACTED')).toBe(0);
    });

    test('33. `REDACTED` paper-name count in src/**/*.ts is 0', () => {
      expect(countToken('REDACTED')).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('Sub-goal 5: REST stub removal + MCP availability', () => {
    const runServerContent = readFileSync(
      join(REPO_ROOT, 'src', 'agent-tools', 'run-server.ts'),
      'utf8',
    );
    const runMcpContent = readFileSync(
      join(REPO_ROOT, 'src', 'agent-tools', 'run-mcp-server.ts'),
      'utf8',
    );

    test('34. run-server.ts no longer imports StubLLM (T3.2)', () => {
      expect(runServerContent).not.toMatch(/import\b.*\bStubLLM\b/);
    });

    test('35. run-server.ts no longer imports DeterministicStubEmbedder (T3.2)', () => {
      expect(runServerContent).not.toMatch(/import\b.*\bDeterministicStubEmbedder\b/);
    });

    test('36. run-server.ts hard-fails on missing OPENAI_API_KEY (T3.2)', () => {
      expect(runServerContent).toMatch(/OPENAI_API_KEY required/);
    });

    test('37. run-mcp-server.ts hard-fails on missing OPENAI_API_KEY (e43d801 reference)', () => {
      expect(runMcpContent).toMatch(/OPENAI_API_KEY required/);
    });

    test('38. dist/agent-tools/cli.js exists (T3.3 MCP boot prerequisite)', () => {
      expect(existsSync(join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js'))).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('npm pack manifest hygiene', () => {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const parsed = JSON.parse(result.stdout) as ReadonlyArray<{
      name: string;
      files: ReadonlyArray<{ path: string }>;
      entryCount: number;
    }>;
    const pack = parsed[0]!;
    const paths = pack.files.map((f) => f.path);

    test('39. npm pack ships ≥ 100 entries (tolerant per EC-12)', () => {
      expect(pack.entryCount).toBeGreaterThanOrEqual(100);
    });

    test('40. npm pack EXCLUDES every __tests__/** path (no test-leak)', () => {
      const leaks = paths.filter((p) => p.includes('/__tests__/'));
      expect(leaks).toHaveLength(0);
    });

    test('41. npm pack ships dist/agent-tools/cli.js (bin entry — T3.3 dependency)', () => {
      expect(paths).toContain('dist/agent-tools/cli.js');
    });

    test('42. npm pack name is @usetheo/memory (publishing identity)', () => {
      expect(pack.name).toBe('@usetheo/memory');
    });
  });
});
