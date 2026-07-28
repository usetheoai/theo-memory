/**
 * T1.5 RED — o pacote precisa ser publicável e o binário precisa executar.
 *
 * Dois defeitos independentes tornavam isso impossível:
 *
 *  1. Nenhum pacote publicável declara `bin`. O único `bin` do workspace está no
 *     `package.json` da RAIZ, que é `private` — logo, nunca chega ao registry.
 *  2. O artefato construído não começa com shebang, e o npm NÃO injeta um. Um
 *     `bin` sem shebang é um arquivo que o shell não sabe executar.
 *
 * O terceiro teste é o que sustenta M0: um pacote publicado não pode depender de
 * pacote `private` do workspace — a instalação quebraria no consumidor.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(PKG_DIR, '..', '..');

function manifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('manifesto publicável do CLI', () => {
  it('test_manifesto_declara_bin_files_exports_e_engines', () => {
    const pkg = manifest();
    // `private` segue true DE PROPOSITO ate T1.6: o build deposita o artefato no
    // dist/ da raiz, entao o tarball sairia VAZIO — e numero de versao queimado no
    // registry nao volta. Os demais campos ja estao prontos; o flip e a ultima
    // etapa, depois que o pack for provado.
    expect(pkg['private'], 'flip do private pertence a T1.6, apos o pack ser provado').toBe(true);
    expect(pkg['bin'], 'sem bin não existe comando instalável').toBeDefined();
    expect(pkg['files'], 'sem files[] o tarball vira loteria').toBeDefined();
    expect(pkg['exports']).toBeDefined();
    expect((pkg['engines'] as Record<string, string> | undefined)?.['node']).toMatch(/20/);
    expect((pkg['publishConfig'] as Record<string, string> | undefined)?.['access']).toBe('public');
  });

  it('test_pacote_nao_declara_dependencia_de_pacote_privado', () => {
    const deps = Object.keys((manifest()['dependencies'] as Record<string, string>) ?? {});
    // Cada dependência precisa existir no registry. Um `workspace:*` para pacote
    // private instala no dev e quebra no consumidor — o pior tipo de defeito.
    for (const dep of deps) {
      if (!dep.startsWith('@usetheo/')) continue;
      const depPkgPath = resolve(
        REPO_ROOT,
        'packages',
        dep.replace('@usetheo/memory-', '').replace('@usetheo/memory', 'core'),
        'package.json',
      );
      const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf8')) as Record<string, unknown>;
      expect(depPkg['private'], `${dep} é private e não pode ser dependência publicada`).not.toBe(
        true,
      );
    }
  });

  it('test_versao_do_manifesto_nao_e_placeholder', () => {
    // `--version` mentindo é o primeiro dado que se perde num relatório de bug.
    expect(manifest()['version']).not.toBe('0.0.0');
  });

  it('test_versao_exibida_bate_com_a_do_manifesto', () => {
    // Assere o ARTEFATO, nao o fonte: e o artefato que o consumidor executa.
    // Divergir aqui custa caro no primeiro relatorio de bug — o operador informa
    // uma versao que nao corresponde ao que instalou.
    const artefato = resolve(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
    const src = readFileSync(artefato, 'utf8');
    const declarada = manifest()['version'] as string;

    expect(src, 'placeholder de versao nao foi substituido no build').not.toContain(
      '__CLI_VERSION__',
    );
    expect(src).toContain(`const CLI_VERSION = '${declarada}'`);
  });

  it('test_primeira_linha_do_artefato_e_shebang_de_node', () => {
    const artefato = resolve(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
    let src: string;
    try {
      src = readFileSync(artefato, 'utf8');
    } catch {
      // Sem build, o teste não tem o que afirmar — mas não pode passar em silêncio.
      throw new Error(`artefato ausente em ${artefato}; rode \`pnpm run build\` antes`);
    }
    expect(src.split('\n')[0]).toBe('#!/usr/bin/env node');
  });
});
