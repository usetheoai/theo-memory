/**
 * T0.2 — Public-export matrix integration test (p0-api-sdk-mcp-correctness-audit plan).
 *
 * The matrix script enumerates every export in src/index.ts + src/core/index.ts
 * via ast-grep with 3 patterns (export {...}, export type {...}, export * from)
 * per EC-4 absorption. For each export, the matrix records JSDoc presence,
 * `@see` cross-reference presence, and the list of contract-test files that
 * exercise the export. Phase T1 closures (T1.1 + T1.2) consume the matrix
 * as their closure tracker.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T0.2
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'audit', 'public-export-matrix.py');

interface MatrixEntry {
  readonly name: string;
  readonly source_file: string;
  readonly jsdoc_present: boolean;
  readonly see_ref_present: boolean;
  readonly contract_test_files: readonly string[];
}

interface Matrix {
  readonly schema_version: string;
  readonly generated_at: string;
  readonly exports: readonly MatrixEntry[];
}

describe('T0.2 — Public-export matrix', () => {
  test('1. scripts/audit/public-export-matrix.py exists', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  test('2. script exits 0 and emits valid JSON on stdout', () => {
    const result = spawnSync('python3', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  test('3. matrix JSON has top-level shape (schema_version, generated_at, exports[])', () => {
    const result = spawnSync('python3', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data = JSON.parse(result.stdout) as Matrix;
    expect(data).toHaveProperty('schema_version');
    expect(data).toHaveProperty('generated_at');
    expect(data).toHaveProperty('exports');
    expect(Array.isArray(data.exports)).toBe(true);
  });

  test('4. matrix enumerates >= 49 distinct exports (8 root + 41 contract baseline)', () => {
    const result = spawnSync('python3', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data = JSON.parse(result.stdout) as Matrix;
    const distinctNames = new Set(data.exports.map((e) => e.name));
    expect(distinctNames.size).toBeGreaterThanOrEqual(49);
  });

  test('5. each entry has 4 documented fields (name, source_file, jsdoc_present, see_ref_present, contract_test_files)', () => {
    const result = spawnSync('python3', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data = JSON.parse(result.stdout) as Matrix;
    for (const entry of data.exports) {
      expect(entry).toHaveProperty('name');
      expect(typeof entry.name).toBe('string');
      expect(entry).toHaveProperty('source_file');
      expect(typeof entry.source_file).toBe('string');
      expect(entry).toHaveProperty('jsdoc_present');
      expect(typeof entry.jsdoc_present).toBe('boolean');
      expect(entry).toHaveProperty('see_ref_present');
      expect(typeof entry.see_ref_present).toBe('boolean');
      expect(entry).toHaveProperty('contract_test_files');
      expect(Array.isArray(entry.contract_test_files)).toBe(true);
    }
  });

  test('6. matrix includes well-known canonical exports (createMemory, createLocalMemory, runMigrations)', () => {
    const result = spawnSync('python3', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const data = JSON.parse(result.stdout) as Matrix;
    const names = new Set(data.exports.map((e) => e.name));
    expect(names.has('createMemory')).toBe(true);
    expect(names.has('createLocalMemory')).toBe(true);
    expect(names.has('runMigrations')).toBe(true);
  });
});
