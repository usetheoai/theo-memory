/**
 * T3.3 RED — static-shape validation for `.github/workflows/docker-publish.yml`
 * + `.trivyignore`.
 *
 * Cheap regression guards: the workflow CANNOT push to GHCR without
 * `packages: write` (EC-44) AND the Trivy gate MUST surface CRITICAL +
 * HIGH severities (EC-43 per deps-audit-golden-rule.md). The `.trivyignore`
 * file MUST exist (empty acceptable at v0.1) so the workflow's `trivyignores`
 * input resolves at runtime.
 *
 * Static-string assertions over the YAML rather than a live `actionlint`
 * dependency — keeps the test runtime ~ms with zero external tooling.
 *
 * @see Plan theo-memory-standalone-p0 § T3.3 + EC-43 + EC-44
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/docker-publish.yml');
const TRIVYIGNORE_PATH = resolve(REPO_ROOT, '.trivyignore');

describe('T3.3 — docker-publish workflow + .trivyignore', () => {
  test('45. workflow declares permissions: packages: write (EC-44)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml).toMatch(/permissions:\s*[\s\S]*?packages:\s*write/);
  });

  test('46. workflow declares permissions: contents: read (EC-44)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml).toMatch(/permissions:\s*[\s\S]*?contents:\s*read/);
  });

  test('47. Trivy step gates on CRITICAL + HIGH with exit-code 1 (EC-43)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    // Both severities present + exit-code 1 surfaces failures.
    expect(yaml).toMatch(/aquasecurity\/trivy-action/);
    expect(yaml).toMatch(/severity:\s*CRITICAL,HIGH/);
    expect(yaml).toMatch(/exit-code:\s*['"]?1['"]?/);
    expect(yaml).toMatch(/trivyignores:\s*\.trivyignore/);
  });

  test('48. .trivyignore file exists (empty acceptable at v0.1) (EC-43)', () => {
    const text = readFileSync(TRIVYIGNORE_PATH, 'utf-8');
    // File exists + every non-comment, non-blank line must look like a CVE id.
    const entries = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    for (const entry of entries) {
      expect(entry).toMatch(/^CVE-\d{4}-\d+/);
    }
  });

  test('49. workflow pushes to ghcr.io with sha + semver tags', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml).toMatch(/REGISTRY:\s*ghcr\.io/);
    expect(yaml).toMatch(/themory/);
    expect(yaml).toMatch(/type=semver/);
    expect(yaml).toMatch(/type=sha/);
  });
});
