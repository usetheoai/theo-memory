/**
 * M27 T6.1 — write-quality parity metric unit tests.
 * Proves the DoD number computes correctly on known before/after row sets.
 */
import { describe, expect, test } from 'vitest';

import { isSingleThirdPersonFact, singleThirdPersonFactRatio } from './write-quality.js';

describe('write-quality metric (M27 T6.1)', () => {
  test('predicate: atomic third-person declarative → true; question/first-person/dump → false', () => {
    expect(isSingleThirdPersonFact('hono foi atualizado de 4.12.25 para 4.12.31')).toBe(true);
    expect(isSingleThirdPersonFact('Quer que eu prossiga?')).toBe(false);
    expect(isSingleThirdPersonFact('Minha recomendação: use allowlist')).toBe(false);
    expect(isSingleThirdPersonFact('x'.repeat(400))).toBe(false); // dump
    expect(isSingleThirdPersonFact('   ')).toBe(false);
  });

  test('the polluted "before" (dashboard rows) scores near zero', () => {
    // The exact bad rows: a question, a first-person recommendation, a 400-word dump.
    const before = [
      'Quer que eu prossiga com o escopo estreito, ou prefere outro corte?',
      'Minha recomendação: allowlist com sunset <= 90 dias.',
      'Ciclo PLAN do M3 rodando. ' + 'Passei ao agente quatro travas. '.repeat(20),
    ];
    expect(singleThirdPersonFactRatio(before).ratio).toBe(0);
  });

  test('a clean high-grade "after" scores >= 0.90', () => {
    const after = [
      'Recomenda-se uma allowlist com sunset <= 90 dias',
      'hono foi atualizado de 4.12.25 para 4.12.31, fechando tres advisories',
      'O alvo de deploy e container Linux',
      'user prefere café torra escura',
    ];
    expect(singleThirdPersonFactRatio(after).ratio).toBeGreaterThanOrEqual(0.9);
  });

  test('empty set is a vacuous pass (ratio 1)', () => {
    expect(singleThirdPersonFactRatio([]).ratio).toBe(1);
  });
});
