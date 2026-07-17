/**
 * T3.1 — UI driver coverage. Asserts `drivers/ui.md` documents every J-UI journey with a
 * Chrome-MCP-observable oracle, the dev-stack runbook gotchas, and EC-8.
 *
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const CATALOG = readFileSync(join(process.cwd(), '.claude/knowledge-base/dogfood/journeys.md'), 'utf8');
const DRIVER = readFileSync(join(process.cwd(), '.claude/skills/dogfood/drivers/ui.md'), 'utf8');
const ids = [...CATALOG.matchAll(/^\|\s*(J-UI-\d+)\s*\|/gm)].map((m) => m[1]!);

describe('T3.1 — UI driver', () => {
  test('test_ui_driver_every_tab_has_chrome_observable_oracle', () => {
    expect(ids.length).toBeGreaterThanOrEqual(9);
    expect(ids.filter((id) => !DRIVER.includes(id))).toEqual([]);
    expect(DRIVER).toMatch(/evaluate_script/); // Chrome-MCP-observable oracle
  });
  test('test_ui_driver_documents_devstack_runbook_and_ec8', () => {
    expect(DRIVER).toMatch(/make dev-up/);
    expect(DRIVER).toMatch(/CODE_QUALITY_NO_NETWORK|dim|platform-admin|register-proxy/i); // ≥1 gotcha
    expect(DRIVER).toMatch(/oracle_unresolvable/); // EC-8
  });
});
