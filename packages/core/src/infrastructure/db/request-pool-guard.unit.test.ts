/**
 * A decisão do guard de requisição, sem banco.
 *
 * A medição precisa de Postgres; a REGRA não, e é na regra que o erro moraria.
 * As duas recusas existem por atributos diferentes do papel e produziriam a
 * mesma consequência — a isolação inteira deixando de valer sem um único erro.
 *
 * @see request-pool-guard.ts
 */
import { describe, expect, test } from 'vitest';

import { requestPostureRefusal, type RequestPosture } from './request-pool-guard.js';

function posture(over: Partial<RequestPosture> = {}): RequestPosture {
  return { role: 'themory_app', superuser: false, bypassRls: false, ...over };
}

describe('requestPostureRefusal', () => {
  test('aceita_o_papel_de_aplicacao_contido_pelas_policies', () => {
    expect(requestPostureRefusal(posture())).toBeUndefined();
  });

  test('recusa_superusuario_porque_FORCE_nao_o_alcanca', () => {
    const refusal = requestPostureRefusal(posture({ role: 'themem', superuser: true }));

    expect(refusal).toBeDefined();
    expect(refusal).toContain('SUPERUSUÁRIO');
    // A recusa tem de nomear o conserto, senão é só indisponibilidade.
    expect(refusal).toContain('themory_app');
    expect(refusal).toContain('THEOMEM_PG_URI');
  });

  test('recusa_BYPASSRLS_que_e_o_mesmo_efeito_por_outro_atributo', () => {
    const refusal = requestPostureRefusal(posture({ role: 'themem_bypass', bypassRls: true }));

    expect(refusal).toBeDefined();
    expect(refusal).toContain('BYPASSRLS');
  });

  test('o_papel_e_nomeado_na_recusa_para_o_operador_saber_o_que_trocar', () => {
    const refusal = requestPostureRefusal(posture({ role: 'postgres', superuser: true }));

    expect(refusal).toContain('"postgres"');
  });
});
