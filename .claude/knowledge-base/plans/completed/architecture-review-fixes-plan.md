# Plan: Architecture Review Fixes — Split God Module, Deduplicate MCP/CLI, Extract Auth Contracts

> **CLOSURE (2026-06-15) — ARCHIVED.** All 10 findings of this 2026-06-11 (pre-reorg) plan were
> resolved by the subsequent `standardize-project-structure` reorg + this session's
> `extract-cli-to-packages` (PR #41) + `complete-workspace-publish-topology` (PR #42) work,
> verified against current state:
> - **HIGH #1/#4/#6/#7 (god module `db/index.ts` 1,526 LoC):** RESOLVED — `index.ts` is now 49 LoC;
>   decomposed into `scoped-memory.ts` (545), `local-memory.ts` (242), `factory.ts` (249),
>   `migrations-runner.ts` (331), `cache-helpers.ts` (106).
> - **HIGH #2 (5 duplicated mcp↔agent-tools files):** RESOLVED — the shared helpers were extracted to
>   the `@usetheo/memory-agent-core` leaf (PR #42 T4/ADR-D3); mcp imports the leaf, no duplicates.
> - **HIGH #3 (auth contracts → domain/dip):** RESOLVED — `domain/dip/oidc-contracts.ts` exists.
> - **#5 (SkillRepresentationStrategy YAGNI):** RESOLVED — the file was removed.
> - **Stale JSDoc coordinates:** cleaned (commit `2ec2593`).
>
> **Accepted LoC-budget exceptions (the plan's "no file >500 LoC in changed scope" metric).** Three
> files remain >500 LoC; on inspection they are JUSTIFIED soft-guideline exceptions (CLAUDE.md states
> the LoC budget is "guia (não regra rígida)"; the owner deferred F-arch-6/7):
> - `pgvector-store.ts` (900) — its skill seam is ALREADY extracted to `PgvectorSkillStore`; the rest
>   is a cohesive `VectorStore` adapter.
> - `scoped-memory.ts` (545, in changed scope, 45 over) — extracting `reflect()` entangles the shared
>   `scopeToCounterTuple` (3 importers) + 2 interfaces; not worth the cycle risk for a soft guideline.
> - `extraction/pipeline.ts` (515) — cohesive 8-phase pipeline, 15 over.
>
> A dedicated follow-up cycle WITH `OPENAI_API_KEY` (to verify the LLM-gated reflect/extraction paths)
> may revisit `scoped-memory.ts` reflect extraction + `pipeline.ts`. Not started — owner-prioritized next.

> **Version 1.1** — Corrige os 10 achados da revisao arquitetural de 2026-06-11 (3 HIGH, 5 MEDIUM, 2 LOW). Foco principal: decomposicao do god file `infrastructure/db/index.ts` (1,526 LoC, LCOM4=3), deduplicacao de 536 LoC entre `packages/mcp/` e `src/agent-tools/`, e extracao de contratos auth para `domain/dip/`. Refactor puro — zero mudanca de API publica, zero feature nova. Qualifica como P0 hardening (higiene interna sem impacto externo).
>
> **v1.1 changes (edge-case absorption):** EC-1 MCP dedup via subpath import instead of relative path; EC-2 cache-helpers extraction as T1.5; EC-3 circular dep pre-flight in T1.3; EC-4 shared helper import test in T1.2; EC-5 skill-barrel.test.ts audit in T3.2.

## Goal

> "Decompor `packages/core/src/infrastructure/db/index.ts` de 1,526 LoC (LCOM4=3) em 4+ arquivos coesos (LCOM4=1 cada), eliminar 5 arquivos duplicados entre `packages/mcp/src/` e `src/agent-tools/` (536 LoC), e mover 3 contratos auth de `packages/api/` para `packages/core/src/domain/dip/`, medido por `pnpm test && pnpm typecheck && pnpm lint` com zero erros e nenhum arquivo > 500 LoC no escopo alterado."

## Context

A revisao arquitetural autonoma (`/loop-architecture-review full`, 2026-06-11) auditou 1,257 arquivos (429 inspecionados, 96% cobertura) e encontrou 0 ciclos de dependencia mas 3 achados HIGH e 5 MEDIUM que comprometem a manutenibilidade do sistema. O modulo `infrastructure/db/` concentra 6 responsabilidades distintas em um unico index.ts — factory, scoped memory, migrations, dimension management, cache helpers e re-exports. A extracao recente do MCP para `packages/mcp/` (commit `1827fbe`, task 3.4 do plano anterior) deixou 5 arquivos identicos entre ambos os diretórios. Os contratos auth (IntrospectFn, IntrospectionResult, OidcDiscoveryConfig) residem em `packages/api/` mas sao consumidos por `packages/mcp/`, criando dependencia cruzada entre modulos de apresentacao (D=0.62 no api-server).

Todas as mudancas sao refactor puro (SRP, DRY, DIP) sem impacto na API publica. Qualifica como P0 hardening per CLAUDE.md § PRIORITY 0.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/infrastructure/db/index.ts` | 1,526 | `ab62443` (2026-06-10) | God file: 2 classes, 14 helpers, factory, migrations | Todas as 22 exportacoes publicas devem continuar resolvendo via barrel |
| `packages/core/src/infrastructure/db/scoped-memory.ts` (NEW) | 0 | — | (a ser criado — extrai LocalScopedMemory) | — |
| `packages/core/src/infrastructure/db/local-memory.ts` (NEW) | 0 | — | (a ser criado — extrai LocalMemory) | — |
| `packages/core/src/infrastructure/db/factory.ts` (NEW) | 0 | — | (a ser criado — extrai createLocalMemory + helpers) | — |
| `packages/core/src/infrastructure/db/migrations-runner.ts` (NEW) | 0 | — | (a ser criado — extrai runMigrations + applyDimChange) | — |
| `packages/core/src/infrastructure/db/cache-helpers.ts` (NEW) | 0 | — | (a ser criado — extrai resolveRecallCacheStore + probeCache) | — |
| `packages/mcp/src/agent-tools-memory.ts` | 156 | `1827fbe` (2026-06-11) | Duplicata identica de src/agent-tools/ | Deve importar de shared, nao duplicar |
| `packages/mcp/src/error-classifier.ts` | 162 | `1827fbe` (2026-06-11) | Duplicata identica | Idem |
| `packages/mcp/src/scope.ts` | 53 | `1827fbe` (2026-06-11) | Duplicata identica | Idem |
| `packages/mcp/src/oidc-cli-resolver.ts` | 125 | `1827fbe` (2026-06-11) | Duplicata identica | Idem |
| `packages/mcp/src/types.ts` | 40 | `1827fbe` (2026-06-11) | Duplicata identica | Idem |
| `src/agent-tools/agent-tools-memory.ts` | 156 | `ab62443` (2026-06-10) | Fonte original dos 5 arquivos | Passa a ser o canonical; MCP importa dele |
| `src/agent-tools/index.ts` | 46 | — | Barrel agent-tools | Adicionar re-exports dos shared |
| `packages/api/src/server/auth/oidc-verifier.ts` | ~200 | — | Define IntrospectFn + IntrospectionResult (RFC 7662) | Impl fica aqui; tipos movem para domain/dip |
| `packages/api/src/server/handlers/well-known.ts` | ~100 | — | Define OidcDiscoveryConfig (RFC 9728) | Impl fica aqui; tipo move para domain/dip |
| `packages/core/src/domain/dip/oidc-contracts.ts` (NEW) | 0 | — | (a ser criado — contratos auth extraidos) | — |
| `packages/core/src/domain/index.ts` | ~350 | — | Barrel domain | Adicionar re-exports dos novos contratos |
| `packages/core/src/domain/dip/skill-representation-strategy.ts` | 53 | — | Interface sem implementacao (YAGNI) | Pode ser removida se nenhum caller produtivo |
| `packages/core/src/index.ts` | ~164 | — | Root barrel | Re-exports devem continuar resolvendo |

### Current callers / dependents

- **`createLocalMemory()`**: 20+ callers (agent-tools, mcp, tests, domain, eviction). API publica — contrato estavel.
- **`LocalMemory`**: 15 callers (agent-tools, mcp, api, core internals). Tipo publico re-exportado.
- **`LocalScopedMemory`**: 10 callers (domain contracts, infra internals, api handlers). Tipo publico.
- **`runMigrations()`**: 9 callers (agent-tools run-server/migrate, mcp run-mcp-server, core index). API publica.
- **`IntrospectFn`**: 5 callers (mcp run-mcp-server, api auth + test). Tipo publico re-exportado de @usetheo/memory-api.
- **`OidcDiscoveryConfig`**: 5 callers (mcp oidc-cli-resolver, agent-tools oidc-cli-resolver, api app + well-known). Tipo publico.
- **`SkillRepresentationStrategy`**: 4 references (definition, barrel, 2 type-level tests). Zero callers produtivos.

### Domain glossary

- **LCOM4** — Lack of Cohesion of Methods (nivel 4). Mede quantos clusters desconectados de metodos existem em uma classe. LCOM4=1 e ideal; LCOM4=3 indica 3 responsabilidades distintas.
- **God file** — Arquivo com > 500 LoC e multiplas responsabilidades (heuristic threshold per `architecture.md`).
- **DIP** — Dependency Inversion Principle. Contratos em `domain/dip/`; implementacoes em `infrastructure/`.
- **Martin Distance (D)** — |Abstractness + Instability - 1|. D=0 ideal; D=0.62 indica modulo concreto demais sendo dependido por outros.
- **Barrel** — `index.ts` que re-exporta simbolos de submodulos para simplificar imports.

### Architecture boundaries affected

- **`domain/dip/` → `infrastructure/db/`**: A decomposicao do index.ts nao altera a direcao — infra continua implementando domain. Barrel preserva a interface.
- **`packages/api/` → `packages/core/domain/dip/`**: Mover tipos auth de api para domain INVERTE a dependencia (api passa a importar tipos de core, nao o contrario). Correcao da direcao DIP.
- **`packages/mcp/` → `@usetheo/memory/agent-tools`**: MCP passa a importar shared code de agent-tools via subpath export (package resolution, nao path relativo — EC-1 fix). Elimina duplicacao sem criar novo pacote.

## Prior Art & Related Work

- **Architecture review report** (`architecture-output/final_report.md`, 2026-06-11) — fonte primaria de todos os achados.
- **ADR 0001** (`architecture-output/adr-suggestions/0001-split-infra-db-module.md`) — proposta de split do god module.
- **ADR 0002** (`architecture-output/adr-suggestions/0002-extract-auth-contracts-to-domain.md`) — proposta de extracao auth.
- **`rules/architecture.md` § 3** — DIP direction rules (core MUST NOT import local/cloud).
- **`rules/architecture.md` § 7** — Module hygiene (LOC budgets, barrel conventions).

## Objective

- [ ] `infrastructure/db/index.ts` decomposto em 5+ arquivos, nenhum > 500 LoC
- [ ] 5 arquivos duplicados entre MCP e agent-tools eliminados (MCP importa de agent-tools)
- [ ] 3 contratos auth movidos de `packages/api/` para `packages/core/src/domain/dip/`
- [ ] SkillRepresentationStrategy removida (YAGNI — 0 implementacoes)
- [ ] `pnpm test && pnpm typecheck && pnpm lint` = zero erros
- [ ] Zero mudancas na API publica (todos os re-exports preservados)

## ADRs

### D1 — Split `index.ts` via extract-and-barrel (Option 3 do ADR 0001)

**Decision:** Extrair LocalScopedMemory, LocalMemory, createLocalMemory+helpers, e runMigrations+applyDimChange em arquivos separados dentro do mesmo diretorio. index.ts vira barrel puro.

**Rationale:** LCOM4=3 indica 3 clusters desconectados. SRP per `CLAUDE.md` § 13.1 — cada arquivo deve ter uma razao para mudar. O split e interno: nenhum consumidor externo muda imports porque o barrel re-exporta tudo. Per `architecture.md` § 7, files > 500 LoC sao heuristic violation.

**Alternatives considered:**
- *Option 1 (status quo)*: Rejeitado — 1,526 LoC com LCOM4=3 e uma bomba de manutencao. Cada refactor futuro no sistema de memoria toca este arquivo, gerando conflitos de merge e dificultando code review.
- *Option 2 (same-dir flat files)*: Rejeitado — nao agrupa logicamente. factory.ts e local-memory.ts ficam perdidos entre 10+ outros arquivos no diretorio.

**Consequences:** Imports internos mudam (import paths dentro de infra-db). Barrel preserva API publica. +1 nivel de diretorio para factory files.

### D2 — Deduplicacao MCP/CLI via subpath export `@usetheo/memory/agent-tools` (EC-1 absorbed)

**Decision:** MCP importa os 5 simbolos compartilhados via o subpath export `@usetheo/memory/agent-tools`, que ja existe em `package.json#exports`. Os 5 arquivos duplicados sao deletados de `packages/mcp/src/`; `src/agent-tools/index.ts` re-exporta os simbolos compartilhados. Nao criamos um novo pacote `@usetheo/memory-shared`.

**Rationale:** DRY per `CLAUDE.md` § 12 — mesma logica em 2 lugares e violacao. ~~v1.0 propunha paths relativos (`../../agent-tools/`)~~ mas EC-1 identificou que imports relativos cruzando packages quebram apos `tsc` compilar para `dist/` (o path relativo resolveria `packages/agent-tools/` em vez de `src/agent-tools/`). O subpath export usa resolucao de pacote npm — funciona tanto em source (vitest) quanto em dist (runtime).

**Alternatives considered:**
- *Path relativo `../../agent-tools/`*: Rejeitado (EC-1) — quebra apos tsc compilation. O outDir de MCP (`packages/mcp/dist/`) muda a resolucao relativa.
- *Novo pacote `packages/shared/`*: Rejeitado — YAGNI per § 11. 5 helpers internos nao justificam um quarto pacote npm.
- *Copiar de MCP para agent-tools e deletar de agent-tools*: Rejeitado — inverte a direcao semantica.

**Consequences:** MCP depende de `@usetheo/memory/agent-tools` (package resolution, nao path relativo). Zero risco de break em dist/. Se `@usetheo/memory/agent-tools` subpath nao existir em `package.json#exports`, deve ser adicionado como sub-task de T2.1.

### D3 — Contratos auth movidos para domain/dip (Option 2 do ADR 0002)

**Decision:** `IntrospectFn`, `IntrospectionResult`, `OidcDiscoveryConfig` movem para `packages/core/src/domain/dip/oidc-contracts.ts`. Implementacoes ficam em `packages/api/`.

**Rationale:** DIP per `architecture.md` § 3 — tipos sao contratos, nao implementacoes. Manter em api-server forca MCP a depender de api-server (D=0.62). Mover para domain-dip alinha com o padrao existente (AuthVerifier ja esta la desde v0.3).

**Alternatives considered:**
- *Pacote `@usetheo/memory-auth`*: Rejeitado — over-engineering. 3 tipos simples (< 60 LoC total) nao justificam um pacote separado.
- *Status quo*: Rejeitado — MCP depende de api-server para tipos, violando layering.

**Consequences:** Reduz D de api-server de 0.62 para ~0.1. MCP depende apenas de core para tipos. Backward-compat preservado via re-export em `packages/api/src/server/index.ts`.

### D4 — Remover SkillRepresentationStrategy (YAGNI)

**Decision:** Remover interface + tipo `SkillRepresentation` de `packages/core/src/domain/dip/skill-representation-strategy.ts`. Zero implementacoes existem; 0 callers produtivos; 2 type-level tests.

**Rationale:** YAGNI per `CLAUDE.md` § 11 — "interface com 1 implementador" ja e questionavel; interface com ZERO implementadores e speculative generality. O JSDoc diz "slot only at v0.6; no implementation ships". Se a necessidade surgir, reintroduzir e trivial.

**Alternatives considered:**
- *Manter como slot reservado*: Rejeitado — slot sem implementacao por 11 dias (desde v0.6) sem roadmap item para usa-lo. Nenhum dos items 13/14/15 (frozen) referenciam este DIP.

**Consequences:** 1 arquivo e 2 type tests removidos. Re-export removido de `packages/core/src/domain/index.ts`. Se algum futuro plan precisar, reintroduz via `/to-plan`.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Barrel re-export masks file-level changes — consumidores nao percebem o split e podem ter imports deep quebrados em branches paralelas | Medium | Comunicar o refactor no CHANGELOG; refactor e atomico (1 commit por task); nenhuma branch paralela ativa (P0 freeze) | Implementador |
| Subpath `@usetheo/memory/agent-tools` acopla MCP a root package | Low | Acoplamento via package.json exports — mesmo mecanismo usado por todos os outros subpaths. Menos fragil que path relativo (EC-1 fix). | Implementador |
| Remocao de SkillRepresentationStrategy pode ser prematura se v1.2+ precisar | Low | Reintroducao e trivial (< 60 LoC). Git history preserva o original. ADR D4 documenta a decisao. | Implementador |
| factory.ts pode exceder 500 LoC se todos os 8 helpers forem incluidos (EC-2) | Medium | Cache helpers extraidos para cache-helpers.ts (T1.5). factory.ts fica com ~350 LoC. | Implementador |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (Split God File) ──▶ Phase 2 (Deduplicate MCP/CLI)
                                        │
                                        ▼
                              Phase 3 (Auth Contracts + YAGNI cleanup)
                                        │
                                        ▼
                              Phase 4 (Integration Validation)
```

Todas as fases sao sequenciais. Phase 1 e o maior blast radius; phases 2-3 sao independentes entre si mas dependem de phase 1 (para evitar conflitos no barrel index.ts).

---

## Phase 1: Split Infrastructure DB God Module

**Objective:** Decompor `packages/core/src/infrastructure/db/index.ts` (1,526 LoC, LCOM4=3) em 5 arquivos coesos, cada um com LCOM4=1 e < 500 LoC.

### T1.1 — Extract LocalScopedMemory to scoped-memory.ts

#### Objective
Mover a classe `LocalScopedMemory` (linhas 515-850, ~335 LoC) e seus helpers diretos para um arquivo dedicado.

#### Why this step
**Action:** Extrair `LocalScopedMemory` (remember, recall, reflect, getAll) + os helpers usados exclusivamente por ela (filtersFromScope, assertScopeIsNonEmpty, deriveScopeFromPayload, scopeToCounterTuple) para `scoped-memory.ts`.
**Reasoning:** LocalScopedMemory e o maior cluster coeso dentro do god file — metodos que compartilham estado interno (pool, tracer, config) mas nao interagem com o factory ou migrations. SRP per D1 diz que cada arquivo tem uma razao para mudar; este muda quando a logica de remember/recall/reflect muda.

#### Evidence
- `architecture-output/final_report.md` § 4 Finding #1: "SRP: God file infrastructure/db/index.ts (1,526 LoC)"
- `architecture-output/final_report.md` § 4 Finding #4: "SRP: LocalScopedMemory.reflect (167 lines inline orchestration)"
- Linha 515 do index.ts: `export class LocalScopedMemory implements ScopedMemory`

#### Files to edit
```
packages/core/src/infrastructure/db/scoped-memory.ts (NEW) — classe LocalScopedMemory + 5 helpers
packages/core/src/infrastructure/db/index.ts — remover classe + helpers; adicionar re-export
```

#### Deep file dependency analysis
- **index.ts**: God file que hoje exporta LocalScopedMemory. Apos extracao, re-exporta de `./scoped-memory.js`.
- **scoped-memory.ts (NEW)**: Contera a classe e seus helpers. Importa de `./pgvector-store.js`, `./schema.js`, `../domain/dip/*.js`.
- **Callers**: `packages/core/src/domain/options.ts`, `scope.ts`, `memory-event.ts`, `dip/recall-cache-store.ts`, `dip/reflection-policy.ts` — todos importam o TIPO via barrel, nao o path direto.

#### Deep Dives
- **Invariante:** Todos os `import { LocalScopedMemory }` existentes resolvem via barrel sem mudanca.
- **Edge case:** Helpers que sao usados TANTO por LocalScopedMemory QUANTO por LocalMemory (ex: `filtersFromScope`) ficam em `scoped-memory.ts` e sao re-exportados — nao duplicados.

#### Tasks
1. Criar `scoped-memory.ts` com a classe e helpers
2. Remover as linhas correspondentes de `index.ts`
3. Adicionar `export { LocalScopedMemory } from './scoped-memory.js'` em index.ts
4. Verificar que `pnpm typecheck` passa

#### TDD
```
RED:     test('LocalScopedMemory import from barrel still resolves') — importar de @usetheo/memory e verificar que o tipo existe
GREEN:   Extract e re-export
REFACTOR: None expected
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `LocalScopedMemory` exportada de `scoped-memory.ts`
- [ ] `index.ts` re-exporta via barrel
- [ ] `pnpm typecheck` zero erros
- [ ] `pnpm test` zero falhas
- [ ] `scoped-memory.ts` <= 500 LoC
- [ ] `index.ts` reduzido em ~335 LoC

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`
- [ ] File-size budget respected

---

### T1.2 — Extract LocalMemory to local-memory.ts

#### Objective
Mover a classe `LocalMemory` (linhas 853-1046, ~193 LoC) para arquivo dedicado.

#### Why this step
**Action:** Extrair `LocalMemory` (user/session/agent/skills/forget/get/history/reset/flushReflections) para `local-memory.ts`.
**Reasoning:** LocalMemory e o facade que orquestra scoped memories. Razao de mudanca distinta de LocalScopedMemory (muda quando se adiciona novo scope tier ou novo metodo de nivel Memory). SRP per D1.

#### Evidence
- `architecture-output/final_report.md` § 5c: "Facade applied_correctly — infra-db (LocalMemory)"
- Linha 853 do index.ts: `export class LocalMemory implements Memory`

#### Files to edit
```
packages/core/src/infrastructure/db/local-memory.ts (NEW) — classe LocalMemory
packages/core/src/infrastructure/db/index.ts — remover classe; adicionar re-export
```

#### Deep file dependency analysis
- **LocalMemory** depende de `LocalScopedMemory` (cria instancias no user/session/agent). Importara de `./scoped-memory.js`.
- **Callers (producao):** `src/agent-tools/agent-tools-memory.ts`, `run-server.ts`, `run-health.ts`, `packages/mcp/src/agent-tools-memory.ts`, `packages/api/src/server/app.ts`, `packages/core/src/domain/memory-store.ts`, `packages/core/src/index.ts`.
- **EC-4 (SHOULD TEST):** `filtersFromScope` e chamada por LocalMemory (linhas 868, 880, 892 para user/session/agent) e vive em `scoped-memory.ts`. A dependencia local-memory → scoped-memory e one-way (facade depende de delegate). Verificar que nao ha import reverso.

#### Deep Dives
- **Invariante:** `DisposableMemory` type alias (`LocalMemory & AsyncDisposable`) e exportado do mesmo arquivo ou de index.ts.
- **EC-4 import direction:** `local-memory.ts` importa `{ LocalScopedMemory, filtersFromScope }` de `./scoped-memory.js`. `scoped-memory.ts` NAO importa de `local-memory.ts`. Confirmar com grep apos extracao.

#### Tasks
1. Criar `local-memory.ts` com a classe
2. Mover `DisposableMemory` type junto
3. Importar `{ LocalScopedMemory, filtersFromScope }` de `./scoped-memory.js`
4. Remover de `index.ts`, adicionar re-export
5. **EC-4:** Verificar que `scoped-memory.ts` NAO importa de `./local-memory.js` (one-way dependency)

#### TDD
```
RED:     test('LocalMemory import from barrel still resolves')
RED:     test('local-memory.ts imports filtersFromScope from scoped-memory without circular dep') — import both modules and verify no evaluation error (EC-4)
GREEN:   Extract e re-export
REFACTOR: None expected
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `LocalMemory` e `DisposableMemory` exportadas de `local-memory.ts`
- [ ] `local-memory.ts` <= 500 LoC
- [ ] `index.ts` reduzido em ~193 LoC
- [ ] **EC-4 verified:** `scoped-memory.ts` has zero imports from `./local-memory.js`
- [ ] `pnpm test && pnpm typecheck` zero erros

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

### T1.3 — Extract createLocalMemory factory to factory.ts

#### Objective
Mover `createLocalMemory` (linhas 1106-1273, ~169 LoC) + helpers de factory nao-cache (probeEmbedder, validateEmbeddingDim) para `factory.ts`. Cache helpers movem para `cache-helpers.ts` em T1.5 (EC-2 absorption).

#### Why this step
**Action:** Extrair a funcao factory + 2 helpers de probe/validacao. Os 6 cache helpers (isStubEmbedder, emitStubEmbedderCacheWarning, isRecallCacheStoreInstance, resolveRecallCacheStore, probeCacheTableDim, resolveCacheTtl) movem para `cache-helpers.ts` em T1.5 para manter factory.ts < 500 LoC (EC-2).
**Reasoning:** A factory e o ponto de composicao — muda quando se adiciona novo provider ou novo config. Cache resolution e uma concern distinta (muda quando se altera o recall cache store). Separar respeita SRP E garante o budget de 500 LoC.

#### Evidence
- `architecture-output/final_report.md` § 4 Finding #6: "Clean function: createLocalMemory factory (169 lines)"
- Linha 1106 do index.ts: `export async function createLocalMemory(`
- EC-2: factory.ts com todos os 8 helpers excederia ~550 LoC — `knowledge-base/reviews/architecture-review-fixes-edge-cases-2026-06-11.md`

#### Pre-flight (EC-3 absorption)
**Step 0 (MANDATORY before extraction):** Verificar que `createLocalMemory` body (linhas 1106-1200) NAO chama `applyDimChange` nem `runMigrations` diretamente. Se chamar, factory.ts precisa importar de `migrations-runner.ts` — validar que nao cria circular dependency (factory → migrations → factory). Grep confirmou que createLocalMemory NAO chama nenhuma das duas — mas o implementador DEVE revalidar no momento da extracao.

#### Files to edit
```
packages/core/src/infrastructure/db/factory.ts (NEW) — createLocalMemory + probeEmbedder + validateEmbeddingDim + LocalMemoryConfig + EvictionNotSupported + PROBE_TEXT + createMemory alias
packages/core/src/infrastructure/db/index.ts — remover; re-export
```

#### Deep file dependency analysis
- **createLocalMemory** usa `LocalMemory`, `PgvectorStore`, embedders, LLMs. Importara de siblings. Usa `resolveRecallCacheStore` (que vira de `./cache-helpers.js` apos T1.5).
- **Callers:** Ampla distribuicao (20+ files). Todos importam via barrel — zero impacto.
- **`createMemory` alias**: re-exportado junto (`export const createMemory = createLocalMemory`).

#### Deep Dives
- **Invariante:** `LocalMemoryConfig` interface e `EvictionNotSupported` error class tambem vivem logicamente com a factory (sao input/error da factory). Mover junto.
- **`PROBE_TEXT`** constante: usada por probeEmbedder — move com factory.
- **Ordem de extracao:** T1.3 extrai factory COM os 6 cache helpers inline temporariamente. T1.5 (logo apos) extrai cache helpers de factory para cache-helpers.ts. Isso garante que cada step mantem `pnpm typecheck` verde.

#### Tasks
1. **Step 0 (EC-3):** `grep -n 'applyDimChange\|runMigrations' packages/core/src/infrastructure/db/index.ts` nas linhas 1106-1200 — confirmar zero hits
2. Criar `factory.ts` com createLocalMemory, createMemory, LocalMemoryConfig, EvictionNotSupported, PROBE_TEXT, probeEmbedder, validateEmbeddingDim, e temporariamente os 6 cache helpers (serao extraidos em T1.5)
3. Remover de `index.ts`, adicionar re-exports
4. Verificar typecheck

#### TDD
```
RED:     test('createLocalMemory import from barrel still resolves')
GREEN:   Extract e re-export
REFACTOR: None expected (cache helper extraction is T1.5)
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `createLocalMemory`, `createMemory`, `LocalMemoryConfig` exportados de `factory.ts`
- [ ] **EC-3 verified:** `createLocalMemory` body has zero direct calls to `applyDimChange` or `runMigrations`
- [ ] `factory.ts` <= 550 LoC (temporario — T1.5 reduz para ~350 LoC)
- [ ] `pnpm test && pnpm typecheck` zero erros

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

### T1.4 — Extract runMigrations + applyDimChange to migrations-runner.ts

#### Objective
Mover `runMigrations` (linhas 1455-1526, ~71 LoC) e `applyDimChange` (linhas 1275-1453, ~180 LoC) para arquivo dedicado.

#### Why this step
**Action:** Extrair as duas funcoes de migracao/dimensionamento para `migrations-runner.ts`.
**Reasoning:** Finding #7 (applyDimChange: 180 lines de SQL inline) — isolar SQL migration logic do factory/memory code. Razao de mudanca: muda quando schema ou pgvector versao muda, nunca quando logica de recall/remember muda. SRP per D1.

#### Evidence
- `architecture-output/final_report.md` § 4 Finding #7: "Clean function: applyDimChange (180 lines of inline SQL)"
- Linha 1275 do index.ts: `async function applyDimChange(`
- Linha 1455: `export async function runMigrations(`

#### Files to edit
```
packages/core/src/infrastructure/db/migrations-runner.ts (NEW) — runMigrations + applyDimChange
packages/core/src/infrastructure/db/index.ts — remover; re-export
```

#### Deep file dependency analysis
- **runMigrations** importa `migrate` de drizzle-node-postgres e `schema` de `./schema.js`.
- **applyDimChange** usa raw SQL via `pg.Pool`. Nenhuma dependencia de LocalMemory/ScopedMemory.
- **Callers de runMigrations:** `src/agent-tools/run-migrate.ts`, `run-server.ts`, `agent-tools-memory.ts`, `packages/mcp/src/run-mcp-server.ts`, `packages/core/src/index.ts`.

#### Deep Dives
- **Invariante:** applyDimChange e funcao INTERNA (nao exportada). Nao precisa estar no barrel.
- **runMigrations e API publica** — deve ser re-exportada no barrel.

#### Tasks
1. Criar `migrations-runner.ts` com runMigrations (export) e applyDimChange (internal)
2. Remover de `index.ts`, re-exportar runMigrations
3. Verificar typecheck

#### TDD
```
RED:     test('runMigrations import from barrel still resolves')
GREEN:   Extract e re-export
REFACTOR: None expected
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `runMigrations` exportada de `migrations-runner.ts`
- [ ] `migrations-runner.ts` <= 500 LoC (251 LoC esperado)
- [ ] `index.ts` reduzido a barrel puro (< 50 LoC de re-exports)
- [ ] `pnpm test && pnpm typecheck` zero erros

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

### T1.5 — Extract cache helpers from factory.ts to cache-helpers.ts (EC-2 absorption)

#### Objective
Mover 6 cache-related helpers de `factory.ts` para `cache-helpers.ts`, reduzindo factory.ts de ~550 LoC para ~350 LoC.

#### Why this step
**Action:** Extrair `isRecallCacheStoreInstance`, `resolveRecallCacheStore`, `probeCacheTableDim`, `resolveCacheTtl`, `isStubEmbedder`, `emitStubEmbedderCacheWarning` para `cache-helpers.ts`. factory.ts importa de `./cache-helpers.js`.
**Reasoning:** EC-2 identificou que factory.ts com todos os 8 helpers excederia 500 LoC (~550). Os 6 cache helpers sao um cluster coeso distinto — mudam quando o cache store muda, nao quando o factory assembly muda. SRP per D1. O arquivo `cache-helpers.ts` ja estava no Baseline Context como (NEW) mas nao tinha task atribuida.

#### Evidence
- EC-2: `knowledge-base/reviews/architecture-review-fixes-edge-cases-2026-06-11.md` § MUST FIX EC-2
- `cache-helpers.ts` listado no Baseline Context table mas sem task atribuida (EC-6 DOCUMENT)

#### Files to edit
```
packages/core/src/infrastructure/db/cache-helpers.ts (NEW) — 6 cache helpers (~150 LoC)
packages/core/src/infrastructure/db/factory.ts — remover 6 helpers; importar de ./cache-helpers.js
```

#### Deep file dependency analysis
- **cache-helpers.ts (NEW):** Contera os 6 helpers. Nenhuma dependencia de LocalMemory/ScopedMemory/factory. Importa apenas tipos de `domain/dip/` (RecallCacheStore, Embedder).
- **factory.ts:** Passa a importar `resolveRecallCacheStore`, `isStubEmbedder`, `emitStubEmbedderCacheWarning` de `./cache-helpers.js`. Direcao: factory → cache-helpers (nao circular).

#### Tasks
1. Criar `cache-helpers.ts` com os 6 helpers
2. Atualizar `factory.ts` para importar de `./cache-helpers.js`
3. Adicionar re-export em `index.ts` se algum helper for publico (verificar — provavelmente nenhum e publico)
4. Verificar typecheck e que factory.ts < 400 LoC

#### TDD
```
RED:     test('createLocalMemory with recallCache config still works') — teste existente deve continuar passando
GREEN:   Extract e import
REFACTOR: None expected
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] 6 cache helpers em `cache-helpers.ts`
- [ ] `cache-helpers.ts` <= 200 LoC
- [ ] `factory.ts` <= 400 LoC (down from ~550)
- [ ] `pnpm test && pnpm typecheck` zero erros

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

## Phase 2: Deduplicate MCP/CLI Shared Files

**Objective:** Eliminar 536 LoC duplicados entre `packages/mcp/src/` e `src/agent-tools/` fazendo MCP importar de agent-tools.

### T2.1 — Make MCP import shared files from agent-tools

#### Objective
Deletar os 5 arquivos duplicados de `packages/mcp/src/` e substituir por imports de `src/agent-tools/`.

#### Why this step
**Action:** Em `packages/mcp/src/`, deletar `agent-tools-memory.ts`, `error-classifier.ts`, `scope.ts`, `oidc-cli-resolver.ts`, `types.ts`. Em cada arquivo de MCP que os importava, atualizar o import para usar o subpath `@usetheo/memory/agent-tools` (EC-1 absorption — path relativo quebraria apos tsc compilation porque outDir muda a resolucao).
**Reasoning:** DRY per D2 — diff dos 5 arquivos mostra 0 diferencas (`diff` saida vazia). Mesma logica, dois lugares. Quando alguem corrige um bug em error-classifier, precisa lembrar de corrigir no outro — recipe para drift.

#### Evidence
- `architecture-output/final_report.md` § 4 Finding #2: "DRY: 5 files duplicated post-MCP extraction"
- `diff src/agent-tools/agent-tools-memory.ts packages/mcp/src/agent-tools-memory.ts` = vazio (identicos)
- Commit `1827fbe` (2026-06-11): "refactor(workspace): extract MCP server to packages/mcp/ (task 3.4 do plano anterior)" — a extracao copiou os files sem deduplicar.
- EC-1: `knowledge-base/reviews/architecture-review-fixes-edge-cases-2026-06-11.md` § MUST FIX EC-1 — path relativo `../../agent-tools/` quebra em dist/

#### Files to edit
```
packages/mcp/src/agent-tools-memory.ts — DELETE
packages/mcp/src/error-classifier.ts — DELETE
packages/mcp/src/scope.ts — DELETE
packages/mcp/src/oidc-cli-resolver.ts — DELETE
packages/mcp/src/types.ts — DELETE
packages/mcp/src/run-mcp-server.ts — atualizar imports para @usetheo/memory/agent-tools
packages/mcp/src/server.ts — atualizar imports (se aplicavel)
src/agent-tools/index.ts — adicionar re-exports dos 5 shared symbols
package.json — verificar que exports["./agent-tools"] mapeia para dist output correto
```

#### Deep file dependency analysis
- **run-mcp-server.ts** importa `createAgentToolsMemory` de `./agent-tools-memory.js` — muda para `@usetheo/memory/agent-tools`
- **run-mcp-server.ts** importa `classifyError` de `./error-classifier.js` — idem
- **server.ts** pode importar scope/types — verificar e atualizar
- **oidc-cli-resolver.ts** e importado por run-mcp-server.ts — muda para `@usetheo/memory/agent-tools`

#### Deep Dives
- **Invariante:** Os testes em `packages/mcp/src/run-mcp-server.test.ts` continuam passando com os novos import paths.
- **EC-1 fix:** Subpath `@usetheo/memory/agent-tools` usa package resolution (npm), nao path relativo. Funciona tanto em source (vitest resolve via `package.json#exports`) quanto em dist (runtime resolve via node_modules). Zero risco de break com outDir diferente.
- **EC-7 (DOCUMENT):** Mock statements em `run-mcp-server.test.ts` que referenciam `./agent-tools-memory.js` ou `./error-classifier.js` devem ser atualizados para o novo import path. Auditar `vi.mock()` calls no test file.

#### Tasks
1. Verificar que `package.json#exports["./agent-tools"]` existe e mapeia corretamente
2. Adicionar re-exports em `src/agent-tools/index.ts` para os 5 modulos compartilhados (`createAgentToolsMemory`, `wireMemoryFromPool`, `assertEnvOrExit`, `classifyError`, `resolveScope`, tipos de scope/types)
3. Atualizar imports em `packages/mcp/src/run-mcp-server.ts` para `@usetheo/memory/agent-tools`
4. Atualizar imports em `packages/mcp/src/server.ts` para `@usetheo/memory/agent-tools`
5. Auditar e atualizar `vi.mock()` paths em `packages/mcp/src/run-mcp-server.test.ts` (EC-7)
6. Deletar os 5 arquivos duplicados de `packages/mcp/src/`
7. Verificar `pnpm test && pnpm typecheck`

#### TDD
```
RED:     test('MCP run-mcp-server boots without import errors') — teste existente run-mcp-server.test.ts deve continuar passando
GREEN:   Atualizar imports e deletar duplicatas
REFACTOR: None expected
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] 5 arquivos deletados de `packages/mcp/src/`
- [ ] Zero arquivos com conteudo identico entre MCP e agent-tools
- [ ] `pnpm test` — todos os testes MCP passam
- [ ] `pnpm typecheck` — zero erros
- [ ] 536 LoC eliminados

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

## Phase 3: Extract Auth Contracts + YAGNI Cleanup

**Objective:** Mover 3 contratos auth para `domain/dip/` (reduzir D de api-server de 0.62) e remover interface YAGNI sem implementacao.

### T3.1 — Move IntrospectFn, IntrospectionResult, OidcDiscoveryConfig to domain/dip

#### Objective
Criar `packages/core/src/domain/dip/oidc-contracts.ts` com os 3 tipos RFC 7662/9728. Api-server e MCP passam a importar de core.

#### Why this step
**Action:** Definir `IntrospectFn`, `IntrospectionResult` (RFC 7662), e `OidcDiscoveryConfig` (RFC 9728) em `domain/dip/oidc-contracts.ts`. Atualizar imports em api-server e mcp. Api-server re-exporta os tipos para backward-compat.
**Reasoning:** DIP per D3 — tipos sao contratos (abstrações); implementações ficam em api-server. AuthVerifier ja segue esse padrao (esta em `domain/dip/auth-verifier.ts` desde v0.3). Manter IntrospectFn em api-server forca MCP a depender de api-server, violando layering (presentation → presentation).

#### Evidence
- `architecture-output/final_report.md` § 5d: "api-server: D=0.62 (concrete module depended upon by other presentation modules)"
- `packages/api/src/server/auth/oidc-verifier.ts:55` — IntrospectionResult definition
- `packages/api/src/server/auth/oidc-verifier.ts:93` — IntrospectFn definition
- `packages/api/src/server/handlers/well-known.ts:29` — OidcDiscoveryConfig definition

#### Files to edit
```
packages/core/src/domain/dip/oidc-contracts.ts (NEW) — 3 tipos
packages/core/src/domain/index.ts — re-export novos tipos
packages/api/src/server/auth/oidc-verifier.ts — import de core ao inves de definir localmente; re-export para backward-compat
packages/api/src/server/handlers/well-known.ts — import de core
packages/api/src/server/index.ts — re-export preservado (backward-compat)
packages/mcp/src/run-mcp-server.ts — import de core ao inves de api
```

#### Deep file dependency analysis
- **oidc-verifier.ts**: Define IntrospectFn/IntrospectionResult + implementacao OidcAuthVerifier. Tipos movem; classe fica.
- **well-known.ts**: Define OidcDiscoveryConfig + handler wellKnownOauthProtectedResourceHandler. Tipo move; handler fica.
- **Callers de IntrospectFn:** `packages/mcp/src/run-mcp-server.ts`, `packages/api/src/server/auth/oidc-introspect-oauth4webapi.ts`.
- **Callers de OidcDiscoveryConfig:** `packages/mcp/src/oidc-cli-resolver.ts` (agora em `src/agent-tools/`), `packages/api/src/server/app.ts`.

#### Deep Dives
- **Invariante:** `packages/api/src/server/index.ts` continua re-exportando os 3 tipos (backward-compat para consumidores que importam de `@usetheo/memory-api`).
- **IntrospectionResult** tem 12 campos RFC 7662 — copiar type definition verbatim, preservando JSDoc.

#### Tasks
1. Criar `oidc-contracts.ts` com os 3 tipos (copiar definitions verbatim, preservar JSDoc)
2. Atualizar `packages/core/src/domain/index.ts` para re-exportar
3. Atualizar `oidc-verifier.ts` para importar de core e re-exportar
4. Atualizar `well-known.ts` para importar de core e re-exportar
5. Atualizar `packages/mcp/src/run-mcp-server.ts` para importar de core
6. Verificar backward-compat: `packages/api/src/server/index.ts` re-exporta os 3 tipos

#### TDD
```
RED:     test('IntrospectFn importable from @usetheo/memory core barrel')
GREEN:   Criar oidc-contracts.ts e re-exports
REFACTOR: Remove old definitions, keep re-exports
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] 3 tipos definidos em `domain/dip/oidc-contracts.ts`
- [ ] MCP importa de core, nao de api
- [ ] Api-server re-exporta para backward-compat
- [ ] `pnpm test && pnpm typecheck` zero erros

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

### T3.2 — Remove SkillRepresentationStrategy (YAGNI)

#### Objective
Deletar a interface sem implementacoes e seus type-level tests.

#### Why this step
**Action:** Remover `packages/core/src/domain/dip/skill-representation-strategy.ts` (53 LoC), remover re-export de `domain/index.ts`, remover `skill-barrel.test.ts` e `skill-representation-strategy.test-d.ts` que testam apenas o tipo.
**Reasoning:** YAGNI per D4 — 0 implementacoes, 0 callers produtivos, JSDoc diz "slot only at v0.6; no implementation ships". Manter uma interface sem implementacao e speculative generality (SOLID § 13.2 OCP, mas apenas quando ha variacao REAL — § 11 YAGNI filtra).

#### Evidence
- `architecture-output/final_report.md` § 4 Finding #5: "YAGNI: SkillRepresentationStrategy DIP with 0 implementations"
- `grep -rln 'SkillRepresentationStrategy'` retorna apenas: definition, barrel, 2 type tests. Zero callers de producao.

#### Files to edit
```
packages/core/src/domain/dip/skill-representation-strategy.ts — DELETE
packages/core/src/domain/skill-barrel.test.ts — remover referencia
packages/core/src/domain/skill-representation-strategy.test-d.ts — DELETE
packages/core/src/domain/index.ts — remover re-export
packages/core/src/index.ts — remover re-export se presente
```

#### Deep file dependency analysis
- **Nenhum caller de producao.** Apenas type tests.
- **domain/index.ts**: Exporta `SkillRepresentationStrategy` e `SkillRepresentation` — remover linhas.
- **src/index.ts (root barrel)**: Verificar se re-exporta — se sim, remover.

#### Tasks
1. **EC-5 (SHOULD TEST):** Ler `skill-barrel.test.ts` — se testa APENAS SkillRepresentationStrategy, DELETE o arquivo inteiro. Se testa outros symbols tambem, remover apenas a linha/assertion de SkillRepresentationStrategy.
2. Deletar `skill-representation-strategy.ts`
3. Deletar `skill-representation-strategy.test-d.ts`
4. Atualizar `skill-barrel.test.ts` (delete ou edit per step 1)
5. Atualizar `domain/index.ts` e `src/index.ts` para remover re-exports
6. Verificar typecheck

#### TDD
```
RED:     Nao aplicavel (remocao de codigo morto — nenhum teste falhara)
GREEN:   Deletar files e re-exports
REFACTOR: None expected
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `skill-representation-strategy.ts` deletado
- [ ] Zero references a `SkillRepresentationStrategy` em `src/` (exceto comments historicos se houver)
- [ ] `pnpm test && pnpm typecheck` zero erros

#### DoD
- [ ] All tests passing — `pnpm test`
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`

---

## Coverage Matrix

| # | Gap / Requirement (Finding) | Task(s) | Resolution |
|---|---|---|---|
| 1 | HIGH: SRP — God file infra-db/index.ts 1,526 LoC | T1.1, T1.2, T1.3, T1.4 | Split em 5 arquivos < 500 LoC |
| 2 | HIGH: DRY — 5 files duplicados MCP/CLI (536 LoC) | T2.1 | MCP importa de agent-tools; duplicatas deletadas |
| 3 | HIGH: LCOM4=3 infra-db poor cohesion | T1.1, T1.2, T1.3, T1.4 | Cada arquivo extraido tem LCOM4=1 |
| 4 | MEDIUM: SRP — LocalScopedMemory.reflect 167 lines | T1.1 | Isolado em scoped-memory.ts (melhoria futura: decomposicao interna do reflect e escopo separado) |
| 5 | MEDIUM: YAGNI — SkillRepresentationStrategy 0 impls | T3.2 | Interface removida |
| 6 | MEDIUM: Clean function — createLocalMemory 169 lines | T1.3 | Isolado em factory.ts |
| 7 | MEDIUM: Clean function — applyDimChange 180 lines SQL | T1.4 | Isolado em migrations-runner.ts |
| 8 | MEDIUM: Missing Repository pattern PgvectorStore 887 LoC | — | DEFERRED: PgvectorStore ja implementa VectorStore DIP. Repository pattern seria refactor significativo sem ganho imediato. Escopo para plan separado se necessario. |
| 9 | LOW: YAGNI — Tokenizer DIP 1 impl (benchmark-only) | — | DEFERRED: Tokenizer e usado pelo benchmark adapter. Remocao exigiria re-design do benchmark pipeline (frozen per P0 § items 13-15). |
| 10 | LOW: Deep nesting migrations/meta depth 7 | T0.0 (no-op) | ACCEPTED: Convencao Drizzle ORM. Alterar quebraria drizzle-kit generate. Nenhuma acao necessaria. |
| 11 | MEDIUM: Auth contracts D=0.62 api-server coupling | T3.1 | Tipos movidos para domain/dip; D reduz para ~0.1 |

**Coverage: 8/11 findings addressed (73%); 2 deferred with rationale, 1 accepted as convention**

## Global Definition of Done

- [ ] All phases completed (T1.1 through T1.5, T2.1, T3.1, T3.2)
- [ ] All tests passing — `pnpm test` green
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`
- [ ] `packages/core/src/infrastructure/db/index.ts` < 100 LoC (barrel only)
- [ ] Zero arquivos duplicados entre `packages/mcp/src/` e `src/agent-tools/`
- [ ] `IntrospectFn`, `IntrospectionResult`, `OidcDiscoveryConfig` definidos em `domain/dip/`
- [ ] `SkillRepresentationStrategy` removida do codebase
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved — todos os 13 subpath exports resolvem
- [ ] Plan archived — after `/review` returns `READY_TO_MERGE` AND PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios

(none — no external I/O touched)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validar que o refactor nao quebrou nenhuma funcionalidade.

### Execution

```
pnpm test                          # unit + integration tests
pnpm typecheck                     # zero type errors
pnpm lint                          # zero lint warnings
```

Verificacao adicional:

```
# Verificar que todos os 13 subpath exports resolvem
node -e "require.resolve('@usetheo/memory')"
# Verificar que nenhum arquivo > 500 LoC no escopo
wc -l packages/core/src/infrastructure/db/*.ts | sort -rn | head -5
# Verificar que index.ts e barrel puro (< 100 LoC)
wc -l packages/core/src/infrastructure/db/index.ts
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration)
- [ ] Zero type errors
- [ ] Zero lint warnings
- [ ] `infrastructure/db/index.ts` < 100 LoC
- [ ] No file in scope > 500 LoC
- [ ] All 13 subpath exports resolve
