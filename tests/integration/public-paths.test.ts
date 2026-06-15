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

import { describe, expect, expectTypeOf, test } from 'vitest';

// v0-8-fixes-cycle-1 T3.1 + EC-3: Tokenizer must be reachable via the
// public `@usetheo/memory/contract` subpath after the 11th DIP promotion.
// `import type` resolution is typechecked at `npm run typecheck`; if the
// re-export chain in src/core/index.ts breaks, this import errors.
import type { Tokenizer as TokenizerFromContract } from '@usetheo/memory/contract';
// EC-9: same Tokenizer must be reachable via the root `@usetheo/memory`
// barrel (re-exported through src/index.ts -> src/core).
import type { Tokenizer as TokenizerFromRoot } from '@usetheo/memory';

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
    const source = readFileSync(join(REPO_ROOT, 'packages', 'core', 'src', 'index.ts'), 'utf-8');
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
              '@usetheo/memory/theokit': [join(REPO_ROOT, 'packages', 'core', 'src', 'infrastructure', 'theokit', 'index.ts')],
              '@usetheo/memory/contract': [join(REPO_ROOT, 'packages', 'core', 'src', 'domain', 'index.ts')],
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

describe('@usetheo/memory/embedders/local — subpath resolution (T1.2 + ADR D7)', () => {
  test('resolves and exports LocalTransformerEmbedder via @usetheo/memory/embedders/local', async () => {
    // Given: package.json declares ./embedders/local subpath per ADR D7,
    // mirroring the existing ./embedders/openai and ./embedders/stub
    // precedents from Cycle 2 / Cycle 1.
    // When: a consumer imports from the explicit subpath
    const mod = await import('@usetheo/memory/embedders/local');

    // Then: LocalTransformerEmbedder is available as a value export.
    expect(typeof mod.LocalTransformerEmbedder).toBe('function');
    const instance = new mod.LocalTransformerEmbedder();
    expect(typeof instance.embed).toBe('function');
    expect(typeof instance.embedBatch).toBe('function');
  });

  test('default barrel does NOT auto-export LocalTransformerEmbedder (subpath-only per ADR D7)', async () => {
    // Per ADR D7, root barrel does NOT re-export the local embedder —
    // consumers must use the explicit subpath. This mirrors how OpenAIEmbedder
    // and DeterministicStubEmbedder are also subpath-only.
    const mod = await import('@usetheo/memory');
    expect(Object.keys(mod)).not.toContain('LocalTransformerEmbedder');
  });
});

describe('Tokenizer 11th DIP — public path resolution (v0-8-fixes-cycle-1 T3.1 + EC-3 + EC-9)', () => {
  // EC-3 (MUST FIX): per architecture.md § 9, adding a public export requires
  // a unit test importing through the public path. After T3.1 promotes
  // Tokenizer from src/benchmarks/themory/adapter.ts to src/core/dip/tokenizer.ts,
  // the interface becomes part of the public API surface via the existing
  // re-export chain in src/core/index.ts -> src/index.ts (root barrel).
  //
  // Tokenizer is a TYPE-only export (interface), so its presence cannot be
  // verified via runtime `Object.keys(mod)` — it erases at runtime. These
  // tests rely on the typecheck step (`npm run typecheck`) to catch a
  // regression where the re-export chain is broken. The assertions below
  // are structural sanity (mod loads without throwing).

  test('@usetheo/memory/contract loads without throwing (EC-3 — Tokenizer importable from contract subpath)', async () => {
    const mod = await import('@usetheo/memory/contract');
    expect(mod).toBeDefined();
    // Type-only export verified at typecheck via the top-of-file import.
    // Runtime sanity below confirms the type is structurally satisfiable.
    const t: TokenizerFromContract = { count: (s: string) => s.length };
    expectTypeOf(t.count).toEqualTypeOf<(text: string) => number>();
    expect(t.count('hello')).toBe(5);
  });

  test('@usetheo/memory root barrel loads without throwing (EC-9 — Tokenizer importable from root path)', async () => {
    const mod = await import('@usetheo/memory');
    expect(mod).toBeDefined();
    const t: TokenizerFromRoot = { count: (s: string) => s.length };
    expectTypeOf(t.count).toEqualTypeOf<(text: string) => number>();
    expect(t.count('world')).toBe(5);
  });
});
