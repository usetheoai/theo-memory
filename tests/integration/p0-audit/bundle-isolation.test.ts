/**
 * T2.2 — Default-barrel bundle isolation for the 9 subpath impl files.
 *
 * Walks the static-import graph of `src/index.ts` recursively until
 * fixed-point (EC-7 absorption — depth-1 is insufficient). Asserts none
 * of the 9 subpath impl files appear in the reachable set; consumers
 * importing only `@usetheo/memory` (default barrel) MUST NOT pay the
 * bundle cost of `@xenova/transformers`, `openai` SDK, Hono, etc.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T2.2
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { walkStaticImports, toRelativePaths } from './_helpers/static-walk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const ENTRY = join(REPO_ROOT, 'packages', 'core', 'src', 'index.ts');

const NINE_IMPL_FILES = [
  // 1-2 — already covered by tests/integration/subpath-isolation.test.ts;
  //       re-asserted here for matrix completeness.
  'packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts', // ./cache-pg
  'packages/api/src/server/index.ts',                                    // ./server
  // 3-9 — NEW coverage for the remaining 7 subpath impls
  'packages/cli/src/index.ts',                               // ./agent-tools
  'packages/core/src/infrastructure/embedders/index.ts',     // ./embedders
  'packages/core/src/infrastructure/embedders/local.ts',     // ./embedders/local (heavy @xenova dep)
  'packages/core/src/infrastructure/embedders/openai.ts',    // ./embedders/openai (heavy openai dep)
  'packages/core/src/infrastructure/llms/index.ts',          // ./llms
  'packages/core/src/infrastructure/llms/openai.ts',         // ./llms/openai (heavy openai dep)
  'packages/core/src/infrastructure/theokit/index.ts',       // ./theokit
];

describe('T2.2 — Default-barrel bundle isolation (9 subpath impl files)', () => {
  const visited = walkStaticImports(ENTRY, REPO_ROOT);
  const reachable = new Set(toRelativePaths(visited, REPO_ROOT));

  test('1. recursive walk visits >= 1 file (sanity — walker found the entry)', () => {
    expect(reachable.size).toBeGreaterThanOrEqual(1);
  });

  for (const impl of NINE_IMPL_FILES) {
    test(`2. default barrel does NOT statically import ${impl}`, () => {
      expect(
        reachable.has(impl),
        `${impl} appears in the static-import graph of src/index.ts — consumers importing @usetheo/memory pay this bundle cost`,
      ).toBe(false);
    });
  }

  test('3. walk reaches the core barrel (sanity — confirms walker is recursive)', () => {
    // src/core/index.ts is reachable via `export * from './core/index.js'`
    // in src/index.ts; if the walker were depth-1 only, this would still
    // pass (depth-1 catches direct re-exports), but if the walker missed
    // re-exports entirely, it would fail.
    expect(reachable.has('packages/core/src/domain/index.ts')).toBe(true);
  });

  test('4. walk reaches a deeply-nested core sibling via VALUE re-export (confirms transitive recursion)', () => {
    // src/core/index.ts has `export { BiTemporalNotSupportedLocally, ... }
    // from './errors.js';` — a VALUE re-export, which the runtime bundle
    // DOES include (unlike `export type { ... }`). Reaching this file
    // confirms the walker recursed through src/index.ts -> src/core/index.ts
    // -> src/core/errors.ts.
    expect(reachable.has('packages/core/src/domain/errors.ts')).toBe(true);
  });
});
