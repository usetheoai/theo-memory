/**
 * Static-shape validation for `.github/workflows/publish.yml` + `.trivyignore`.
 *
 * The image build/scan/sign/push logic lives in the org's shared reusable
 * `usetheoai/theo/.github/workflows/build-publish.yml`, pinned by commit SHA; `publish.yml` is a
 * thin caller. From 2026-07-27 (#156) to 2026-09-29 it called a VENDORED local copy instead,
 * because the reusable lived under another owner and GitHub does not share a private reusable
 * across owners. The engine moved to `usetheoai`, the copy was deleted, and the tests that
 * guarded the copy's own internals went with it: this repository can no longer read them.
 *
 * @see deps-audit-golden-rule.md § Severity rubric (EC-43 Trivy gate) + EC-44 (permissions)
 */
import { existsSync, readFileSync } from 'node:fs';
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

  test('delegates to the shared usetheoai reusable pinned by commit SHA, requesting the Trivy gate (EC-43)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    // Pinned by a full commit SHA, not by a branch: a moving `@develop` would change how this
    // image is built without a commit in this repository.
    expect(yaml).toMatch(
      /uses:\s*usetheoai\/theo\/\.github\/workflows\/build-publish\.yml@[0-9a-f]{40}\b/,
    );
    expect(yaml, 'the vendored copy must not come back as the reference').not.toMatch(
      /uses:\s*\.\/\.github\/workflows\/build-publish\.yml/,
    );
    expect(yaml).toMatch(/trivy:\s*true/);
    // `theo-memory` is the repository name and the ECR repository name. The critical consumer of
    // this name lives OUTSIDE this repo (the host reconciler): going back to `themory` would break
    // no build and no push, the host would just stop receiving new versions, silently.
    expect(yaml).toMatch(/image:\s*theo-memory\b/);
    expect(yaml, 'the old name must not come back silently').not.toMatch(/image:\s*themory\b/);
  });

  test('the vendored copy of build-publish is gone', () => {
    // Two definitions of one pipeline diverge: the copy had drifted from the shared reusable in
    // eight places, and the shared one gained ECR while the copy did not. Keeping it "just in
    // case" would leave a second pipeline nothing calls and everyone reads.
    expect(existsSync(resolve(REPO_ROOT, '.github/workflows/build-publish.yml'))).toBe(false);
  });

  test('passes the shared reusable only inputs it declares', () => {
    // GitHub refuses the WHOLE workflow at startup, with no log at all, when a caller passes an
    // input the reusable does not declare. Measured in theo-cloud (B-270): `git_sha` and
    // `version_label` killed five runs in under a second, two release tags among them. This
    // repository's vendored copy accepted `attest` and `platforms`, which the shared one does
    // not — carrying them over would have reproduced exactly that.
    //
    // The list is the reusable's `workflow_call.inputs` at the pinned SHA. Bumping the pin to a
    // version that declares more inputs is the moment to extend it.
    const declared = new Set([
      'aws_role_arn', 'build_args', 'context', 'dockerfile', 'dockerhub_image', 'ecr_registry',
      'image', 'registry', 'runner', 'sign', 'trivy', 'verify',
    ]);
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    const job = yaml.slice(yaml.indexOf('\n  image:'));
    const withBlock = /\n    with:\n([\s\S]*?)(?=\n    \S|\n  \S|$)/.exec(job)?.[1] ?? '';
    const passed = [...withBlock.matchAll(/^      ([a-z_]+):/gm)].map((m) => m[1] as string);
    expect(passed.length, 'the image job must pass inputs to the reusable').toBeGreaterThan(0);
    for (const input of passed) {
      expect(declared.has(input), `input not declared by the shared reusable: ${input}`).toBe(true);
    }
  });

  test('publishes to Amazon ECR from repository variables', () => {
    // The platform runs this service from ECR, pinned by commit SHA (usetheoai/theo#446). The
    // registry and the role are repository VARIABLES so the account id is never fixed in text;
    // unset, the reusable skips ECR and GHCR still publishes.
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml).toMatch(/ecr_registry:\s*\$\{\{\s*vars\.ECR_REGISTRY\s*\}\}/);
    expect(yaml).toMatch(/aws_role_arn:\s*\$\{\{\s*vars\.AWS_IMAGE_PUBLISH_ROLE_ARN\s*\}\}/);
    expect(yaml, 'no AWS account id written in the workflow').not.toMatch(/\b\d{12}\b/);
  });

  test('grants the image job every scope the shared reusable declares', () => {
    // GitHub refuses at startup — with no log — a reusable that asks for more than its caller
    // grants (usetheoai/theo#436). The shared reusable declares `attestations: write`, which the
    // workflow-level block here does not carry, so the image job grants it explicitly.
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    const job = yaml.slice(yaml.indexOf('\n  image:'));
    const permissions = /\n    permissions:\n((?:      .*\n)+)/.exec(job)?.[1] ?? '';
    for (const scope of ['contents: read', 'packages: write', 'id-token: write', 'attestations: write']) {
      expect(permissions, `image job must grant ${scope}`).toContain(scope);
    }
  });

  test('test_gaps_conhecidos_tem_dono_e_razao', () => {
    // T4.4 — a auditoria deixou pontos ABERTOS de proposito (fora de escopo,
    // dependentes de terceiro, ou sem evidencia para decidir). Um documento de
    // gaps so vale se cada linha disser QUEM decide e POR QUE nao foi fechado
    // agora; sem isso vira lista de desculpas que ninguem cobra.
    //
    // O gate e estrutural: toda linha de tabela da secao de gaps precisa das
    // colunas preenchidas. Nao julga o conteudo — julga que o conteudo existe.
    const doc = readFileSync(resolve(REPO_ROOT, 'docs/devops-audit-known-gaps.md'), 'utf-8');
    const rows = doc
      .split('\n')
      .filter((l) => l.trim().startsWith('|') && l.includes('|'))
      .filter((l) => !/^\s*\|[\s|:-]+\|\s*$/.test(l))
      .filter((l) => !/\bGap\b.*\bDono\b/.test(l));
    expect(rows.length, 'a tabela de gaps nao pode estar vazia').toBeGreaterThan(3);

    // F-xval-3 — cada gap tem de citar o ID do achado da auditoria que o originou.
    // Sem o ID, ninguem consegue ligar "o que ficou aberto" a "o que a auditoria
    // encontrou": a proxima auditoria re-descobre tudo do zero e o documento vira
    // prosa solta em vez de rastro.
    const ids = doc.match(/DO-D\d[0-9A-Za-z-]+/g) ?? [];
    expect(new Set(ids).size, 'gaps sem ID de achado da auditoria').toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((c) => c.trim());
      expect(cells.length, `linha com colunas faltando: ${row}`).toBe(4);
      for (const cell of cells) {
        expect(cell.length, `celula vazia em: ${row}`).toBeGreaterThan(0);
      }
    }
  });

  test('test_compose_aponta_para_o_registry_que_publicamos', () => {
    // T4.3 — o compose de producao trazia por default `usetheo/theo-memory:0.2.0`,
    // uma coordenada de Docker Hub. Medido em 2026-07-28:
    //   docker.io/usetheo/theo-memory:0.2.0   NAO RESOLVE
    //   ghcr.io/usetheoai/theo-memory:latest  RESOLVE
    //   secrets DOCKERHUB_USERNAME / DOCKERHUB_TOKEN  NAO EXISTEM
    //
    // O push para Docker Hub nunca aconteceu e nao pode acontecer — sem
    // credencial, o passo e pulado em silencio. Quem seguia o compose recebia
    // `manifest unknown`. Caminho documentado que nunca foi percorrido e PIOR que
    // caminho ausente: parece testado.
    //
    // O gate: a coordenada da NOSSA imagem tem de sair do mesmo registry para
    // onde o publish empurra. Imagem de terceiro (pgvector) e outro assunto.
    const compose = readFileSync(resolve(REPO_ROOT, 'docker-compose.prod.yaml'), 'utf-8');
    const ours = compose
      .split('\n')
      .filter((l) => /^\s*image:/.test(l) && /theo-memory|themory/.test(l));
    expect(ours.length, 'o compose deve referenciar a nossa imagem').toBeGreaterThan(0);
    for (const line of ours) {
      expect(line, 'default tem de sair do registry que publicamos').toMatch(
        /ghcr\.io\/usetheoai\/theo-memory/,
      );
    }
    // E o workflow nao pode declarar um canal Docker Hub que nunca publicou.
    expect(readFileSync(WORKFLOW_PATH, 'utf-8')).not.toMatch(/dockerhub_image\s*:/);
  });

  test('test_tamanho_da_imagem_declara_qual_eixo', () => {
    // T4.2 — os dois READMEs diziam "< 200 MB", sem eixo. Medido em 2026-07-28
    // sobre `ghcr.io/usetheoai/theo-memory:develop`:
    //   comprimido    170.5 MB  (o que o registry reporta, 23 camadas)
    //   descomprimido 541.0 MB  (o que `docker images` mostra no disco)
    //
    // A afirmacao nao era FALSA — era ambigua no eixo que importa para quem puxa
    // a imagem, com um fator de 3,2x entre as duas leituras. Um numero de tamanho
    // sem eixo declarado deixa o leitor provisionar disco pelo numero errado.
    for (const f of ['README.md', 'README.pt-BR.md']) {
      const doc = readFileSync(resolve(REPO_ROOT, f), 'utf-8');
      for (const line of doc.split('\n')) {
        // So linhas que falam do tamanho da IMAGEM. Um limite de corpo de
        // requisicao ("1 MB body cap") tambem casa `N MB` e nao tem eixo
        // comprimido/descomprimido — exigir o eixo dele seria ruido.
        if (!/\d+\s*MB/.test(line)) continue;
        if (!/\bimage\b|\bimagem\b|distroless/i.test(line)) continue;
        expect(line, `${f}: numero de tamanho sem eixo declarado`).toMatch(
          /comprimid|compress|descomprimid|uncompress|no disco|on disk/i,
        );
      }
    }
  });

  test('the build receives no credential it does not use', () => {
    // T4.1 — the build used to receive `GOMOD_TOKEN` as a BuildKit secret. Measured: the
    // Dockerfile never mounts it, and there is no `go.mod` anywhere in this repository. A
    // credential handed to a step that does not use it is surface with no return: it is
    // available to ANY `RUN` of the build, and to any layer the Dockerfile gains later.
    //
    // The shared reusable declares it as an OPTIONAL secret for the Go repositories of the org;
    // what this guards is that this caller never passes it.
    const caller = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(caller, 'the caller must not pass a Go credential').not.toMatch(
      /^\s*GOMOD_(TOKEN|SSH_KEY)\s*:/m,
    );
    // Anchored on the YAML key at line start: the comments explain WHY inherit is refused, and a
    // bare-word match would forbid the explanation instead of the construct.
    expect(caller, 'secrets: inherit hands the reusable every secret of the repo').not.toMatch(
      /^\s*secrets:\s*inherit/m,
    );
  });

  test('test_scanner_de_segredo_alcanca_a_prosa_que_diz_alcancar', () => {
    // F-dom-infra-1 — a T3.2 removeu `paths-ignore` do security-sast alegando
    // que prosa e onde credencial vaza por acidente. A alegacao estava certa; a
    // premissa sobre o scanner, NAO: `gitleaks dir /src/packages` nunca leu
    // prosa. README, runbook, docs/ e .claude/ ficavam fora do escopo.
    //
    // Ou seja: a remocao do filtro comprou ZERO cobertura e passou a rodar um
    // job de ~3 min em todo push so-de-docs. A correcao nao e restaurar o
    // filtro — e fazer o scanner alcancar o que eu afirmei que ele alcancava.
    // Gate cuja justificativa nao corresponde ao que ele faz e pior que gate
    // ausente: alguem le a justificativa e para de procurar.
    const sast = readFileSync(resolve(REPO_ROOT, '.github/workflows/security-sast.yml'), 'utf-8');
    const gitleaks = sast.match(/gitleaks[\s\S]{0,600}?--no-banner[^\n]*/)?.[0] ?? '';
    expect(gitleaks, 'o scan de segredo tem de partir da raiz, nao de packages/').toMatch(
      /\bdir\s+\/src\b(?!\/)/,
    );
  });

  test('test_scanner_de_segredo_nao_ignora_prosa', () => {
    // T3.2 — o security-sast roda gitleaks, um scanner de SEGREDO, e ignorava
    // `**/*.md` e `.claude/**`. Segredo colado num README ou num hook pulava o
    // scanner inteiro.
    //
    // Nao e hipotetico: prosa e justamente onde credencial vaza por acidente —
    // um exemplo de configuracao, um runbook, um passo-a-passo de setup. Filtrar
    // por caminho um gate que procura CONTEUDO inverte o proposito dele.
    //
    // Os gates de TESTE podem ignorar prosa (markdown nao muda comportamento de
    // runtime). O de SEGREDO nao pode.
    // Casa a CHAVE YAML, nao a palavra — o comentario que EXPLICA a ausencia e
    // documentacao util, e um teste que proibisse cita-la empurraria a explicacao
    // para fora do arquivo. Mesma licao ja fixada no teste do NODE_AUTH_TOKEN.
    const sast = readFileSync(resolve(REPO_ROOT, '.github/workflows/security-sast.yml'), 'utf-8');
    expect(sast, 'scanner de segredo nao pode filtrar por caminho').not.toMatch(
      /^\s*paths-ignore\s*:/m,
    );
  });

  test('test_tabela_de_publicacao_do_readme_bate_com_o_workflow', () => {
    // F-dom-infra-2 — a tabela dizia "manual dispatch | unsigned build" e citava
    // um canal Docker Hub. Ambos falsos: `sign: true` e incondicional no
    // publish.yml, e `dockerhub_image` foi removido na T4.3.
    //
    // Documentacao que descreve uma garantia de seguranca ERRADA e pior que
    // silencio: um leitor decide confiar (ou nao) num artefato pelo que a tabela
    // afirma.
    const caller = readFileSync(WORKFLOW_PATH, 'utf-8');
    const assinaSempre = /^\s*sign:\s*true\s*$/m.test(caller);
    for (const f of ['README.md', 'README.pt-BR.md']) {
      const doc = readFileSync(resolve(REPO_ROOT, f), 'utf-8');
      if (assinaSempre) {
        expect(doc, `${f}: afirma build nao assinado, mas sign: true e incondicional`).not.toMatch(
          // Cobre as variantes das duas linguas. A primeira versao casava so
          // "build nao assinado" e deu FALSO VERDE sobre "build sem assinatura"
          // no README pt-BR — a afirmacao falsa sobreviveu ao teste que existia
          // para mata-la.
          /unsigned build|build (n[aã]o assinado|sem assinatura)|sem assinatura/i,
        );
      }
      // `sign: true` e incondicional, entao TODO canal da tabela tem de declarar a
      // assinatura — nao so os que alguem lembrou de atualizar. O achado original
      // fechou so em ingles: a linha do `develop` no pt-BR ficou sem a mencao, e o
      // teste (que so proibia "unsigned") nao pegou a OMISSAO.
      if (assinaSempre) {
        const canais = doc
          .split('\n')
          .filter((l) => /^\|\s*(push|dispatch|manual|tag)/i.test(l));
        for (const canal of canais) {
          expect(canal, `${f}: canal sem declarar assinatura`).toMatch(
            /cosign|assinad/i,
          );
        }
      }
      if (!/dockerhub_image\s*:/.test(caller)) {
        expect(doc, `${f}: cita canal Docker Hub que o workflow nao publica`).not.toMatch(
          /Docker Hub `?usetheo\//i,
        );
      }
    }
  });

  test('test_republicacao_manual_nao_dispara_a_suite_cara', () => {
    // F-arch-1 / F-xval-4 / F-wire-1 — confirmado por tres agentes do /review.
    //
    // O job `integration` (OpenAI real, ~28 min) e gateado por
    // `github.event_name == 'workflow_dispatch'`. Um workflow invocado por
    // `workflow_call` enxerga o evento do CHAMADOR — e o publish.yml declara
    // `workflow_dispatch` como escape hatch documentado de republicacao barata.
    //
    // Efeito nao intencional da T1.2: a republicacao manual passou a arrastar a
    // suite cara para dentro do gate, e a falha dela trava o escape hatch.
    // Push nao e afetado; so o dispatch.
    const integration = readFileSync(resolve(REPO_ROOT, '.github/workflows/integration.yml'), 'utf-8');

    // A flag tem de existir como input de `workflow_call` — e so ali. Um input
    // de `workflow_dispatch` seria preenchivel por quem dispara e nao serviria
    // de discriminante.
    expect(integration, 'falta o input que marca invocacao por outro workflow').toMatch(
      // Janela larga de proposito: entre `workflow_call:` e o input ha o bloco de
      // comentario que explica POR QUE a flag existe, e ele e longo. Um limite
      // apertado transformaria "documentei melhor" em teste vermelho.
      /workflow_call:[\s\S]{0,1500}called_by_workflow:/,
    );

    // O guard e multi-linha (`if: >-`), entao a busca cobre o bloco, nao a linha.
    const guard = integration.match(/^\s*if:[\s\S]{0,300}?workflow_dispatch[^\n]*/m)?.[0];
    expect(guard, 'o job caro precisa de uma guarda por evento').toBeTruthy();
    expect(guard, 'a guarda tem de negar a invocacao por workflow_call').toMatch(
      /!\s*inputs\.called_by_workflow/,
    );
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

    // Ancorado na LISTA de `needs`, nao na palavra solta. A versao anterior
    // (`toMatch(/gate-contract/)`) passava com o job removido de `needs`, desde
    // que o job ainda existisse no arquivo — mutacao medida pelo /review
    // (F-tests-1). Um teste que sobrevive a remocao da coisa que ele protege
    // nao protege nada.
    expect(yaml).toMatch(/needs:\s*\[[^\]]*\bgate-ci\b[^\]]*\]/);
    expect(yaml).toMatch(/needs:\s*\[[^\]]*\bgate-contract\b[^\]]*\]/);
    expect(yaml, 'ADR-5: workflow define o build, entao mudanca dele reconstroi').not.toMatch(
      /paths-ignore:[\s\S]{0,200}'\.github\/\*\*'/,
    );
  });

  test('test_dockerfile_parseia_cada_from', () => {
    // Defeito real, pego so pelo run de verdade (F-xval-2): a T2.2 anotou a tag
    // original num comentario NA MESMA LINHA do `FROM`. O Docker so trata `#`
    // como comentario no INICIO da linha — no meio, ele vira argumento, e
    // `FROM img@sha AS builder   # node:22-slim` fica com 5 argumentos.
    //
    //   ERROR: dockerfile parse error on line 38: FROM requires either one or
    //   three arguments
    //
    // O teste anterior conferia que o digest ESTAVA la; nunca que o arquivo
    // PARSEIA. Digest presente num Dockerfile que nao constroi e pior que
    // nenhum: o gate fica verde e a imagem nunca sai.
    const dockerfile = readFileSync(resolve(REPO_ROOT, 'Dockerfile'), 'utf-8');
    for (const [n, line] of dockerfile.split('\n').entries()) {
      if (!/^FROM\s/.test(line)) continue;
      const args = line.trim().split(/\s+/).slice(1);
      expect(
        args.length,
        `Dockerfile:${n + 1} — FROM aceita 1 ou 3 argumentos, tem ${args.length}: ${line}`,
      ).toBeOneOf([1, 3]);
    }
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

  test('signs every published artifact, and does not verify against an identity it cannot match', () => {
    // The signed channel has to be the DEPLOYED channel: the host reconciler pulls `:develop`
    // and the platform pulls ECR by commit SHA, so `sign` must hold for every push, not only for
    // tags. Moving it back to release-only would break no build and no push — it would just leave
    // what runs unsigned again, in silence.
    //
    // `verify` is the opposite case. The shared reusable pins the verified identity to the
    // CALLER's repository, while a certificate produced inside a reusable workflow carries the
    // REUSABLE's path. Measured on the Rekor entry of an image this same reusable signed for
    // theo-cloud: SAN = `https://github.com/usetheoai/theo/.github/workflows/build-publish.yml@…`.
    // `verify: true` would fail every run after the push, reporting red for a published image.
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml, 'sign must hold for every push, not only for tags').toMatch(/^\s*sign:\s*true\s*$/m);
    expect(yaml, 'sign must not become conditional on a tag again').not.toMatch(
      /sign:\s*\$\{\{\s*startsWith\(github\.ref/,
    );
    expect(yaml, 'verify cannot match the reusable identity from a caller repo').toMatch(
      /^\s*verify:\s*false\s*$/m,
    );
  });

  test(':latest only ships from code promoted to main — a tag is not a promotion', () => {
    // `:latest` is the reference PRODUCTION reconciliation consumes. The shared reusable only
    // emits it on `refs/tags/v*`, but a TAG IS NOT A PROMOTION: nothing stops tagging a commit of
    // develop, a work branch or a fork merge. This guard is what makes the release contract
    // (develop -> main by PR, tag on the merge) enforcement rather than discipline.
    //
    // Verified against reality on 2026-07-28 through the compare API:
    //   v0.56.0 (on main)               -> behind   -> accepted
    //   origin/develop (not promoted)   -> diverged -> rejected
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');

    expect(yaml, 'the promotion guard must exist').toMatch(/guard-release-on-main:/);
    expect(yaml, 'the guard only evaluates tags').toMatch(
      /if:\s*\$\{\{\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)\s*\}\}/,
    );
    expect(yaml, 'compares the commit position relative to main').toMatch(
      /compare\/main\.\.\.\$\{SHA\}/,
    );
    expect(yaml, 'only identical and behind mean promoted').toMatch(/identical\|behind\)/);
    // Without the `needs`, the guard would exist and gate nothing — a green job next to a
    // publish that ignored it.
    expect(yaml, 'the image job must DEPEND on the guard').toMatch(
      /needs:[\s\[]*guard-release-on-main/,
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
