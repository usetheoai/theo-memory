import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTOR_STORE_TS = resolve(HERE, '..', 'dip', 'vector-store.ts');

describe('EC-6 — getUserId/setUserId JSDoc clarifies session-metadata vs tenant-isolation', () => {
  test('vector-store.ts JSDoc states tenant isolation uses Filters (not setUserId)', () => {
    const source = readFileSync(VECTOR_STORE_TS, 'utf8');
    expect(source).toMatch(/tenant isolation uses .*Filters/i);
  });

  test('vector-store.ts JSDoc warns adapters NOT to encode active scope via setUserId', () => {
    const source = readFileSync(VECTOR_STORE_TS, 'utf8');
    expect(source).toMatch(/SHALL NOT use .*setUserId.*to encode the active scope/i);
  });

  test('vector-store.ts cites ADR-0002 (tenant-isolation contract)', () => {
    const source = readFileSync(VECTOR_STORE_TS, 'utf8');
    expect(source).toMatch(/@see ADR-0002/);
  });
});
