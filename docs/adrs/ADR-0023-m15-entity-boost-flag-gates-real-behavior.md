# ADR-0023 — A flag `entityBoost` passa a governar comportamento real (emenda ao ADR-0007)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Milestone:** M15 — tracked theo-memory#122
- **Amends:** ADR-0007 (entity store opt-out)

## Contexto

O ADR-0007 (2026-05-22) estabeleceu a flag de construtor `MemoryConfig.entityBoost?: boolean`,
default `true`, declarando que quando `false` nenhum entity store é instanciado.

A metade da frase que era verdade: a flag de fato gateia o **write path** —
`infrastructure/db/factory.ts` só instancia o `memoryEntityStore` quando
`config.entityBoost !== false`.

A metade que não era: no **read path** a flag não governava nada, porque não havia nada para
governar. O Step 6 do pipeline de recall criava um `Map` vazio e nunca o populava
(`retrieval/pipeline.ts`), então o componente `entity` do `combineScores` era somado como
constante zero desde a v0.1. Ligar ou desligar a flag não mudava um único resultado de busca.

O ROADMAP do M15 registrou isso como item de DoD: *"ADR-0007 revisitado — hoje ele descreve
`entityBoost` default `true` para um comportamento que não acontece."*

## Decisão

A flag `entityBoost` passa a governar comportamento real em **ambos** os lados:

- **Write path** — inalterado. `factory.ts` continua decidindo a instanciação do store.
- **Read path** — `scoped-retrieval.ts` omite as dependências do boost quando
  `config.entityBoost === false`, além de omiti-las quando não há store configurado.

A checagem no read path é redundante no wiring padrão: flag desligada implica store ausente,
e store ausente já desliga o boost. Ela existe para o caso em que um consumidor injeta o
próprio `memoryEntityStore` e desliga a flag — sem ela esse consumidor receberia um boost que
o contrato documentado diz estar desativado.

## Alternativas rejeitadas

- **Deixar a flag valendo só no write path.** Rejeitada: mantém o ADR-0007 descrevendo um
  comportamento que o read path não honra, que é precisamente o defeito que o item de DoD
  aponta. Um consumidor que lê "quando `false`, sem entity boost" e recebe boost tem razão de
  se sentir enganado.
- **Remover a flag.** Rejeitada: ela tem uso legítimo (desligar a extração de entidades por
  completo, economizando chamadas de LLM no write path) e é superfície pública desde a v0.1.
  Removê-la seria breaking change sem ganho.
- **Nova flag separada para o read path.** Rejeitada por YAGNI: ninguém pediu para extrair
  entidades e simultaneamente ignorá-las no ranking. Duas flags para um conceito é
  configuração que nasce sem caso de uso.

## Consequências

- O default (`true`) agora **muda resultados de busca**: uma memória ligada às entidades
  citadas na query ranqueia acima de uma equivalente sem vínculo. Medido em
  `docs/benchmarks/entity-boost-m15.md` — precision@1 de 0.64 para 1.00 no corpus do
  benchmark, com zero memórias saindo do conjunto recuperado.
- Instalações que nunca populam o grafo (tudo anterior ao M13) continuam com o comportamento
  de antes: sem entidades extraídas, o boost é zero e a ordenação não muda.
- Quem quiser o comportamento pré-M15 explicitamente pode passar `entityBoost: false`, e agora
  isso é honrado de ponta a ponta.

## Referências

- Benchmark: `docs/benchmarks/entity-boost-m15.md`
- Issue: theo-memory#122
