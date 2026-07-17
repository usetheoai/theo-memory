/**
 * Static-shape validation for `.github/workflows/publish.yml` + `.trivyignore`.
 *
 * After the org-standardization convergence, the image build/scan/sign logic lives in the
 * shared reusable `theo/build-publish.yml`; `publish.yml` is a thin caller. These guards
 * assert the DELEGATION + that the Trivy gate is REQUESTED (`trivy: true`) and that signing +
 * identity-pinned verify happen on a release tag. The Trivy/build/push implementation is the
 * reusable's contract, governed in the `theo` repo.
 *
 * @see deps-audit-golden-rule.md § Severity rubric (EC-43 Trivy gate) + EC-44 (permissions)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/publish.yml');
const TRIVYIGNORE_PATH = resolve(REPO_ROOT, '.trivyignore');

describe('publish workflow (caller of the reusable build-publish) + .trivyignore', () => {
  test('declares permissions: packages: write (EC-44)', () => {
    expect(readFileSync(WORKFLOW_PATH, 'utf-8')).toMatch(/permissions:\s*[\s\S]*?packages:\s*write/);
  });

  test('declares permissions: contents: read (EC-44)', () => {
    expect(readFileSync(WORKFLOW_PATH, 'utf-8')).toMatch(/permissions:\s*[\s\S]*?contents:\s*read/);
  });

  test('grants id-token: write for keyless cosign OIDC', () => {
    expect(readFileSync(WORKFLOW_PATH, 'utf-8')).toMatch(/id-token:\s*write/);
  });

  test('delegates to the shared reusable build-publish, requesting the Trivy gate (EC-43)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml).toMatch(/usetheodev\/theo\/\.github\/workflows\/build-publish\.yml@/);
    expect(yaml).toMatch(/trivy:\s*true/);
    expect(yaml).toMatch(/image:\s*themory\b/);
  });

  test('requests cosign sign + identity-pinned verify on a release tag (decision 1 / EC-2)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml).toMatch(/sign:\s*\$\{\{\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)/);
    expect(yaml).toMatch(/verify:\s*\$\{\{\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)/);
  });

  test('.trivyignore exists; every non-comment line is a CVE id (EC-43)', () => {
    const text = readFileSync(TRIVYIGNORE_PATH, 'utf-8');
    const entries = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    for (const entry of entries) {
      expect(entry).toMatch(/^CVE-\d{4}-\d+/);
    }
  });
});
