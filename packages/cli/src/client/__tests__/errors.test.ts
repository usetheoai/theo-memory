/**
 * T1.1 RED — taxonomia de erro tipada do cliente HTTP.
 *
 * O CLI fala hoje direto com o banco, então estas classes de falha não existem:
 * servidor fora, credencial rejeitada, timeout, corpo fora do contrato. Cada uma
 * precisa de classe própria, código de saída próprio e mensagem que diga o que
 * fazer — `rules/error-handling.md` proíbe string genérica.
 */
import { describe, expect, it } from 'vitest';

import {
  ClientAuthError,
  ClientConfigError,
  ClientProtocolError,
  ClientTimeoutError,
  ClientUnavailableError,
  exitCodeFor,
  isClientError,
} from '../errors.js';

describe('taxonomia de erro do cliente', () => {
  it('test_client_config_error_quando_url_ausente_sai_com_codigo_2', () => {
    const err = new ClientConfigError('url', 'defina --url ou THEOMEM_MEMORY_URL');
    expect(err).toBeInstanceOf(Error);
    expect(exitCodeFor(err)).toBe(2);
    // A mensagem tem de nomear a flag/env que falta — senão não é acionável.
    expect(err.message).toContain('--url');
    expect(err.message).toContain('THEOMEM_MEMORY_URL');
  });

  it('test_client_auth_error_distingue_credencial_ausente_de_rejeitada', () => {
    const ausente = new ClientAuthError({ status: 401, hadCredential: false });
    const rejeitada = new ClientAuthError({ status: 401, hadCredential: true });

    expect(exitCodeFor(ausente)).toBe(3);
    expect(exitCodeFor(rejeitada)).toBe(3);
    // O mesmo 401 tem duas causas distintas; tratá-las igual manda o operador
    // procurar no lugar errado.
    expect(ausente.message).not.toBe(rejeitada.message);
    expect(ausente.message.toLowerCase()).toContain('sem credencial');
    expect(rejeitada.message.toLowerCase()).toContain('rejeitada');
  });

  it('test_client_unavailable_error_mostra_a_url_tentada', () => {
    const err = new ClientUnavailableError({
      url: 'https://exemplo.invalido/v1/recall',
      cause: 'ECONNREFUSED',
    });
    expect(exitCodeFor(err)).toBe(4);
    expect(err.message).toContain('https://exemplo.invalido/v1/recall');
    expect(err.message).toContain('ECONNREFUSED');
  });

  it('test_client_timeout_error_mostra_o_timeout_aplicado', () => {
    const err = new ClientTimeoutError({ url: 'https://x/v1/recall', timeoutMs: 7500 });
    expect(exitCodeFor(err)).toBe(5);
    expect(err.message).toContain('7500');
  });

  it('test_client_protocol_error_nomeia_o_campo_que_faltou', () => {
    const err = new ClientProtocolError({ url: 'https://x/v1/recall', missingField: 'items' });
    expect(exitCodeFor(err)).toBe(6);
    expect(err.message).toContain('items');
  });

  it('test_erro_desconhecido_nao_e_confundido_com_erro_de_cliente', () => {
    const qualquer = new Error('boom');
    expect(isClientError(qualquer)).toBe(false);
    // Exit 1 é o genérico; as classes de cliente ocupam 2..6.
    expect(exitCodeFor(qualquer)).toBe(1);
  });

  it('test_toda_classe_de_cliente_tem_codigo_distinto', () => {
    const codes = [
      exitCodeFor(new ClientConfigError('url', 'x')),
      exitCodeFor(new ClientAuthError({ status: 401, hadCredential: false })),
      exitCodeFor(new ClientUnavailableError({ url: 'u', cause: 'c' })),
      exitCodeFor(new ClientTimeoutError({ url: 'u', timeoutMs: 1 })),
      exitCodeFor(new ClientProtocolError({ url: 'u', missingField: 'f' })),
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });
});
