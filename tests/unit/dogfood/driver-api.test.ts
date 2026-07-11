/**
 * T2.2 — API driver coverage. Asserts `drivers/api.md` documents every J-API + J-CLI
 * journey with an oracle, and the EC-8 fail-not-skip rule.
 *
 * @see .claude/knowledge-base/plans/dogfood-unified-journey-suite-plan.md § Phase 2 / T2.2
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const CATALOG = readFileSync(join(process.cwd(), '.claude/knowledge-base/dogfood/journeys.md'), 'utf8');
const DRIVER = readFileSync(join(process.cwd(), '.claude/skills/dogfood/drivers/api.md'), 'utf8');
const ids = [...CATALOG.matchAll(/^\|\s*(J-(?:API|CLI)-\d+)\s*\|/gm)].map((m) => m[1]!);

describe('T2.2 — API driver', () => {
  test('test_api_driver_every_journey_has_resolvable_oracle', () => {
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(ids.filter((id) => !DRIVER.includes(id))).toEqual([]);
  });
  test('test_api_driver_secret_and_ec8_documented', () => {
    expect(DRIVER).toMatch(/oracle_unresolvable/); // EC-8
    expect(DRIVER).toMatch(/theo_live_/); // EC-2 redaction discipline documented
  });
});
