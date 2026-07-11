/**
 * T2.1 — SDK driver coverage. Asserts `drivers/sdk.md` documents every J-SDK journey
 * from the catalog with a resolvable oracle, and documents the EC-8 fail-not-skip rule.
 *
 * @see .claude/knowledge-base/plans/dogfood-unified-journey-suite-plan.md § Phase 2 / T2.1
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const CATALOG = readFileSync(join(process.cwd(), '.claude/knowledge-base/dogfood/journeys.md'), 'utf8');
const DRIVER = readFileSync(join(process.cwd(), '.claude/skills/dogfood/drivers/sdk.md'), 'utf8');

const sdkIds = [...CATALOG.matchAll(/^\|\s*(J-SDK-\d+)\s*\|/gm)].map((m) => m[1]!);

describe('T2.1 — SDK driver', () => {
  test('test_sdk_driver_every_journey_has_resolvable_oracle', () => {
    expect(sdkIds.length).toBeGreaterThanOrEqual(12);
    // Every J-SDK journey is documented in the driver (a per-journey line/heading).
    const missing = sdkIds.filter((id) => !DRIVER.includes(id));
    expect(missing).toEqual([]);
  });

  test('test_sdk_driver_missing_oracle_records_fail_not_skip', () => {
    // EC-8: a driver MUST record outcome:fail reason=oracle_unresolvable, never skip silently.
    expect(DRIVER).toMatch(/oracle_unresolvable/);
    expect(DRIVER).toMatch(/outcome:\s*fail/);
  });
});
