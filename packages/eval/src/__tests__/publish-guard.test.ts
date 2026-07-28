/**
 * T0.1 — Publish guard.
 *
 * D1's central risk (Drawbacks & Risks): `@usetheo/memory-eval` sits adjacent
 * to four PUBLISHED packages in the workspace. The established fix is to keep the
 * eval in a separate repo; we keep it in-monorepo, so the fence is:
 *
 *   1. `package.json` MUST be `"private": true` (npm refuses to publish).
 *   2. The package name MUST NOT appear in `.github/workflows/publish.yml`
 *      (the real publish mechanism — Docker-image builds only; an npm-publish
 *      matrix would name the package if it were a target).
 *
 * This test fails-closed if either fence is removed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PKG_NAME = '@usetheo/memory-eval';

function readOwnPackageJson(): { private?: boolean; name?: string } {
  const url = new URL('../../package.json', import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf-8')) as {
    private?: boolean;
    name?: string;
  };
}

function readPublishWorkflow(): string {
  const url = new URL('../../../../.github/workflows/publish.yml', import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8');
}

describe('publish guard', () => {
  it('test_eval_package_is_private_and_not_in_publish_matrix', () => {
    const pkg = readOwnPackageJson();
    expect(pkg.name).toBe(PKG_NAME);
    // Fence 1 — npm refuses to publish a private package.
    expect(pkg.private).toBe(true);
    // Fence 2 — the package is never a publish target.
    const workflow = readPublishWorkflow();
    expect(workflow).not.toContain(PKG_NAME);
  });
});
