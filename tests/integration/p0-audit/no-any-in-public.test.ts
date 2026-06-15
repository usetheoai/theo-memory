/**
 * T1.3 — `any` floor sentinel for the public surface.
 *
 * Locks `\bany\b` count at 0 across src/index.ts + src/core/index.ts.
 * Future regression (e.g., adding `Array<any>` to a public-facing type
 * declaration) fires this test and forces revision before merge.
 *
 * EC-5 absorption (SHOULD TEST): pattern widened from the original
 * `: any\b|as any\b` proposal to `\bany\b` (word-boundary only) to catch
 * `Array<any>`, `Promise<any>`, `Record<string, any>`, `as any`. The
 * widened pattern's correctness is itself locked via the sentinel fixture
 * `fixtures/with-any-generics.ts.skip` which intentionally contains 4
 * `any` occurrences across 4 different syntactic positions.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T1.3
 * @see .claude/rules/architecture.md § 7 (Module hygiene — no `any`)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const PUBLIC_SURFACE_FILES = [
  join(REPO_ROOT, 'packages', 'core', 'src', 'index.ts'),
  join(REPO_ROOT, 'packages', 'core', 'src', 'domain', 'index.ts'),
];
const FIXTURE_PATH = join(__dirname, 'fixtures', 'with-any-generics.ts.skip');

const ANY_PATTERN = /\bany\b/g;

function countAny(content: string): number {
  return (content.match(ANY_PATTERN) ?? []).length;
}

describe('T1.3 — `any` floor sentinel', () => {
  test('1. src/index.ts contains zero `any` occurrences (public-surface floor)', () => {
    const content = readFileSync(PUBLIC_SURFACE_FILES[0]!, 'utf8');
    expect(countAny(content)).toBe(0);
  });

  test('2. src/core/index.ts contains zero `any` occurrences (contract-surface floor)', () => {
    const content = readFileSync(PUBLIC_SURFACE_FILES[1]!, 'utf8');
    expect(countAny(content)).toBe(0);
  });

  test('3. EC-5 sentinel — the regex catches generic-arg occurrences (4 hits in fixture)', () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf8');
    // The fixture intentionally contains:
    //   Array<any>            ← 1
    //   Promise<any>          ← 1
    //   Record<string, any>   ← 1
    //   as any                ← 1
    expect(countAny(fixture)).toBe(4);
  });
});
