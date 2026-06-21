/**
 * T1.4 — bundle-isolation gate for the optional `isolated-vm` native addon.
 *
 * `SandboxedSkillExecutor` is a VALUE export of the default barrel
 * (`@usetheo/memory`), so its source file IS in the static-import graph. The
 * invariant that keeps the default barrel addon-free (EC-47 distroless-no-shell +
 * the @xenova optional-dep precedent) is therefore NOT "the file is unreachable"
 * but "the reachable executor file never STATICALLY value-imports `isolated-vm`":
 * the addon is referenced only via `import type` (erased) + the lazy
 * `() => import('isolated-vm')` (runtime, only when `execute()` is called).
 *
 * @see .claude/knowledge-base/plans/agentic-skill-execution-sandbox-plan.md § T1.4 (EC-47)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXECUTOR_SRC = join(__dirname, 'sandboxed-skill-executor.ts');

// A static VALUE import of isolated-vm: `import x from 'isolated-vm'` or
// `import { x } from 'isolated-vm'` — but NOT `import type ... from 'isolated-vm'`.
const STATIC_VALUE_IMPORT_RE = /^\s*import\s+(?!type\b)[^;]*\bfrom\s+['"]isolated-vm['"]/m;
const TYPE_IMPORT_RE = /^\s*import\s+type\s+[^;]*\bfrom\s+['"]isolated-vm['"]/m;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]isolated-vm['"]\s*\)/;

describe('T1.4 — isolated-vm bundle isolation (EC-47)', () => {
  const source = readFileSync(EXECUTOR_SRC, 'utf8');

  test('executor does NOT statically value-import isolated-vm (addon stays out of the default barrel)', () => {
    expect(
      STATIC_VALUE_IMPORT_RE.test(source),
      'sandboxed-skill-executor.ts statically value-imports isolated-vm — importing @usetheo/memory would force-load the native addon (EC-47 regression)',
    ).toBe(false);
  });

  test('executor references isolated-vm ONLY via import type (erased) + dynamic import (lazy)', () => {
    expect(TYPE_IMPORT_RE.test(source)).toBe(true);
    expect(DYNAMIC_IMPORT_RE.test(source)).toBe(true);
  });
});
