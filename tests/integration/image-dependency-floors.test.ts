/**
 * The image's Trivy gate (CRITICAL/HIGH, fixed only) refuses to publish when the runtime
 * installs a dependency below the version that fixed a known CVE. It found exactly that on
 * 2026-08-17 (publish run 31999348916): `fast-uri@3.1.4` (CVE-2026-18446) and
 * `ip-address@10.2.0` (CVE-2026-69192), both transitive through `@modelcontextprotocol/sdk`.
 * No image was published after that run.
 *
 * The gate only runs after a merge to `develop`, so this reads the lockfile — what
 * `pnpm install --frozen-lockfile` in the Dockerfile will actually install — and fails on the
 * pull request instead.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const LOCKFILE = readFileSync(resolve(REPO_ROOT, 'pnpm-lock.yaml'), 'utf-8');

/** First version that fixed the CVE the image gate refused, per package. */
const FIXED_FLOORS: Record<string, { floor: string; cve: string }> = {
  'fast-uri': { floor: '3.1.7', cve: 'CVE-2026-18446, CVE-2026-75899, CVE-2026-84292 and three more' },
  'ip-address': { floor: '10.3.1', cve: 'CVE-2026-69192' },
  // Not in the 2026-08-17 run: published after it, and it would have refused the next one.
  sharp: { floor: '0.35.4', cve: 'GHSA-rgj7-g3m4-5g8c (bundled libheif)' },
};

function resolvedVersions(name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^  '?${escaped}@(\\d+\\.\\d+\\.\\d+)[^:]*'?:`, 'gm');
  return [...new Set([...LOCKFILE.matchAll(pattern)].map((m) => m[1] as string))];
}

function isBelow(version: string, floor: string): boolean {
  const a = version.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

describe('the lockfile installs no dependency below the version that fixed a gated CVE', () => {
  for (const [name, { floor, cve }] of Object.entries(FIXED_FLOORS)) {
    test(`${name} resolves at or above ${floor} (${cve})`, () => {
      const versions = resolvedVersions(name);
      expect(versions.length, `${name} is no longer in the lockfile — drop this floor`).toBeGreaterThan(0);
      for (const version of versions) {
        expect(isBelow(version, floor), `${name}@${version} is below ${floor}, which fixed ${cve}`).toBe(
          false,
        );
      }
    });
  }
});
