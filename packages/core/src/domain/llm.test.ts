import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const LLM_TS = resolve(HERE, 'dip', 'llm.ts');

describe('EC-10 — LLM.tools forward-compat JSDoc above the tools parameter', () => {
  test('llm.ts has @see ADR-0008 reference near the tools declaration', () => {
    const source = readFileSync(LLM_TS, 'utf8');
    expect(source).toMatch(/@see\s+ADR-0008/);
  });

  test('llm.ts has v0.3 generic forward-compat note near tools', () => {
    const source = readFileSync(LLM_TS, 'utf8');
    expect(source).toMatch(/v0\.3.*generic|generic.*v0\.3/i);
  });

  test('llm.ts warns adapters to type tool shape locally', () => {
    const source = readFileSync(LLM_TS, 'utf8');
    expect(source).toMatch(/type their tool shape locally/);
  });
});
