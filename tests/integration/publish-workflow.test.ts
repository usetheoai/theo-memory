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

  test('arm64 e construido na release e NAO em todo push de develop (custo de emulacao)', () => {
    // Duas assercoes com intencoes opostas, de proposito.
    //
    // (1) A capacidade tem de existir: uma imagem so-amd64 nao roda em no
    //     Graviton, e o erro no cluster e obscuro. O delta medido entre a
    //     familia AMD e o Graviton foi ~$100/mes numa maquina de 8 vCPU/32 GB.
    //
    // (2) Ela NAO pode estar ligada em develop: arm64 aqui sai por emulacao
    //     (QEMU) sobre um build que ja leva ~14 min a frio pelo double-build do
    //     gate Trivy. Ligar em todo push cobraria esse preco por iteracao, sem
    //     consumidor ARM hoje. Este teste e o que impede a mudanca silenciosa —
    //     ela nao quebraria nada, so tornaria cada push mais lento, e ninguem
    //     ligaria uma coisa a outra semanas depois.
    const caller = readFileSync(WORKFLOW_PATH, 'utf-8');
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');

    expect(vendored, 'o reusable precisa aceitar platforms como input').toMatch(
      /platforms:\s*\{\s*required:\s*false/,
    );
    expect(vendored, 'o default tem de ser amd64 — custo zero para quem nao opta').toMatch(
      /platforms:[\s\S]{0,80}default:\s*"linux\/amd64"/,
    );
    expect(vendored, 'o build precisa repassar o input ao build-push-action').toMatch(
      /platforms:\s*\$\{\{\s*inputs\.platforms\s*\}\}/,
    );
    expect(vendored, 'QEMU e necessario para cross-arch e deve ser condicional').toMatch(
      /setup-qemu-action@[0-9a-f]{40}/,
    );

    // O chamador liga arm64 SOMENTE em tag de release.
    expect(caller, 'arm64 so na release').toMatch(
      /platforms:\s*\$\{\{\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)\s*&&\s*'linux\/amd64,linux\/arm64'\s*\|\|\s*'linux\/amd64'/,
    );
  });

  test('o reusable EXPORTA o digest — sem isso o deploy nao tem como ser idempotente', () => {
    // O digest e o unico identificador imutavel do que foi publicado. Ele ja era
    // calculado e usado para assinar, mas morria no fim do job: `workflow_call`
    // nao declarava `outputs`, entao nenhum consumidor o recebia e o deploy tinha
    // de resolver a TAG no momento do pull. Tag se move — duas aplicacoes "da
    // mesma versao" podem trazer imagens diferentes, e a idempotencia morre ai.
    //
    // Este teste existe porque a perda e SILENCIOSA: remover o bloco `outputs`
    // nao quebra build, push, assinatura nem verificacao. So quebra quem consome.
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');

    // Nivel workflow_call — o que o chamador enxerga.
    expect(vendored, 'workflow_call precisa declarar o output digest').toMatch(
      /outputs:[\s\S]*?digest:[\s\S]*?value:\s*\$\{\{\s*jobs\.build-publish\.outputs\.digest/,
    );
    expect(vendored, 'workflow_call precisa declarar o output image_ref').toMatch(
      /image_ref:[\s\S]*?value:\s*\$\{\{\s*jobs\.build-publish\.outputs\.image_ref/,
    );

    // Nivel job — a ponte ate o step que realmente produz o digest.
    expect(vendored, 'o job precisa mapear digest a partir do step de build').toMatch(
      /digest:\s*\$\{\{\s*steps\.build\.outputs\.digest\s*\}\}/,
    );
    expect(vendored, 'image_ref precisa ser fixado por @digest, nunca por tag').toMatch(
      /image_ref:\s*\$\{\{\s*inputs\.registry\s*\}\}\/\$\{\{\s*inputs\.image\s*\}\}@\$\{\{\s*steps\.build\.outputs\.digest/,
    );
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
