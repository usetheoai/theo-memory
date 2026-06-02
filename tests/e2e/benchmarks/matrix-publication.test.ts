/**
 * T8.2 — matrix-publication THE FINAL GOAL TEST.
 *
 * Validates that docs/benchmarks/v0.8.md publication exists and
 * carries an honest 12-cell matrix (4 adapters × 3 benchmarks)
 * with no literal "TBD" placeholder, EC-12 whitespace tolerance,
 * and each cell either smoke-validated or explicitly Deferred
 * with a Drift-T*.* reference (Inquebrável Rule 3).
 *
 * @see plan v1.2 § T8.2 + EC-12
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const V08_PATH = join(REPO_ROOT, 'docs', 'benchmarks', 'v0.8.md');

const ADAPTERS = ['TheMemory v0.7', 'Mem0 v3', 'Zep', 'Letta'] as const;
const BENCHMARKS = ['LongMemEval', 'LoCoMo', 'DMR'] as const;

interface MatrixRow {
  readonly adapter: string;
  readonly cells: readonly { benchmark: string; content: string }[];
}

/**
 * EC-12 robust markdown-table parser. Tolerates:
 * - extra whitespace around pipes
 * - varying cell alignment
 * - leading/trailing whitespace inside cells
 */
function parseMatrix(markdown: string): readonly MatrixRow[] {
  const lines = markdown.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.includes('|') && BENCHMARKS.every((b) => line.includes(b))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headerCells = (lines[headerIdx] ?? '')
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  // headerCells[0] is the "Adapter" label; rest are benchmark names.
  const benchmarkOrder = headerCells.slice(1);

  const rows: MatrixRow[] = [];
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.includes('|') || line.trim().startsWith('###') || line.trim().length === 0) break;
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 2) continue;
    const [adapter, ...benchmarkCells] = cells;
    if (adapter === undefined) continue;
    rows.push({
      adapter,
      cells: benchmarkCells.map((content, idx) => ({
        benchmark: benchmarkOrder[idx] ?? `unknown-${String(idx)}`,
        content,
      })),
    });
  }
  return rows;
}

describe('docs/benchmarks/v0.8.md — THE FINAL GOAL TEST', () => {
  const markdown = readFileSync(V08_PATH, 'utf8');
  const rows = parseMatrix(markdown);

  it('publication file exists and is readable', () => {
    expect(markdown.length).toBeGreaterThan(100);
  });

  it('matrix table is parseable (EC-12 whitespace tolerance)', () => {
    expect(rows.length).toBe(ADAPTERS.length);
  });

  it('matrix has 12 cells (4 adapters × 3 benchmarks)', () => {
    const totalCells = rows.reduce((acc, r) => acc + r.cells.length, 0);
    expect(totalCells).toBe(ADAPTERS.length * BENCHMARKS.length);
  });

  it('contains no literal "TBD" placeholder strings', () => {
    expect(markdown).not.toMatch(/\bTBD\b/);
  });

  it('every cell is either Smoke-validated or explicitly Deferred with a Drift-T*.* reference', () => {
    for (const row of rows) {
      for (const cell of row.cells) {
        const isSmoke = /Smoke/i.test(cell.content);
        const hasDrift = /Drift-T[0-9.]+-?[0-9]*/.test(cell.content);
        const isDeferred = /Deferred/i.test(cell.content);
        const isHonest = isSmoke || (isDeferred && hasDrift);
        expect(
          isHonest,
          `cell ${row.adapter} × ${cell.benchmark} content "${cell.content}" must be Smoke or Deferred+DriftRef`,
        ).toBe(true);
      }
    }
  });

  it('every declared adapter appears in the matrix', () => {
    const adapterNames = rows.map((r) => r.adapter);
    for (const expected of ADAPTERS) {
      expect(adapterNames).toContain(expected);
    }
  });

  it('cites the methodology + reproducibility companion docs', () => {
    expect(markdown).toContain('v0.8-methodology');
    expect(markdown).toContain('v0.8-reproducibility');
  });

  it('surfaces the honesty disclaimer (no production-ready claim from smoke fixtures)', () => {
    expect(markdown.toLowerCase()).toContain('honesty');
    expect(markdown).toMatch(/dogfood/i);
  });
});
