/**
 * T1.2 + T1.3 RED — porta `MemoryClient` e o adaptador HTTP.
 *
 * O ponto do milestone está no `test_adaptador_nao_importa_*`: é ele que trava a
 * fronteira. Sem esse teste, nada impede alguém de importar o driver de banco
 * "só para reusar um tipo" e desfazer M0 sem que ninguém perceba.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  ClientAuthError,
  ClientProtocolError,
  ClientTimeoutError,
  ClientUnavailableError,
} from '../errors.js';
import { HttpMemoryClient } from '../http-memory-client.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) =>
    impl(String(input), init ?? {}),
  ) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpMemoryClient', () => {
  it('test_remember_envia_post_para_v1_remember_com_o_escopo', async () => {
    let seenUrl = '';
    let seenBody: Record<string, unknown> = {};
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      token: 'tok',
      fetchImpl: fakeFetch(async (url, init) => {
        seenUrl = url;
        seenBody = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>;
        return jsonResponse({ items: [] });
      }),
    });

    await client.remember({ kind: 'user', id: 'alice' }, 'gosta de café');

    expect(seenUrl).toBe('https://srv.test/v1/remember');
    expect(seenBody['userId']).toBe('alice');
    expect(seenBody['text']).toBe('gosta de café');
  });

  it('test_recall_envia_post_e_devolve_os_itens', async () => {
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      fetchImpl: fakeFetch(async () => jsonResponse({ items: [{ id: '1', text: 'café' }] })),
    });

    const items = await client.recall({ kind: 'user', id: 'alice' }, 'bebidas');

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('café');
  });

  it('test_401_sem_credencial_vira_ClientAuthError_de_credencial_ausente', async () => {
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      fetchImpl: fakeFetch(async () => jsonResponse({ error: 'unauthorized' }, 401)),
    });

    await expect(client.recall({ kind: 'user', id: 'a' }, 'q')).rejects.toSatisfy(
      (e: unknown) => e instanceof ClientAuthError && !e.detail.hadCredential,
    );
  });

  it('test_401_com_credencial_vira_ClientAuthError_de_credencial_rejeitada', async () => {
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      token: 'tok',
      fetchImpl: fakeFetch(async () => jsonResponse({ error: 'unauthorized' }, 401)),
    });

    await expect(client.recall({ kind: 'user', id: 'a' }, 'q')).rejects.toSatisfy(
      (e: unknown) => e instanceof ClientAuthError && e.detail.hadCredential,
    );
  });

  it('test_5xx_vira_ClientUnavailableError', async () => {
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      fetchImpl: fakeFetch(async () => jsonResponse({}, 503)),
    });
    await expect(client.recall({ kind: 'user', id: 'a' }, 'q')).rejects.toBeInstanceOf(
      ClientUnavailableError,
    );
  });

  it('test_conexao_recusada_vira_ClientUnavailableError_com_a_url', async () => {
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      fetchImpl: fakeFetch(async () => {
        throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
      }),
    });
    await expect(client.recall({ kind: 'user', id: 'a' }, 'q')).rejects.toSatisfy(
      (e: unknown) => e instanceof ClientUnavailableError && e.message.includes('srv.test'),
    );
  });

  it('test_abort_vira_ClientTimeoutError_com_o_valor_aplicado', async () => {
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      timeoutMs: 1234,
      fetchImpl: fakeFetch(async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }),
    });
    await expect(client.recall({ kind: 'user', id: 'a' }, 'q')).rejects.toSatisfy(
      (e: unknown) => e instanceof ClientTimeoutError && e.message.includes('1234'),
    );
  });

  it('test_corpo_fora_do_contrato_vira_ClientProtocolError_nomeando_o_campo', async () => {
    const client = new HttpMemoryClient({
      baseUrl: 'https://srv.test',
      fetchImpl: fakeFetch(async () => jsonResponse({ naoEhItems: [] })),
    });
    await expect(client.recall({ kind: 'user', id: 'a' }, 'q')).rejects.toSatisfy(
      (e: unknown) => e instanceof ClientProtocolError && e.message.includes('items'),
    );
  });

  it('test_adaptador_nao_importa_driver_nem_orm_nem_framework_de_servidor', () => {
    // O gate de M0. Ler o FONTE é deliberado: um teste de comportamento não
    // detecta um import que apenas engorda a instalação.
    const proibidos = [/from\s+'pg'/, /drizzle-orm/, /from\s+'hono'/, /memory-agent-core/];
    for (const arquivo of ['../http-memory-client.ts', '../memory-client.ts', '../errors.ts']) {
      const src = readFileSync(resolve(HERE, arquivo), 'utf8');
      for (const proibido of proibidos) {
        expect(src, `${arquivo} não pode importar ${String(proibido)}`).not.toMatch(proibido);
      }
    }
  });
});
