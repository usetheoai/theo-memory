import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, test } from 'vitest';

import type { RecallOptions, RememberOptions } from '../options.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPTIONS_TS = resolve(HERE, '..', 'options.ts');

describe('T3.1 + ADR-0011 — asOf JSDoc reflects local-runtime lift', () => {
  test('options.ts does NOT advertise @throws BiTemporalNotSupportedLocally above asOf', () => {
    // Pre-v1.1 the JSDoc warned local callers about the throw. ADR-0011
    // lifts the throw; the JSDoc must NOT continue to advertise it as a
    // throw path or consumer code reading the type will keep wrapping
    // calls in try/catch unnecessarily.
    const source = readFileSync(OPTIONS_TS, 'utf8');
    const lines = source.split('\n');
    const asOfLineIndex = lines.findIndex((line) => /^\s*readonly\s+asOf\??:\s*Date\b/.test(line));
    expect(asOfLineIndex).toBeGreaterThan(-1);
    const windowStart = Math.max(0, asOfLineIndex - 28);
    const window = lines.slice(windowStart, asOfLineIndex).join('\n');
    expect(window).not.toMatch(/@throws\s+BiTemporalNotSupportedLocally/);
  });

  test('options.ts cites BOTH ADR-0006 (schema) and ADR-0011 (runtime) above asOf', () => {
    // ADR-0006 schema clause is reinforced, not removed — keep the citation.
    // ADR-0011 runtime-clause supersession is new in v1.1 — add the citation.
    const source = readFileSync(OPTIONS_TS, 'utf8');
    const lines = source.split('\n');
    const asOfLineIndex = lines.findIndex((line) => /^\s*readonly\s+asOf\??:\s*Date\b/.test(line));
    const windowStart = Math.max(0, asOfLineIndex - 28);
    const window = lines.slice(windowStart, asOfLineIndex).join('\n');
    expect(window).toMatch(/ADR-0006/);
    expect(window).toMatch(/ADR-0011/);
  });

  test('options.ts advertises @throws InvalidScope above asOf for EC-3 boundary validation', () => {
    // EC-3: NaN getTime() Date inputs throw InvalidScope at the boundary.
    const source = readFileSync(OPTIONS_TS, 'utf8');
    const lines = source.split('\n');
    const asOfLineIndex = lines.findIndex((line) => /^\s*readonly\s+asOf\??:\s*Date\b/.test(line));
    const windowStart = Math.max(0, asOfLineIndex - 28);
    const window = lines.slice(windowStart, asOfLineIndex).join('\n');
    expect(window).toMatch(/@throws\s+InvalidScope/);
  });
});

describe('EC-2 absorbed — RememberOptions.attributedTo widening (v1.1 T1.1)', () => {
  test('RememberOptions.attributedTo is an optional string (verbatim-path support per ADR D2)', () => {
    expectTypeOf<RememberOptions>().toHaveProperty('attributedTo');
    expectTypeOf<RememberOptions['attributedTo']>().toEqualTypeOf<string | undefined>();
  });
});

describe('T2.2 — RecallOptions.attributedTo filter widening (v1.1)', () => {
  test('RecallOptions.attributedTo is an optional string (recall filter per ADR D2 + T2.2)', () => {
    expectTypeOf<RecallOptions>().toHaveProperty('attributedTo');
    expectTypeOf<RecallOptions['attributedTo']>().toEqualTypeOf<string | undefined>();
  });
});
