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

const workflowText = (): string => readFileSync(WORKFLOW_PATH, 'utf-8');

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
    // `theo-memory`, o nome do repositorio — padrao dos irmaos (theo-lens ->
    // theo-lens, theo-rag -> theo-rag, theo-db -> theo-db). Era `themory` ate
    // 2026-07-28.
    //
    // A segunda assercao existe porque o consumidor critico deste nome esta FORA
    // deste repo: o reconciliador do host (dev/theo-memory/reconcile.sh). Voltar
    // para `themory` aqui nao quebraria build nem push — so faria o host parar de
    // receber versao nova, convergindo para sempre na ultima imagem antiga, sem
    // erro algum.
    expect(yaml).toMatch(/image:\s*theo-memory\b/);
    expect(yaml, 'o nome antigo nao pode voltar em silencio').not.toMatch(/image:\s*themory\b/);
  });

  test('test_job_de_build_tem_timeout', () => {
    // T3.1 — o job mais caro do repo rodava com o teto padrao de 360 min numa frota
    // cobrada por MINUTO (Blacksmith): um job pendurado e caixa, nao cota.
    //
    // O detalhe que torna isto nao-obvio: o GitHub NAO honra `timeout-minutes` em job
    // `uses:`. Aplica-lo em publish.yml — o lugar obvio — seria silenciosamente inerte.
    // O unico lugar onde funciona e dentro do proprio reusable.
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');
    expect(vendored).toMatch(/timeout-minutes:\s*\d+/);
  });

  test('test_imagem_so_publica_apos_os_gates', () => {
    // T1.2 — publish.yml tinha UM `needs` (a propria guarda) e nao existe
    // `workflow_run` em nenhum workflow, entao a imagem era construida e empurrada
    // EM PARALELO ao CI. Push com teste vermelho publicava :develop, e o
    // reconciliador o puxava em <=5 min.
    //
    // ADR-5: publish.yml deixa de ignorar `.github/**`. O comentario que justificava
    // o ignore ("mudar um workflow nao muda a imagem") e falso para build-publish.yml,
    // que DEFINE como a imagem e construida. Sem essa remocao, invocar os gates daqui
    // os faria herdar o ignore e mudanca de workflow deixaria de rodar os testes que
    // validam workflows — inclusive este.
    const yaml = workflowText();

    expect(yaml).toMatch(/needs:[\s\S]{0,140}gate-ci/);
    expect(yaml).toMatch(/gate-contract/);
    expect(yaml, 'ADR-5: workflow define o build, entao mudanca dele reconstroi').not.toMatch(
      /paths-ignore:[\s\S]{0,200}'\.github\/\*\*'/,
    );
  });

  test('test_identidade_do_cosign_e_ancorada', () => {
    // T2.3 — o regexp terminava em `build-publish\\.yml@` SEM ancora terminal, entao
    // qualquer coisa depois do `@` casava. O guard existe para impedir que assinatura
    // produzida por outro workflow seja aceita; casamento aberto o enfraquece.
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');
    expect(vendored, 'sem ancora terminal, qualquer ref casa').toMatch(/build-publish\\\.yml@refs\/\(heads\|tags\)\/\.\+\$/);
  });

  test('test_bases_do_dockerfile_pinadas_por_digest', () => {
    // T2.2 — a cadeia pina as ENTRADAS (21/21 actions por SHA) e assina a SAIDA
    // (cosign no digest), mas a base sobre a qual tudo e construido flutuava numa
    // tag continuamente reconstruida (:nonroot). Era o unico elo movel.
    //
    // EC-2 — digest de INDICE, nao de plataforma. A release e multi-arch
    // (amd64+arm64); pinar o manifesto amd64 passaria verde em develop e
    // quebraria so na tag, ao resolver a base para arm64.
    const dockerfile = readFileSync(resolve(REPO_ROOT, 'Dockerfile'), 'utf-8');
    const froms = dockerfile.split('\n').filter((l) => l.startsWith('FROM'));

    expect(froms).toHaveLength(3);
    for (const line of froms) expect(line).toMatch(/@sha256:[0-9a-f]{64}/);
  });

  test('test_gates_de_seguranca_usam_digest_nao_tag', () => {
    // T2.1 — security-sast.yml rodava `semgrep/semgrep` (tag implicita :latest) e
    // `gitleaks:latest`, ambos com $PWD montado RW, enquanto actionlint.yml no MESMO
    // repo digest-pina e comenta que ":latest num gate de seguranca e a mesma classe
    // de risco". O principio estava escrito e nao aplicado justamente no arquivo que
    // roda os scanners.
    //
    // EC-2: o digest e o do INDICE (manifest list), nao o de plataforma — pinar o
    // manifesto amd64 quebraria qualquer consumidor arm64.
    const sast = readFileSync(resolve(REPO_ROOT, '.github/workflows/security-sast.yml'), 'utf-8');
    const integration = readFileSync(resolve(REPO_ROOT, '.github/workflows/integration.yml'), 'utf-8');

    expect(sast).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(sast, 'tag mutavel num gate de seguranca').not.toMatch(/docker run[^\n]*:latest/);
    expect(sast, 'semgrep sem tag resolve :latest').not.toMatch(/semgrep\/semgrep\s/);
    expect(integration, 'service container tambem e dependencia').toMatch(/image:\s*\S+@sha256:[0-9a-f]{64}/);
  });

  test('a divida da copia vendorizada tem sunset, e ele ainda nao venceu', () => {
    // O cabecalho da copia sempre disse "DIVIDA CONSCIENTE, COM DATA DE VALIDADE"
    // — e ate 2026-07-28 nao trazia data nenhuma. Prosa que nao expira nao e
    // prazo, e intencao; e intencao nao segura duplicacao de pipeline.
    //
    // Este teste faz a data existir de fato. Ao vencer, ha duas saidas honestas,
    // e as duas exigem um commit: migrar (apagar a copia, voltar ao reusable) ou
    // estender a data RECONHECENDO que a divergencia ganhou mais um trimestre.
    // O que ele impede e a terceira saida, a que acontece sozinha: esquecer.
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');

    const match = /SUNSET (\d{4})-(\d{2})-(\d{2})/.exec(vendored);
    expect(match, 'o cabecalho precisa declarar SUNSET YYYY-MM-DD').not.toBeNull();

    const [, y, m, d] = match as RegExpExecArray;
    const sunset = Date.UTC(Number(y), Number(m) - 1, Number(d));
    const hoje = Date.now();

    expect(
      hoje,
      `A copia vendorizada de build-publish.yml venceu em ${y}-${m}-${d}.\n` +
        'Duas saidas, ambas com commit:\n' +
        '  (a) usetheodev/theo migrou para usetheoai? Apague o arquivo, devolva\n' +
        '      publish.yml para `uses: usetheoai/theo/...` e atualize os testes\n' +
        '      desta suite no MESMO commit.\n' +
        '  (b) Ainda nao migrou? Estenda o SUNSET no cabecalho, ciente de que as\n' +
        '      quatro divergencias documentadas continuam crescendo.\n',
    ).toBeLessThan(sunset);
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

  test('assina TODO artefato publicado, e atesta (SBOM/SLSA) so na release', () => {
    // O canal assinado tem de ser o canal IMPLANTADO. O reconciliador do host
    // puxa `:develop` a cada 5 min; com `sign` amarrado a tag de release, era
    // exatamente o artefato em execucao que nao tinha assinatura — a garantia
    // vivia num canal que ninguem roda.
    //
    // A separacao entre `sign` e `attest` e o que torna isso possivel: cosign
    // custa segundos, enquanto SBOM + proveniencia mode=max e o export pesado
    // (o reusable registra que o cache do GHA devolve 500/BlobNotFound nele).
    // Empacotados, a unica escolha viavel era "tudo na release".
    //
    // Este teste trava as duas pontas para que a regressao seja ruidosa: voltar
    // `sign` para release-only nao quebraria build nem push — so deixaria o que
    // roda sem assinatura, de novo, e em silencio.
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');

    expect(yaml, 'sign tem de valer para todo push, nao so para tag').toMatch(/sign:\s*true/);
    expect(yaml, 'verificar junto — assinar sem verificar nao prova nada').toMatch(
      /verify:\s*true/,
    );
    expect(yaml, 'sign NAO pode voltar a ser condicional a tag').not.toMatch(
      /sign:\s*\$\{\{\s*startsWith\(github\.ref/,
    );
    expect(yaml, 'attest (export pesado) fica restrito a release').toMatch(
      /attest:\s*\$\{\{\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)/,
    );

    // E o reusable precisa mesmo tratar os dois como inputs distintos.
    expect(vendored, 'attest tem de ser input proprio').toMatch(
      /attest:\s*\{\s*required:\s*false/,
    );
    expect(vendored, 'sbom/provenance seguem attest, nao sign').toMatch(
      /sbom:\s*\$\{\{\s*inputs\.attest\s*\}\}[\s\S]{0,120}provenance:\s*\$\{\{\s*inputs\.attest/,
    );
  });

  test(':latest so sai de codigo promovido a main — tag nao e promocao', () => {
    // `:latest` e a referencia que a reconciliacao de PRODUCAO consome.
    //
    // Ela ja era condicionada a `refs/tags/v*`, mas TAG NAO E PROMOCAO: nada
    // impedia taggear um commit de develop, de um branch de trabalho ou de um
    // fork-merge e publicar :latest a partir dele. O contrato do ciclo de
    // release (develop -> main por PR, tag no merge) era DISCIPLINA, e a
    // diferenca entre disciplina e enforcement so aparece no dia em que alguem
    // taggeia no lugar errado — com producao puxando.
    //
    // Verificado contra a realidade em 2026-07-28 via a API de compare:
    //   v0.56.0 (em main)        -> behind    -> aceita
    //   origin/develop (nao promovido) -> diverged -> rejeita
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    const vendored = readFileSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'), 'utf-8');

    expect(vendored, ':latest continua restrito a tag semver').toMatch(
      /value=latest,enable=\$\{\{\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)/,
    );
    expect(yaml, 'a guarda de promocao precisa existir').toMatch(/guard-release-on-main:/);
    expect(yaml, 'a guarda so avalia tags').toMatch(
      /if:\s*\$\{\{\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)\s*\}\}/,
    );
    expect(yaml, 'compara a posicao do commit em relacao a main').toMatch(
      /compare\/main\.\.\.\$\{SHA\}/,
    );
    expect(yaml, 'so identical e behind significam promovido').toMatch(/identical\|behind\)/);
    // Sem o `needs`, a guarda existiria mas nao gatearia nada — o modo de falha
    // mais silencioso possivel: um job verde ao lado de um publish que ignorou.
    expect(yaml, 'o job da imagem precisa DEPENDER da guarda').toMatch(
      /needs:[\s\[]*guard-release-on-main/,   // lista desde T1.2: [guard, gate-ci, gate-contract]
    );
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
