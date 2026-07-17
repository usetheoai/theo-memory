/**
 * T0.2 RED — structural assertions on the journey catalog `knowledge-base/dogfood/journeys.md`.
 *
 * Standalone precursor to the full `check_journey_catalog.py` validator (T1.2): this
 * proves the catalog exists, covers all four surfaces, and — per Q1 (owner directive
 * 2026-07-11) — flags EVERY journey `anchor: true`. RED fails when the catalog is absent.
 *
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const CATALOG = join(process.cwd(), '.claude/knowledge-base/dogfood/journeys.md');

/** Parse the catalog's journey rows: `| J-SURFACE-N | surface | title | anchor | oracle |`. */
function journeyRows(md: string): { id: string; surface: string; anchor: string }[] {
  const rows: { id: string; surface: string; anchor: string }[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*(J-(SDK|API|MCP|UI)-\d+)\s*\|\s*([^|]+?)\s*\|[^|]*\|\s*([^|]+?)\s*\|/);
    if (m) rows.push({ id: m[1]!, surface: m[2]!, anchor: m[4]!.trim() });
  }
  return rows;
}

describe('T0.2 — journey catalog', () => {
  test('test_journey_catalog_has_all_four_surfaces', () => {
    expect(existsSync(CATALOG)).toBe(true);
    const rows = journeyRows(readFileSync(CATALOG, 'utf8'));
    const surfaces = new Set(rows.map((r) => r.surface));
    expect([...surfaces].sort()).toEqual(['API', 'MCP', 'SDK', 'UI']);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  test('test_every_journey_flagged_anchor_true', () => {
    const rows = journeyRows(readFileSync(CATALOG, 'utf8'));
    // Q1: ALL journeys are anchor — no `anchor: false` / `no` row is allowed.
    const nonAnchor = rows.filter((r) => !/^(true|yes)$/i.test(r.anchor));
    expect(nonAnchor.map((r) => r.id)).toEqual([]);
  });
});
