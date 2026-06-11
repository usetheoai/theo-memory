/**
 * ADR D3 regression guard: no @anthropic-ai/sdk import anywhere under
 * src/benchmarks/**.
 *
 * Per user directive 2026-06-02 + plan v1.2 ADR D3 rewrite, claude judge
 * access routes through OpenRouter (model id 'anthropic/claude-3.5-sonnet')
 * via the existing openai SDK. Importing the official Anthropic SDK would
 * reintroduce the vendor lock-in the user explicitly rejected.
 *
 * v0-8-fixes-cycle-1 T4.1 (closes F-tests-10 INFO): scope widened from
 * src/benchmarks/llm-judge/ (single dir, files-only) to src/benchmarks/**
 * (recursive). Future adapters or runner extensions cannot accidentally
 * regress the invariant.
 *
 * @see plan v1.2 § ADR D3
 * @see plan v0-8-fixes-cycle-1 § T4.1 + F-tests-10
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// dirname(dirname(...)) -> src/benchmarks/llm-judge -> src/benchmarks
const BENCHMARKS_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function listTsFilesRecursive(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip test directories — paper-name string literals legitimately
      // appear in test fixtures or assertions.
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...listTsFilesRecursive(full));
    } else if (s.isFile()) {
      if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  }
  return out;
}

describe('ADR D3 — no @anthropic-ai/sdk import in src/benchmarks/**', () => {
  it('no .ts source file under src/benchmarks/ imports from @anthropic-ai/sdk', () => {
    const files = listTsFilesRecursive(BENCHMARKS_DIR);
    expect(files.length).toBeGreaterThan(0); // sanity: we found source files
    // Match actual ES module import statements, NOT docstring mentions of
    // the SDK name (which legitimately appear when explaining the ADR D3
    // rejection rationale). Patterns covered:
    //   import ... from '@anthropic-ai/sdk'
    //   import('@anthropic-ai/sdk')
    //   require('@anthropic-ai/sdk')
    const importPattern = /(?:from\s+['"]@anthropic-ai\/sdk|import\s*\(\s*['"]@anthropic-ai\/sdk|require\s*\(\s*['"]@anthropic-ai\/sdk)/;
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      expect(contents, `file ${file} must not import @anthropic-ai/sdk`).not.toMatch(
        importPattern,
      );
    }
  });
});
