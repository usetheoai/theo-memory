/**
 * Public-path resolution tests — T2.1 of plan v0-2-theokit-binding (v1.1).
 *
 * Validates that `@usetheo/memory/theokit` subpath is publicly resolvable AND
 * that the default `@usetheo/memory` barrel does NOT pull `src/theokit/` code
 * (bundle isolation per ADR D6 + architecture.md § 9).
 *
 * Includes EC-9 SHOULD TEST: subpath resolves under TypeScript's modern
 * moduleResolution variants (`node16`, `bundler`, `nodenext`).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

describe('@usetheo/memory/theokit — subpath resolution', () => {
  test('resolves and exports memoryFromCtx + MissingScopeError', async () => {
    // Given: package.json declares ./theokit subpath
    // When: consumer imports from @usetheo/memory/theokit
    const mod = await import('@usetheo/memory/theokit');

    // Then: memoryFromCtx + MissingScopeError are available
    expect(typeof mod.memoryFromCtx).toBe('function');
    expect(typeof mod.MissingScopeError).toBe('function');
  });

  test('exports ScopedContext as a TYPE — verified via runtime keys (type erased at runtime)', async () => {
    // Type-only exports erase at runtime; their presence is verified by
    // tests/integration/public-paths.test.ts compiling under tsc (typecheck step).
    // This runtime test just confirms the value-exports list — the type-export
    // is enforced by the EC-9 moduleResolution test below.
    const mod = await import('@usetheo/memory/theokit');
    const valueKeys = Object.keys(mod);
    expect(valueKeys).toContain('memoryFromCtx');
    expect(valueKeys).toContain('MissingScopeError');
  });
});

describe('@usetheo/memory — main barrel isolation from theokit', () => {
  test('default barrel does NOT export memoryFromCtx (bundle isolation)', async () => {
    // Given: ADR D6 mandates theokit subpath ships independent of main barrel
    // When: consumer imports default barrel
    const mod = await import('@usetheo/memory');

    // Then: theokit-specific exports are absent
    expect(Object.keys(mod)).not.toContain('memoryFromCtx');
  });

  test('src/index.ts source contains zero theokit references (static tripwire)', () => {
    // Belt-and-braces: if a future refactor accidentally adds an
    // `export * from './theokit/...'` to src/index.ts, this assertion catches
    // it BEFORE the runtime check fires (and BEFORE bundlers pick it up).
    const source = readFileSync(join(REPO_ROOT, 'src', 'index.ts'), 'utf-8');
    expect(source).not.toContain('theokit');
  });
});

describe('@usetheo/memory/theokit — EC-9 modern moduleResolution compatibility', () => {
  // Spawns `tsc --noEmit` against fixture tsconfigs declaring different
  // `moduleResolution` values. The fixture imports memoryFromCtx + ScopedContext
  // from '@usetheo/memory/theokit' using a paths alias mapping to the repo's
  // src/theokit/index.ts. Per blueprint Q3 ADR D6 absorption.
  //
  // Each variant: ~1-3s. Total budget < 10s, well under integration's 30s timeout.

  const VARIANTS = ['node16', 'bundler', 'nodenext'] as const;
  const FIXTURE_IMPORT = `
import { memoryFromCtx, MissingScopeError } from '@usetheo/memory/theokit';
import type { ScopedContext } from '@usetheo/memory/theokit';

const ctx: ScopedContext = { session: { userId: 'test' } };
void memoryFromCtx;
void MissingScopeError;
void ctx;
`.trim();

  for (const resolution of VARIANTS) {
    test(`subpath imports compile under moduleResolution: "${resolution}"`, () => {
      const tmpDir = mkdtempSync(join(tmpdir(), `theokit-resolve-${resolution}-`));
      try {
        // Write package.json declaring ESM so node16/nodenext don't treat
        // the fixture as CommonJS (verbatimModuleSyntax + node16 require this)
        writeFileSync(
          join(tmpDir, 'package.json'),
          JSON.stringify({ name: 'theokit-resolve-fixture', type: 'module', private: true }, null, 2),
        );

        // Write the fixture source
        const srcDir = join(tmpDir, 'src');
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, 'consumer.ts'), FIXTURE_IMPORT);

        // Write tsconfig with the variant moduleResolution + path alias to repo
        const tsconfig = {
          compilerOptions: {
            target: 'es2022',
            module: resolution === 'node16' ? 'node16' : resolution === 'nodenext' ? 'nodenext' : 'esnext',
            moduleResolution: resolution,
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            esModuleInterop: true,
            verbatimModuleSyntax: true,
            paths: {
              '@usetheo/memory/theokit': [join(REPO_ROOT, 'src', 'theokit', 'index.ts')],
              '@usetheo/memory/contract': [join(REPO_ROOT, 'src', 'core', 'index.ts')],
            },
            baseUrl: '.',
          },
          include: ['src/**/*.ts'],
        };
        writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

        // Spawn tsc against the fixture
        const tscBin = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');
        const result = execFileSync(tscBin, ['--noEmit', '-p', tmpDir], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        // If we reach here, exit code was 0 (execFileSync throws on non-zero)
        expect(result).toBeDefined();
      } catch (err) {
        const stderr = (err as { stderr?: string; stdout?: string }).stderr ?? '';
        const stdout = (err as { stderr?: string; stdout?: string }).stdout ?? '';
        throw new Error(
          `tsc failed under moduleResolution: ${resolution}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }
});
