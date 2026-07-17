/**
 * T1.2 — `check_journey_catalog.py` structural validator.
 *
 * Fails on: a missing surface, a surface whose journeys are not all anchor (Q1 —
 * every journey MUST be anchor:true), a duplicate journey id. Passes on a well-formed
 * all-anchor 4-surface catalog. The author-time gate the runtime audit (T1.1) complements.
 *
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const SCRIPT = join(process.cwd(), '.claude/skills/dogfood/scripts/check_journey_catalog.py');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dogfood-catalog-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeCatalog(rows: { id: string; surface: string; anchor?: string }[]): string {
  const path = join(dir, 'journeys.md');
  const lines = ['# catalog', '', '| id | surface | title | anchor | oracle |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.id} | ${r.surface} | t | ${r.anchor ?? 'true'} | o |`);
  writeFileSync(path, lines.join('\n'));
  return path;
}

const FOUR = [
  { id: 'J-SDK-1', surface: 'SDK' },
  { id: 'J-API-1', surface: 'API' },
  { id: 'J-MCP-1', surface: 'MCP' },
  { id: 'J-UI-1', surface: 'UI' },
];

function check(catalog: string): { valid: boolean; code: number } {
  try {
    execFileSync('python3', [SCRIPT, '--catalog', catalog], { encoding: 'utf8' });
    return { valid: true, code: 0 };
  } catch (e: unknown) {
    return { valid: false, code: (e as { status?: number }).status ?? 1 };
  }
}

describe('T1.2 — check_journey_catalog', () => {
  test('test_catalog_valid_passes', () => {
    expect(check(writeCatalog(FOUR)).valid).toBe(true);
  });

  test('test_catalog_missing_surface_fails', () => {
    expect(check(writeCatalog(FOUR.slice(0, 3))).valid).toBe(false); // no UI surface
  });

  test('test_catalog_surface_without_anchor_fails', () => {
    const rows = [...FOUR];
    rows[3] = { id: 'J-UI-1', surface: 'UI', anchor: 'false' }; // Q1 violated
    expect(check(writeCatalog(rows)).valid).toBe(false);
  });

  test('test_catalog_duplicate_id_fails', () => {
    const rows = [...FOUR, { id: 'J-SDK-1', surface: 'SDK' }]; // dup J-SDK-1
    expect(check(writeCatalog(rows)).valid).toBe(false);
  });
});
