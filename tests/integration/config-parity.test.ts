/**
 * Config-parity sentinel — added 2026-05-25 post v0-3-agent-tools-mcp halt-loop.
 *
 * Why this exists: during the v0.3 cycle, `tsconfig.contract.json` was expanded
 * to include `src/agent-tools/**` but `eslint.config.ts` files glob was NOT
 * updated in the same commit. Result: 4 halt-loop iterations passed `npm run lint`
 * green while ESLint silently skipped every new `.ts` file under `src/agent-tools/`.
 * Surfaced only at T5.1 when a stylistic rule fired during a manual lint run.
 *
 * This test fails when the ESLint files glob does NOT cover every directory
 * declared in `tsconfig.contract.json#include`. Forces config co-evolution.
 *
 * Inquebrável Rule 3 (Honestidade Extrema) — silent skips are the worst kind
 * of green: they look passing while protecting nothing.
 *
 * @see .claude/knowledge-base/implementations/v0-3-agent-tools-mcp-followups.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

interface TsConfigShape {
  readonly include?: readonly string[];
}

function loadTsconfigInclude(file: string): readonly string[] {
  const raw = readFileSync(resolve(REPO_ROOT, file), 'utf-8');
  const parsed = JSON.parse(raw) as TsConfigShape;
  return parsed.include ?? [];
}

/** Extract `src/{a,b,c}/**` directories from a tsconfig include glob. */
function srcDirsFromIncludes(includes: readonly string[]): ReadonlySet<string> {
  const dirs = new Set<string>();
  for (const inc of includes) {
    const match = /^src\/([a-z][a-z0-9-]*)\//.exec(inc);
    if (match?.[1] !== undefined) {
      dirs.add(match[1]);
    }
  }
  return dirs;
}

/** Extract `{a,b,c}` brace-expanded dirs from an ESLint files glob string. */
function dirsFromEslintGlob(glob: string): ReadonlySet<string> {
  const dirs = new Set<string>();
  const braceMatch = /src\/\{([^}]+)\}\//.exec(glob);
  if (braceMatch?.[1] !== undefined) {
    for (const d of braceMatch[1].split(',')) {
      dirs.add(d.trim());
    }
  }
  return dirs;
}

describe('config parity — eslint files glob covers tsconfig include scope', () => {
  test('every src/* directory in tsconfig.contract.json#include is linted by eslint', () => {
    // Given: tsconfig.contract.json declares which src/* dirs typecheck against the strict contract.
    const contractDirs = srcDirsFromIncludes(loadTsconfigInclude('tsconfig.contract.json'));

    // And: eslint.config.ts declares which src/* dirs are linted.
    const eslintConfig = readFileSync(resolve(REPO_ROOT, 'eslint.config.ts'), 'utf-8');
    const eslintDirs = dirsFromEslintGlob(eslintConfig);

    // When: we compute the diff (typechecked-but-not-linted).
    const missing = [...contractDirs].filter((d) => !eslintDirs.has(d));

    // Then: every typechecked dir must be linted — silent skip would defeat the gate.
    expect(missing, `tsconfig.contract.json includes src/${missing.join(',')} but eslint.config.ts does not lint them. Update eslint.config.ts files glob.`).toEqual([]);
  });

  test('tsconfig.local.json#include directories are also linted', () => {
    // tsconfig.local.json extends contract + adds src/local for the local-runtime scope.
    const localDirs = srcDirsFromIncludes(loadTsconfigInclude('tsconfig.local.json'));
    const eslintConfig = readFileSync(resolve(REPO_ROOT, 'eslint.config.ts'), 'utf-8');
    const eslintDirs = dirsFromEslintGlob(eslintConfig);

    const missing = [...localDirs].filter((d) => !eslintDirs.has(d));
    expect(missing, `tsconfig.local.json includes src/${missing.join(',')} but eslint.config.ts does not lint them.`).toEqual([]);
  });
});
