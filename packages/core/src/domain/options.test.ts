import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, test } from 'vitest';

import type { MemoryItem } from './memory-item.js';
import type { GetAllOptions, RecallOptions, RememberOptions } from './options.js';
import type { Filters } from './scope.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPTIONS_TS = resolve(HERE, 'options.ts');
// M22: RecallOptions (incl. asOf) was split out of options.ts into recall-options.ts
// (module-size budget); the asOf JSDoc source-of-truth now lives there.
const RECALL_OPTIONS_TS = resolve(HERE, 'recall-options.ts');

describe('T3.1 + ADR-0011 — asOf JSDoc reflects local-runtime lift', () => {
  // The 28-line JSDoc window ABOVE the `readonly asOf?: Date` declaration in
  // recall-options.ts. Shared by all three assertions (DRY).
  function asOfJsdocWindow(): string {
    const lines = readFileSync(RECALL_OPTIONS_TS, 'utf8').split('\n');
    const asOfLineIndex = lines.findIndex((line) => /^\s*readonly\s+asOf\??:\s*Date\b/.test(line));
    expect(asOfLineIndex).toBeGreaterThan(-1);
    return lines.slice(Math.max(0, asOfLineIndex - 28), asOfLineIndex).join('\n');
  }

  test('recall-options.ts does NOT advertise @throws BiTemporalNotSupportedLocally above asOf', () => {
    // Pre-v1.1 the JSDoc warned local callers about the throw. ADR-0011
    // lifts the throw; the JSDoc must NOT continue to advertise it as a
    // throw path or consumer code reading the type will keep wrapping
    // calls in try/catch unnecessarily.
    expect(asOfJsdocWindow()).not.toMatch(/@throws\s+BiTemporalNotSupportedLocally/);
  });

  test('recall-options.ts cites BOTH ADR-0006 (schema) and ADR-0011 (runtime) above asOf', () => {
    // ADR-0006 schema clause is reinforced, not removed — keep the citation.
    // ADR-0011 runtime-clause supersession is new in v1.1 — add the citation.
    const window = asOfJsdocWindow();
    expect(window).toMatch(/ADR-0006/);
    expect(window).toMatch(/ADR-0011/);
  });

  test('recall-options.ts advertises @throws InvalidScope above asOf for EC-3 boundary validation', () => {
    // EC-3: NaN getTime() Date inputs throw InvalidScope at the boundary.
    expect(asOfJsdocWindow()).toMatch(/@throws\s+InvalidScope/);
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

describe('themory-category-filter-server-side T1.1 — category? widening across 4 types', () => {
  // Type-narrowing assertions: vitest's expectTypeOf().toHaveProperty() is a
  // runtime no-op (does NOT type-error on missing property), so we drive the
  // assertion via the source-text recogniser pattern from T3.1 above. Each
  // test reads the file and matches a `readonly category?: string` line in
  // the relevant exported interface body.
  const OPTIONS_SRC = readFileSync(OPTIONS_TS, 'utf8');
  const MEMORY_ITEM_TS = resolve(HERE, 'memory-item.ts');
  const SCOPE_TS = resolve(HERE, 'scope.ts');

  function interfaceBody(source: string, ifaceName: string): string {
    const start = source.indexOf(`export interface ${ifaceName} {`);
    if (start < 0) throw new Error(`interface ${ifaceName} not found in source`);
    let depth = 0;
    let end = start;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    return source.slice(start, end + 1);
  }

  test('RememberOptions.category is declared as readonly optional string (per ADR D1)', () => {
    const body = interfaceBody(OPTIONS_SRC, 'RememberOptions');
    expect(body).toMatch(/readonly\s+category\?\s*:\s*string\b/);
    // Type-shape sanity: ensure the field, when present, narrows to string | undefined.
    expectTypeOf<RememberOptions['category']>().toEqualTypeOf<string | undefined>();
  });

  test('GetAllOptions.category is declared as readonly optional string (per ADR D2)', () => {
    const body = interfaceBody(OPTIONS_SRC, 'GetAllOptions');
    expect(body).toMatch(/readonly\s+category\?\s*:\s*string\b/);
    expectTypeOf<GetAllOptions['category']>().toEqualTypeOf<string | undefined>();
  });

  test('MemoryItem.category is declared as readonly optional string (projected from column per ADR D2 + EC-12)', () => {
    const source = readFileSync(MEMORY_ITEM_TS, 'utf8');
    const body = interfaceBody(source, 'MemoryItem');
    expect(body).toMatch(/readonly\s+category\?\s*:\s*string\b/);
    expectTypeOf<MemoryItem['category']>().toEqualTypeOf<string | undefined>();
  });

  test('Filters.category is declared as readonly optional string (pipeline boundary)', () => {
    const source = readFileSync(SCOPE_TS, 'utf8');
    const body = interfaceBody(source, 'Filters');
    expect(body).toMatch(/readonly\s+category\?\s*:\s*string\b/);
    expectTypeOf<Filters['category']>().toEqualTypeOf<string | undefined>();
  });
});
