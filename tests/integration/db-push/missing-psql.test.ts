import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * EC-9 absorption (plan v1.1): when `psql` is absent from PATH, the
 * applyTriggerMigrations helper MUST throw with a message that anchors
 * at `README.md § Quickstart › Prerequisites`. Verified by overriding
 * `PATH` to an empty directory so the `psql` resolution fails.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T2.1 Acceptance (EC-9 absorption line 360)
 */

const helperPath = resolve(__dirname, '..', '..', '..', 'scripts', 'apply-trigger-migrations.mjs');
const helperUrl = pathToFileURL(helperPath).href;

interface TriggerHelper {
  applyTriggerMigrations(connectionString: string): Promise<{ appliedFiles: string[] }>;
}

describe('F-dom-db-2 / EC-9: missing psql error message (T2.1)', () => {
  it('throws with an anchored message pointing at README § Quickstart › Prerequisites', async () => {
    // Given: PATH is overridden to a non-existent directory so `psql` cannot resolve
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '/nonexistent-bin-path-for-test';
    try {
      // Force a fresh import so the module reads the mutated PATH at psqlOnPath()
      const helper = (await import(`${helperUrl}?t=${Date.now()}`)) as TriggerHelper;
      await expect(
        helper.applyTriggerMigrations('postgresql://user:pw@localhost:5432/db'),
      ).rejects.toThrow(/README § Quickstart › Prerequisites/);
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});
