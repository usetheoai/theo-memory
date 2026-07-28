/**
 * Static-shape validation for `.github/workflows/publish.yml` + `.trivyignore`.
 *
 * After the org-standardization convergence, the image build/scan/sign logic lived in the shared
 * reusable `theo/build-publish.yml`; `publish.yml` was a thin caller. Desde 2026-07-27 (#156) a
 * delegação aponta para uma CÓPIA VENDORIZADA local — este repo migrou para a org `usetheoai` e o
 * GitHub não compartilha reusable PRIVADO cross-owner, então a chamada ao `theo` (que segue em
 * `usetheodev`) falhava no parse do workflow.
 *
 * ESTES TESTES SÃO O ALARME CONTRA A CÓPIA VIRAR PERMANENTE. Quando `usetheodev/theo` migrar para
 * `usetheoai`: volte o `uses:` para o reusable, APAGUE `.github/workflows/build-publish.yml` e
 * atualize os três testes abaixo no MESMO commit. Se um andar sem o outro, isto fica vermelho.
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

  test('delegates to the VENDORED local build-publish, requesting the Trivy gate (EC-43)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    // Era `usetheodev/theo/.github/workflows/build-publish.yml@`. Passou a ser a cópia LOCAL em
    // 2026-07-27 (#156): este repo foi para a org `usetheoai` e o GitHub não compartilha reusable
    // PRIVADO cross-owner, então a chamada ao `theo` falhava no parse do workflow.
    expect(yaml).toMatch(/uses:\s*\.\/\.github\/workflows\/build-publish\.yml/);
    expect(yaml).toMatch(/trivy:\s*true/);
    expect(yaml).toMatch(/image:\s*themory\b/);
  });

  test('the vendored copy exists and publishes to the usetheoai namespace', () => {
    // Guarda de coerência: enquanto o `publish.yml` apontar para a cópia local, ela TEM de existir.
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');
    expect(vendored).toMatch(/registry:\s*\{[^}]*default:\s*"ghcr\.io\/usetheoai"/);
    // O caller sobrescreve explicitamente — o default sozinho não é garantia suficiente.
    expect(readFileSync(WORKFLOW_PATH, 'utf-8')).toMatch(/registry:\s*ghcr\.io\/usetheoai/);
  });

  test('the vendored cosign identity is pinned to THIS repo, not to the origin repo', () => {
    // O guard de confused-deputy (EC-2) deriva a identidade keyless de repo + path do workflow.
    // Se a cópia mantivesse o regexp do original (`usetheodev/theo`), a verificação de release
    // falharia — e um regexp apontando para outro repo aceitaria assinatura de terceiro.
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');
    expect(vendored).toMatch(/certificate-identity-regexp.*usetheoai\\?\/theo-memory/);
    expect(vendored).not.toMatch(/certificate-identity-regexp.*usetheodev\\?\/theo\\?\//);
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
