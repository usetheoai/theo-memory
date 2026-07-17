/**
 * T5.1 — Final Phase / Integration Validation. Proves the unified runner+gate works
 * end-to-end: run_journey_audit.py over the REAL catalog + REAL evidence dir emits an
 * honest verdict (and counts the real J-MCP-3 evidence produced by an actual run), and a
 * simulated red journey blocks SUFFICIENT.
 *
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, '.claude/skills/dogfood/scripts/run_journey_audit.py');
const REAL_CATALOG = join(ROOT, '.claude/knowledge-base/dogfood/journeys.md');
const REAL_EVIDENCE = join(ROOT, '.claude/knowledge-base/dogfood/evidence');
const VALID = ['EVIDENCE_SUFFICIENT', 'EVIDENCE_WITH_CAVEATS', 'EVIDENCE_INSUFFICIENT'];

function run(catalog: string, edir: string): { verdict: string; reds: { id: string }[] } {
  try {
    return JSON.parse(execFileSync('python3', [SCRIPT, '--catalog', catalog, '--evidence-dir', edir], { encoding: 'utf8' }));
  } catch (e: unknown) {
    return JSON.parse((e as { stdout?: string }).stdout ?? '{}');
  }
}

describe('T5.1 — first full real run + honest verdict', () => {
  test('test_first_full_run_emits_verdict_from_real_evidence', () => {
    // Runs over the REAL catalog + REAL evidence dir (not fixtures).
    const r = run(REAL_CATALOG, REAL_EVIDENCE);
    expect(VALID).toContain(r.verdict);
    // The J-MCP-3 evidence produced by an ACTUAL openmemory run is counted green.
    expect(r.reds.map((x) => x.id)).not.toContain('J-MCP-3');
  });

  test('test_a_simulated_red_journey_blocks_sufficient', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dogfood-final-'));
    try {
      writeFileSync(join(dir, 'j.md'), '| J-API-1 | API | t | true | o |');
      const e = join(dir, 'ev');
      mkdirSync(e);
      writeFileSync(join(e, 'red.md'), '---\njourney: J-API-1\ndate: 2026-07-11\noperator: x\noutcome: fail\nsummary: s\n---\n');
      expect(run(join(dir, 'j.md'), e).verdict).not.toBe('EVIDENCE_SUFFICIENT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
