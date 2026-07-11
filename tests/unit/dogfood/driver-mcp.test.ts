/**
 * T2.3 — MCP driver coverage. Asserts `drivers/mcp.md` documents every J-MCP journey
 * with an oracle + the EC-8 fail-not-skip rule.
 *
 * @see .claude/knowledge-base/plans/dogfood-unified-journey-suite-plan.md § Phase 2 / T2.3
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const CATALOG = readFileSync(join(process.cwd(), '.claude/knowledge-base/dogfood/journeys.md'), 'utf8');
const DRIVER = readFileSync(join(process.cwd(), '.claude/skills/dogfood/drivers/mcp.md'), 'utf8');
const ids = [...CATALOG.matchAll(/^\|\s*(J-MCP-\d+)\s*\|/gm)].map((m) => m[1]!);

describe('T2.3 — MCP driver', () => {
  test('test_mcp_driver_every_journey_has_resolvable_oracle', () => {
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(ids.filter((id) => !DRIVER.includes(id))).toEqual([]);
  });
  test('test_mcp_driver_ec8_documented', () => {
    expect(DRIVER).toMatch(/oracle_unresolvable/);
  });
});
