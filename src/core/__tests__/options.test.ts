import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, test } from 'vitest';

import type { RememberOptions } from '../options.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPTIONS_TS = resolve(HERE, '..', 'options.ts');

describe('EC-5 — asOf JSDoc divergence warning above field', () => {
  test('options.ts has @throws BiTemporalNotSupportedLocally annotation above asOf', () => {
    const source = readFileSync(OPTIONS_TS, 'utf8');
    const lines = source.split('\n');
    const asOfLineIndex = lines.findIndex((line) => /^\s*readonly\s+asOf\??:\s*Date\b/.test(line));
    expect(asOfLineIndex).toBeGreaterThan(-1);
    const windowStart = Math.max(0, asOfLineIndex - 8);
    const window = lines.slice(windowStart, asOfLineIndex).join('\n');
    expect(window).toMatch(/@throws\s+BiTemporalNotSupportedLocally/);
  });

  test('options.ts cites ADR-0006 above asOf', () => {
    const source = readFileSync(OPTIONS_TS, 'utf8');
    const lines = source.split('\n');
    const asOfLineIndex = lines.findIndex((line) => /^\s*readonly\s+asOf\??:\s*Date\b/.test(line));
    const windowStart = Math.max(0, asOfLineIndex - 8);
    const window = lines.slice(windowStart, asOfLineIndex).join('\n');
    expect(window).toMatch(/ADR-0006/);
  });
});

describe('EC-2 absorbed — RememberOptions.attributedTo widening (v1.1 T1.1)', () => {
  test('RememberOptions.attributedTo is an optional string (verbatim-path support per ADR D2)', () => {
    expectTypeOf<RememberOptions>().toHaveProperty('attributedTo');
    expectTypeOf<RememberOptions['attributedTo']>().toEqualTypeOf<string | undefined>();
  });
});
