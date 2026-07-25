/**
 * T3.2 sentinel (#125, #127) — the M18 benchmark doc must record the before/after evidence,
 * so the churn fix (75 -> 0 at threshold 0.8) and the monotonicity fix cannot be silently
 * dropped from the public record. Content-level regression guard, not a metric run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const DOC = readFileSync(join(process.cwd(), 'docs/benchmarks/entity-boost-m18.md'), 'utf8');

describe('entity-boost M18 benchmark doc', () => {
  test('records the recall_set_churn before (75) and after (0) at threshold 0.8', () => {
    // The M15 "before" number and the M18 "after" number must both appear in the 0.8 row.
    const churnRow = DOC.split('\n').find((l) => l.includes('threshold 0.8') && l.includes('|'));
    expect(churnRow).toBeDefined();
    expect(churnRow).toContain('75');
    expect(churnRow).toMatch(/\*\*0\*\*/); // the after value, bolded
  });

  test('records the monotonicity fix and both issue numbers', () => {
    expect(DOC).toContain('#125');
    expect(DOC).toContain('#127');
    expect(DOC).toMatch(/monotonic_violations/);
  });
});
