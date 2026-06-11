import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');
const BARREL = resolve(REPO_ROOT, 'src', 'domain', 'index.ts');

interface PackageJsonShape {
  readonly exports?: Record<string, { readonly types?: string; readonly default?: string | null }>;
}

function readPackageJson(): PackageJsonShape {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as PackageJsonShape;
}

describe('EC-3 — package.json#exports./contract.default is NOT null', () => {
  test('package.json#exports has the ./contract preview entry', () => {
    const pkg = readPackageJson();
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports).toHaveProperty('./contract');
  });

  test('package.json#exports./contract.default is a real path (not null)', () => {
    const pkg = readPackageJson();
    const contractEntry = pkg.exports?.['./contract'];
    expect(contractEntry).toBeDefined();
    expect(contractEntry?.default).not.toBeNull();
    expect(typeof contractEntry?.default).toBe('string');
    expect(contractEntry?.default).toMatch(/^\.\/src\/domain\/index\.ts$/);
  });

  test('package.json#exports./contract.types matches default (same TS file)', () => {
    const pkg = readPackageJson();
    const contractEntry = pkg.exports?.['./contract'];
    expect(contractEntry?.types).toBe(contractEntry?.default);
  });

  test('package.json#exports./contract still resolves at v0.1 (backward-compat with v0.0 contract preview)', () => {
    const pkg = readPackageJson();
    const contractEntry = pkg.exports?.['./contract'];
    expect(contractEntry).toBeDefined();
    expect(contractEntry?.default).toBe('./src/domain/index.ts');
  });

  test('package.json has "." entry in exports (T7.2 of v0-1-local-runtime landed it)', () => {
    const pkg = readPackageJson();
    expect(pkg.exports).toBeDefined();
    expect(Object.keys(pkg.exports ?? {})).toContain('.');
    expect(pkg.exports?.['.']?.default).toBe('./src/index.ts');
  });
});

describe('barrel source completeness', () => {
  test('src/core/index.ts re-exports every Phase 2 + Phase 3 module', () => {
    const source = readFileSync(BARREL, 'utf8');
    const expectedReExports = [
      './scope.js',
      './memory-item.js',
      './options.js',
      './memory-store.js',
      './history-entry.js',
      './reflection-result.js',
      './errors.js',
      './message.js',
      './dip/embedder.js',
      './dip/llm.js',
      './dip/vector-store.js',
      './dip/history-manager.js',
      './dip/reflection-policy.js',
    ];
    for (const path of expectedReExports) {
      expect(source).toContain(`from '${path}'`);
    }
  });
});
