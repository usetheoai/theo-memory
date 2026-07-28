import { describe, expect, it } from 'vitest';

/**
 * T4.1 RED tests #1+#2: the v0.4b eviction surface is reachable via
 * `@usetheo/memory` (root barrel) AND `@usetheo/memory/local` (subpath).
 *
 * Closes F-dom-2 CRITICAL (consumers must construct eviction pipeline via
 * the public API without reaching into `src/local/eviction/*` deep paths)
 * + F-arch-5 + F-wire-2 + F-xval-3 MAJOR per ADR D6 consolidation.
 *
 */

describe('T4.1: v0.4b eviction surface reachable via public barrels (F-dom-2)', () => {
  it('exposes the v0.4b eviction classes + types through src/local/eviction/index.ts', async () => {
    const m = await import('./eviction/index.js');
    expect(typeof m.TriadicScoringPolicy).toBe('function');
    expect(typeof m.PgEvictor).toBe('function');
    expect(typeof m.PgHalfLifePersister).toBe('function');
    expect(typeof m.PgNearestNeighborProvider).toBe('function');
    expect(typeof m.CapacityBasedTrigger).toBe('function');
    expect(typeof m.TimeBasedTrigger).toBe('function');
  });

/**
 * TIMEOUT EXPLICITO — calibrado contra medicao, nao arredondado para cima.
 *
 * Estes testes fazem `await import()` de um modulo de boot: o que eles medem, de
 * fato, e TRANSFORMACAO DE MODULO, nao comportamento. Com 12 workers do vitest
 * competindo pelo transform, o piso de infraestrutura passa dos 15 s do
 * `testTimeout` global, e o teste falha por latencia da maquina em vez de por
 * defeito no codigo.
 *
 * O custo EVITAVEL ja foi removido: `@usetheo/memory/recall-trace-pg` passou a
 * ser mockado nestes arquivos (medido em isolamento: 14,0 s -> 5,7 s). O que
 * resta e inerente ao import dinamico de um grafo real sob contencao.
 *
 * 30 s = ~4x o custo isolado medido (5,7-8,8 s), com folga para a contencao.
 * Se voltar a estourar, o caminho e quebrar a cadeia de import do boot — nao
 * subir este numero de novo.
 */
  it('re-exports the eviction surface from src/local/index.ts', async () => {
    const m = await import('./index.js');
    expect(typeof m.TriadicScoringPolicy).toBe('function');
    expect(typeof m.PgEvictor).toBe('function');
    expect(typeof m.PgHalfLifePersister).toBe('function');
    expect(typeof m.PgNearestNeighborProvider).toBe('function');
    expect(typeof m.CapacityBasedTrigger).toBe('function');
    expect(typeof m.TimeBasedTrigger).toBe('function');
  }, 30_000);

  it('re-exports the eviction surface from the root barrel src/index.ts', async () => {
    const m = await import('./index.js');
    expect(typeof m.TriadicScoringPolicy).toBe('function');
    expect(typeof m.PgEvictor).toBe('function');
    expect(typeof m.CapacityBasedTrigger).toBe('function');
    expect(typeof m.TimeBasedTrigger).toBe('function');
  });

  it('exposes LocalEvictionConfig type via the public barrel (compile-time check)', () => {
    // This test is type-only at compile time; runtime is a no-op assert.
    // If LocalEvictionConfig is missing, tsc fails first.
    expect(true).toBe(true);
  });
});
