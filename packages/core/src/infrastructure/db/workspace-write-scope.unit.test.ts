/**
 * O fallback single-tenant é uma DECLARAÇÃO, e este arquivo é o que impede que
 * ele volte a ser um default.
 *
 * A pergunta que motivou estes testes: o que impede o fallback de valer num
 * deploy multi-inquilino? A resposta tem de ser mecanismo, não intenção — e
 * mecanismo se verifica sem banco, que é o caso aqui.
 *
 * @see workspace-write-scope.ts
 */
import type { Pool } from 'pg';
import { afterEach, describe, expect, test } from 'vitest';

import { WorkspaceScopeError, withWorkspaceScope } from './workspace-scope.js';
import { tenantScopedPool } from './tenant-scoped-pool.js';
import {
  configureWorkspaceWritesFromPool,
  currentWorkspaceWriteMode,
  requireStrictWorkspaceWrites,
  resetWorkspaceWriteModeForTests,
  workspaceIdForWrite,
} from './workspace-write-scope.js';

/** Um `Pool` o bastante para o Proxy embrulhar; nada aqui toca o banco. */
function fakePool(): Pool {
  return { connect: () => Promise.resolve(), query: () => Promise.resolve() } as unknown as Pool;
}

afterEach(() => {
  resetWorkspaceWriteModeForTests();
});

describe('modo de escrita de workspace', () => {
  test('o_padrao_e_estrito_antes_de_qualquer_declaracao', () => {
    // O default importa mais que qualquer outra asserção deste arquivo: é o que
    // vale num caminho que ninguém configurou.
    expect(currentWorkspaceWriteMode()).toEqual({ kind: 'strict' });
  });

  test('estrito_sem_escopo_lanca_em_vez_de_escolher_um_balde', () => {
    expect(() => workspaceIdForWrite('addHistory')).toThrow(WorkspaceScopeError);
    // A mensagem tem de dizer o que fazer, ou vira só uma indisponibilidade.
    expect(() => workspaceIdForWrite('addHistory')).toThrow(/withWorkspaceScope/);
  });

  test('estrito_com_escopo_devolve_o_workspace_da_requisicao', async () => {
    const got = await withWorkspaceScope('ws-a', () =>
      Promise.resolve(workspaceIdForWrite('addHistory')),
    );

    expect(got).toBe('ws-a');
  });

  test('um_pool_ESCOPADO_mantem_o_modo_estrito', () => {
    configureWorkspaceWritesFromPool(tenantScopedPool(fakePool()));

    expect(currentWorkspaceWriteMode()).toEqual({ kind: 'strict' });
    expect(() => workspaceIdForWrite('addHistory')).toThrow(WorkspaceScopeError);
  });

  test('um_pool_CRU_declara_single_tenant_e_so_entao_o_fallback_existe', () => {
    configureWorkspaceWritesFromPool(fakePool());

    expect(currentWorkspaceWriteMode()).toEqual({ kind: 'single-tenant', workspaceId: 'default' });
    expect(workspaceIdForWrite('addHistory')).toBe('default');
  });

  test('mesmo_declarado_single_tenant_um_escopo_explicito_nao_e_ignorado', async () => {
    // Um consumidor do SDK que decida usar escopos não deve ver suas escritas
    // caírem no balde: a declaração é sobre o que fazer na AUSÊNCIA de escopo.
    configureWorkspaceWritesFromPool(fakePool());

    const got = await withWorkspaceScope('ws-a', () =>
      Promise.resolve(workspaceIdForWrite('addHistory')),
    );

    expect(got).toBe('ws-a');
  });

  test('um_store_montado_direto_sobre_pool_cru_tambem_declara', async () => {
    // A fronteira é o pool entrando num STORE, não a fábrica: `PgvectorStore`,
    // `PgvectorRecallCacheStore` e `DrizzleHistoryManager` são superfície
    // pública, e quem monta um deles direto sobre um Pool cru está em
    // single-tenant tanto quanto quem chama createLocalMemory. Colocar a
    // decisão só na fábrica fazia esse uso lançar — 23 testes de integração
    // mediram isso.
    const { PgvectorStore } = await import('./pgvector-store.js');
    new PgvectorStore(fakePool());

    expect(currentWorkspaceWriteMode()).toEqual({ kind: 'single-tenant', workspaceId: 'default' });
  });

  test('um_store_montado_sobre_o_pool_escopado_mantem_o_processo_estrito', async () => {
    const { PgvectorStore } = await import('./pgvector-store.js');
    new PgvectorStore(tenantScopedPool(fakePool()));

    expect(currentWorkspaceWriteMode()).toEqual({ kind: 'strict' });
    expect(() => requireStrictWorkspaceWrites()).not.toThrow();
  });

  test('o_boot_multi_inquilino_recusa_o_modo_single_tenant', () => {
    configureWorkspaceWritesFromPool(fakePool());

    // Esta é a linha que transforma um erro de fiação de meses em segundos.
    expect(() => requireStrictWorkspaceWrites()).toThrow(/pool CRU/);
    expect(() => requireStrictWorkspaceWrites()).toThrow(/tenantScopedPool/);
  });

  test('um_pool_cru_depois_de_um_escopado_nao_rebaixa_o_processo', () => {
    // A ordem de construção não pode decidir a política de escrita do processo.
    // Quem mostrou isso foi o teste de contrato do servidor: uma construção
    // anterior com pool cru derrubava o boot multi-inquilino.
    configureWorkspaceWritesFromPool(tenantScopedPool(fakePool()));
    configureWorkspaceWritesFromPool(fakePool());

    expect(currentWorkspaceWriteMode()).toEqual({ kind: 'strict' });
    expect(() => requireStrictWorkspaceWrites()).not.toThrow();
  });

  test('um_pool_escopado_depois_de_um_cru_eleva_o_processo_para_estrito', () => {
    configureWorkspaceWritesFromPool(fakePool());
    configureWorkspaceWritesFromPool(tenantScopedPool(fakePool()));

    expect(currentWorkspaceWriteMode()).toEqual({ kind: 'strict' });
  });

  test('o_boot_multi_inquilino_aceita_o_pool_escopado', () => {
    configureWorkspaceWritesFromPool(tenantScopedPool(fakePool()));

    expect(() => requireStrictWorkspaceWrites()).not.toThrow();
  });
});
