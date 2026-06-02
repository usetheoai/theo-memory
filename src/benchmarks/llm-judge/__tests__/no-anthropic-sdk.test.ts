/**
 * ADR D3 regression guard: no @anthropic-ai/sdk import under
 * src/benchmarks/llm-judge/.
 *
 * Per user directive 2026-06-02 + plan v1.2 ADR D3 rewrite, claude judge
 * access routes through OpenRouter (model id 'anthropic/claude-3.5-sonnet')
 * via the existing openai SDK. Importing the official Anthropic SDK would
 * reintroduce the vendor lock-in the user explicitly rejected.
 *
 * @see plan v1.2 § ADR D3
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

describe('ADR D3 — no @anthropic-ai/sdk import in src/benchmarks/llm-judge/', () => {
  it('no .ts source file imports from @anthropic-ai/sdk', () => {
    const files = readdirSync(SRC_DIR).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(0); // sanity: we found source files
    // Match actual ES module import statements, NOT docstring mentions of
    // the SDK name (which legitimately appear when explaining the ADR D3
    // rejection rationale). Patterns covered:
    //   import ... from '@anthropic-ai/sdk'
    //   import('@anthropic-ai/sdk')
    //   require('@anthropic-ai/sdk')
    const importPattern = /(?:from\s+['"]@anthropic-ai\/sdk|import\s*\(\s*['"]@anthropic-ai\/sdk|require\s*\(\s*['"]@anthropic-ai\/sdk)/;
    for (const file of files) {
      const contents = readFileSync(join(SRC_DIR, file), 'utf8');
      expect(contents, `file ${file} must not import @anthropic-ai/sdk`).not.toMatch(
        importPattern,
      );
    }
  });
});
