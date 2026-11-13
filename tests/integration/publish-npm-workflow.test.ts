/**
 * O publish no npm autoriza por OIDC (trusted publishing) — sem token armazenado.
 *
 * Este arquivo existe por causa de um modo de falha especifico e silencioso: se
 * `NODE_AUTH_TOKEN` voltar ao step de publish, o npm pode autenticar por ele e o
 * publish passa MESMO com a configuracao OIDC quebrada. A migracao pareceria
 * feita sem estar, e a descoberta viria no dia em que o token fosse revogado —
 * ou seja, no pior dia possivel.
 *
 * Assertions estaticas sobre YAML: sem rede, sem banco. Roda no gate de contrato.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/publish-npm.yml');

function workflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf-8');
}

describe('publish-npm — trusted publishing por OIDC', () => {
  test('declara id-token: write, sem o qual nao existe token OIDC para trocar', () => {
    expect(workflow()).toMatch(/permissions:[\s\S]*?id-token:\s*write/);
  });

  test('nenhum job sobrescreve permissions — isso mataria o id-token herdado', () => {
    // Permissions no nivel do job SUBSTITUEM as do workflow, nao somam. Um job
    // que declarasse `permissions: contents: read` perderia o id-token e o
    // publish cairia — com erro de autenticacao, nao de permissao, o que manda
    // quem investiga para o lado errado.
    const jobLevel = workflow()
      .split('\n')
      .filter((l) => /^ {4}permissions:/.test(l));
    expect(jobLevel, 'permissions deve ficar so no nivel do workflow').toHaveLength(0);
  });

  test('o step de publish NAO usa NODE_AUTH_TOKEN', () => {
    // A assercao central. Ver o cabecalho deste arquivo.
    //
    // Casa a ATRIBUICAO (chave YAML), nao a palavra: comentario que EXPLICA por
    // que o token nao esta aqui e documentacao util, e um teste que proibisse
    // citar o nome empurraria justamente a explicacao para fora do arquivo.
    expect(workflow(), 'token no publish mascara configuracao OIDC quebrada').not.toMatch(
      /^\s*NODE_AUTH_TOKEN\s*:/m,
    );
    // E o secret tambem nao pode reentrar por outro nome de variavel.
    expect(workflow(), 'nenhuma variavel pode receber o secret NPM_TOKEN').not.toMatch(
      /^\s*[A-Z_]+\s*:\s*\$\{\{\s*secrets\.NPM_TOKEN/m,
    );
  });

  test('setup-node e Node atendem o minimo do recurso', () => {
    const yaml = workflow();
    // Abaixo de v6 o setup-node nao repassa o token OIDC ao npm.
    expect(yaml).toMatch(/actions\/setup-node@[0-9a-f]{40}\s*#\s*v[6-9]/);
    // Trusted publishing exige Node >= 22.14.0.
    expect(yaml).toMatch(/node-version:\s*'22\.1[4-9]|node-version:\s*'2[3-9]/);
  });

  test('o npm e elevado a >= 11.5.1 — o Node 22 embarca 10.x', () => {
    // Sem este passo o publish por OIDC nem e TENTADO: o npm 10 nao conhece o
    // recurso. Com o token removido isso vira falha; com o token presente,
    // viraria silencio.
    expect(workflow()).toMatch(/npm install -g npm@\^?11\.[5-9]|npm@latest/);
  });

  test('o nome do arquivo casa com o trusted publisher registrado', () => {
    // O npmjs.com amarra a autorizacao ao NOME do workflow. Renomear este
    // arquivo quebra o publish, e o erro nao diz que foi o rename.
    expect(WORKFLOW_PATH.endsWith('/publish-npm.yml')).toBe(true);
  });

  test('nao usa environment — o publisher foi registrado sem um', () => {
    // Se o trusted publisher e registrado SEM environment, um `environment:` no
    // workflow faz o claim divergir e a autorizacao e negada.
    expect(workflow()).not.toMatch(/^\s+environment:/m);
  });

  test('test_publish_npm_exige_tag_no_head_de_main', () => {
    // T1.1 — o canal npm dispara no MESMO evento que o da imagem
    // (`push: tags: v*`), mas nascia sem guarda: `npm publish --access public`
    // saia de qualquer tag, promovida ou nao.
    //
    // EC-4 — aceita SO `identical`, nao `identical|behind`. A guarda da imagem
    // aceita `behind` porque re-release de versao antiga e legitimo la. No npm
    // e o oposto: uma versao NOVA apontando para codigo ANTIGO publica sem
    // conflito e vira `latest` no registry, sem sinal algum. Releases de npm
    // saem sempre do head de `main`.
    const yaml = workflow();

    expect(yaml).toMatch(/guard-release-on-main:/);
    expect(yaml).toMatch(/needs:\s*guard-release-on-main/);
    expect(yaml).toMatch(/identical\)/);
    expect(yaml, 'behind abriria caminho de downgrade no registry').not.toMatch(
      /identical\|behind/,
    );
  });
});
