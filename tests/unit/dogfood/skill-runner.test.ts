/**
 * T4.1 — the rewritten `/dogfood` SKILL.md is the runner+gate. Asserts it WIRES the
 * deferred callers (invokes run_journey_audit.py + check_journey_catalog.py, references the
 * 4 drivers + the catalog), documents run+audit modes, and preserves the verdict tokens.
 *
 * @see .claude/knowledge-base/plans/dogfood-unified-journey-suite-plan.md § Phase 4 / T4.1
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const SKILL = readFileSync(join(process.cwd(), '.claude/skills/dogfood/SKILL.md'), 'utf8');

describe('T4.1 — /dogfood SKILL runner+gate', () => {
  test('test_skill_wires_the_deferred_callers', () => {
    // pillar (a) for T1.1/T1.2: the SKILL audit flow is the real caller.
    expect(SKILL).toMatch(/run_journey_audit\.py/);
    expect(SKILL).toMatch(/check_journey_catalog\.py/);
    // pillar (a) for T2.x/T3.1: the run flow reads the four surface drivers.
    for (const d of ['sdk', 'api', 'mcp', 'ui']) expect(SKILL).toMatch(new RegExp(`drivers/${d}\\.md`));
    expect(SKILL).toMatch(/dogfood\/journeys\.md/);
  });

  test('test_skill_documents_run_and_audit_modes', () => {
    expect(SKILL).toMatch(/\brun\b/);
    expect(SKILL).toMatch(/\baudit\b/);
  });

  test('test_skill_preserves_verdict_tokens', () => {
    for (const t of ['EVIDENCE_SUFFICIENT', 'EVIDENCE_WITH_CAVEATS', 'EVIDENCE_INSUFFICIENT']) {
      expect(SKILL).toContain(t);
    }
  });
});
