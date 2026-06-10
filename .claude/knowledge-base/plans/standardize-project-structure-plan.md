# Plan: Standardize Project Structure Across theo-memory and theo-rag

> **Version 1.2** — Unifica a estrutura de ambos os projetos do ecossistema Theo (@usetheo/memory e @usetheo/rag) em um System Design padronizado baseado em consenso da comunidade (Inngest, BullMQ, pg-boss). Elimina 18 divergencias estruturais documentadas entre os projetos, estabelecendo um template replicavel para qualquer futuro projeto Theo.
>
> **v1.1 changes:** Absorve 12 edge cases do review `standardize-project-structure-edge-cases-2026-06-10.md` (5 MUST FIX + 4 SHOULD TEST + 3 DOCUMENT).
> **v1.2 changes:** Fix plan-confidence INVALID: add `#### Concurrency tests` escape + `#### Why this step` + executable acceptance criteria to T2.1/T3.6/T4.1/T5.1; fix Coverage Matrix gap #10 task reference; move EC appendix out of Coverage Matrix zone.

## Goal

> "Migrar `@usetheo/memory` e `@usetheo/rag` para uma estrutura de monorepo pnpm padronizada com layout `packages/{core,api,cli,mcp}/` e convencoes unificadas de testes, exports, e build, medido por ambos os projetos passando `pnpm test && pnpm typecheck && pnpm lint` com zero erros apos a migracao."

## Context

Os dois projetos principais do ecossistema Theo (`@usetheo/memory` em pre-release v0.2, `@usetheo/rag` em rc.23) compartilham a mesma stack (TypeScript, Hono, Zod, Drizzle, pgvector, cuid2) mas divergem em 18 dimensoes estruturais fundamentais — desde package manager (npm vs pnpm) ate organizacao de testes (co-located misto vs separado). Um engenheiro novo precisa aprender dois "jeitos de fazer" para a mesma empresa. A padronizacao e sign-off do CTO (2026-06-10) levanta o P0 freeze de theo-memory especificamente para este refactor estrutural.

Referencia de pesquisa: analise comparativa de Inngest (40+ subpath exports, pnpm workspace), BullMQ (single-package com multi-language), pg-boss (CLI pattern), AnythingLLM (monorepo hibrido). Consenso da comunidade aponta pnpm workspaces + layer-based com feature subdirs + testes co-located + subpath exports explicitos.

## Baseline Context (deep review of current state)

### Files that will be touched

**theo-memory** (HEAD `aebac8f` 2026-06-10):

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `package.json` | 147 | `aebac8f` (2026-06-10) | Single-package npm config com 13 exports, 10 deps, 13 devDeps | Todas as 13 subpath exports devem continuar resolvendo |
| `tsconfig.json` | 6 | — | Referencia tsconfig.contract.json | Strict mode, es2022, nodenext |
| `tsconfig.build.json` | 20 | — | Build config excluindo testes | outDir dist/ |
| `tsconfig.contract.json` | 28 | — | Include explicito por diretorio | 8 patterns de include |
| `eslint.config.ts` | 74 | — | Flat config ESLint 9 | Regras typescript-eslint strict |
| `src/index.ts` | 164 | — | Barrel com JSDoc detalhado | Todos os re-exports publicos |
| `drizzle.config.ts` | 28 | — | Drizzle ORM migrations config | URI env var THEOMEM_PG_URI |
| `src/core/` (94 files) | ~4500 | — | Contracts, DIP, extraction pipeline | Zero I/O, sem imports de local/ |
| `src/local/` (89 files) | ~4200 | — | Postgres + pgvector adapter | Schema + 15 migrations SQL |
| `src/server/` (41 files) | ~2000 | — | Hono REST API + auth | 12th DIP AuthVerifier |
| `src/agent-tools/` (54 files) | ~2500 | — | MCP server + CLI (themory) | 4 MCP tools + Commander CLI |
| `src/embedders/` (8 files) | ~400 | — | Embedder DIP impls | Local + OpenAI + stub |
| `src/llms/` (6 files) | ~300 | — | LLM provider DIP impls | OpenAI + stub |
| `src/theokit/` (4 files) | ~200 | — | TheoKit binding | Zero peer-dep, structural typing |
| `src/benchmarks/` (41 files) | ~2000 | — | LongMemEval/LoCoMo/DMR | BenchmarkAdapter 10th DIP |
| `docker-compose.yaml` | — | — | Dev pgvector container | ankane/pgvector:v0.5.1 |
| `Dockerfile` | — | — | Multi-stage distroless Node 22 | ghcr.io/usetheo/themory image |
| `.npmrc` | 2 | — | engine-strict=true | — |
| `pnpm-workspace.yaml` (NEW) | 0 | — | (file to be created) | — |

**theo-rag** (HEAD `bc9c753` 2026-06-10):

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `package.json` (root) | 33 | `bc9c753` (2026-06-10) | pnpm workspace root | packageManager: pnpm@10.34.1 |
| `pnpm-workspace.yaml` | 2 | — | Workspace packages glob | packages/* |
| `packages/rag/package.json` | 141 | — | Lib core com 18 exports, 10 deps | Todas as 18 subpath exports |
| `packages/api/package.json` | 49 | — | REST server, 9 deps | workspace:* dep on @usetheo/rag |
| `packages/rag/src/index.ts` | 1 | — | Minimal barrel (1 line) | Re-export from core |
| `packages/rag/src/core/` (48 files) | ~2400 | — | Zod contract schemas | 8 domain modules |
| `packages/rag/src/pipeline/` (28 files) | ~1400 | — | Pipeline orchestrator | ingest/query/answer/answerStream |
| `packages/rag/src/retrievers/` (13 files) | ~650 | — | Vector + keyword + hybrid | RRF k=60 |
| `packages/api/src/server/` (61 files) | ~3000 | — | Hono routes + middleware + store | 28 endpoints |
| `packages/rag/eslint.config.ts` | 50 | — | Per-package flat config | — |

### Current callers / dependents

**Cross-project:**
- Nenhuma dependencia cruzada entre theo-memory e theo-rag (runtime totalmente independente)
- Ambos consumidos por projetos internos Theo (TheoKit, TheoCloud) via npm subpath imports

**theo-memory internal:**
- `src/index.ts` — barrel importado por consumers via `@usetheo/memory`; 164 linhas de re-exports
- `src/core/` — importado por `src/local/`, `src/server/`, `src/agent-tools/`, `src/theokit/`, `src/embedders/`, `src/llms/`
- `src/local/` — importado por `src/index.ts` (factory), `src/server/` (pool), `src/agent-tools/` (createLocalMemory)

**theo-rag internal:**
- `packages/rag/src/core/` — importado por todos os domain dirs (loaders, chunkers, embedders, etc.)
- `packages/rag/` — workspace dep de `packages/api/` via `workspace:*`

### Domain glossary

- **Monorepo workspace** — repositorio com multiplos packages gerenciados por pnpm/npm workspaces, compartilhando lockfile
- **Subpath export** — entrada no campo `exports` do package.json que expoe um modulo especifico (ex: `@usetheo/memory/server`)
- **DIP** — Dependency Inversion Principle; dominio define interface, infraestrutura implementa
- **Barrel** — arquivo index.ts que re-exporta simbolos publicos de um modulo
- **Co-located tests** — testes `.test.ts` no mesmo diretorio que o source (vs `tests/` separado)

### Architecture boundaries affected

**theo-memory** (`rules/architecture.md`):
- DIP: `src/core/` <- `src/local/` | `src/cloud/` | `src/theokit/` (Section 3)
- Mudanca: `src/core/` -> `packages/core/src/domain/`, `src/local/` -> `packages/core/src/infrastructure/`
- A direcao de dependencia NAO muda; apenas a localizacao fisica

**theo-rag** (`rules/architecture.md`):
- Layered boundaries: interface -> application -> domain <- infrastructure (Section 1)
- Mudanca: `packages/rag/src/core/` -> `packages/core/src/contract/`; nomes mudam, semantica mantem

## Prior Art & Related Work

- **Inngest** (`.claude/knowledge-base/references/` — ambos repos): pnpm monorepo, 40+ subpath exports, flat ESLint config, testes co-located. Gold standard para export discipline.
- **BullMQ**: Single package mas multi-language support; scripts de build com tsup.
- **pg-boss**: CLI como single entry point; testes separados em `test/`.
- **Hono framework**: Recomenda routes/ grouping por recurso, middleware como modulos separados.
- **Drizzle ORM**: Schema em arquivo unico, migrations como SQL files em diretorio dedicado.

## Objective

- [ ] Ambos os projetos usam pnpm como package manager
- [ ] Ambos seguem layout `packages/{core,api,cli?,mcp?}/`
- [ ] Convencao de testes unificada: co-located para unit, `tests/integration/` para integracao
- [ ] Nomenclatura de diretorio padronizada: `contract/`, `domain/`, `infrastructure/`
- [ ] Subpath exports explicitos em package.json com pattern consistente
- [ ] Build tooling unificado: tsc para apps, vitest configs padronizados
- [ ] ESLint config na raiz do workspace (nao per-package)

## ADRs

### D1 — pnpm como package manager unico

**Decision:** Ambos os projetos usam pnpm 10+ com `packageManager` field no root package.json.

**Rationale:** theo-rag ja usa pnpm; theo-memory usa npm. Manter dois package managers e overhead cognitivo desnecessario. pnpm e o consenso da comunidade para monorepos TypeScript (Inngest, Turborepo docs, Vite). Workspaces nativos sem Turborepo (YAGNI ate >= 4 packages, per theo-rag CLAUDE.md).

**Alternatives considered:**
- npm workspaces: funcional mas performance inferior, hoisting problematico, sem `workspace:*` protocol. Rejeitado.
- yarn berry: boa alternativa mas nao e o que nenhum dos projetos usa. Custo de migracao sem beneficio. Rejeitado.

**Consequences:** theo-memory precisa migrar package-lock.json -> pnpm-lock.yaml. node_modules reinstalado.

### D2 — Layout de packages padronizado

**Decision:** Cada projeto segue:
```
packages/
  core/    # @usetheo/<x>      — biblioteca principal
  api/     # @usetheo/<x>-api  — REST server (Hono)
  cli/     # @usetheo/<x>-cli  — Commander CLI (se aplicavel)
  mcp/     # @usetheo/<x>-mcp  — MCP server (se aplicavel)
```

**Rationale:** Separacao clara de concerns por deployment unit. theo-rag ja segue `packages/{rag,api}/`; padroniza o nome para `core` em vez do nome do produto. Server, CLI e MCP sao deployment units distintas com dependencias diferentes — bundla-los no core (como theo-memory faz) polui o tree-shaking e forca consumers a instalar deps de server.

**Alternatives considered:**
- Single-package com subpath exports (status quo theo-memory): funciona mas acopla server/CLI/MCP no mesmo package. Consumer que quer so a lib instala deps de Hono + Commander. Rejeitado por violacao de ISP.
- Feature-based packages (`packages/auth/`, `packages/retrieval/`): granularidade excessiva para o tamanho atual. YAGNI. Rejeitado.

**Consequences:** theo-memory precisa extrair `src/server/` -> `packages/api/`, `src/agent-tools/cli.ts` -> `packages/cli/`, `src/agent-tools/tools/` -> `packages/mcp/`. Imports internos mudam.

### D3 — Organizacao interna do core package

**Decision:** Dentro de `packages/core/src/`:
```
contract/       # Zod schemas + tipos puros (zero logica)
domain/         # Logica de negocio pura, interfaces DIP (zero I/O)
infrastructure/ # Adapters (DB, embedders, LLM providers)
```

**Rationale:** Clean Architecture layer-based e o padrao mais adotado pela comunidade TypeScript (Inngest middleware, Hono recommendations). theo-rag ja tem `core/` para contracts; theo-memory tem `core/` misturando contracts com logica. Separar explicitamente evita confusao.

**Alternatives considered:**
- Feature-based (`users/`, `memories/`, `collections/`): escala melhor para projetos grandes, mas ambos os projetos sao domain-specific (um faz memory, outro faz RAG). Nao ha features ortogonais suficientes. Rejeitado.
- Manter `core/` + `local/` (status quo theo-memory): funcional mas nao padronizavel — `local/` e um nome especifico do runtime, nao um layer. Rejeitado.

**Consequences:** Renaming massivo de imports em ambos os projetos. Scripts de migracao automatizados via `sed`/AST.

### D4 — Convencao de testes unificada

**Decision:**
- **Unit tests:** co-located como `<name>.test.ts` ao lado do source
- **Integration tests:** `tests/integration/` na raiz de cada package
- **E2E tests:** `tests/e2e/` na raiz do workspace (ou do package quando cross-package nao aplica)
- **Vitest configs:** 3 por package (`vitest.config.ts` default unit, `vitest.integration.config.ts`, `vitest.e2e.config.ts`)

**Rationale:** Co-locacao para unit tests e o padrao Inngest e facilita refactor (mover arquivo = mover teste). Integration precisa de setup diferente (DB real) entao fica separado. Ambos os projetos ja usam Vitest 4 com configs separados — unificar o pattern.

**Alternatives considered:**
- Tudo co-located (`__tests__/` por diretorio — status quo parcial de ambos): integration tests co-locados poluem `src/` com fixtures de DB. Rejeitado.
- Tudo separado (`tests/unit/`, `tests/integration/`, `tests/e2e/`): quebra a co-locacao que facilita refactor. Rejeitado.

**Consequences:** ~126 test files em theo-memory precisam mover de `src/**/__tests__/` para co-located `*.test.ts`. ~46 em theo-rag idem.

### D5 — ESLint config na raiz do workspace

**Decision:** Um unico `eslint.config.ts` na raiz do monorepo. Packages herdam via flat config cascade.

**Rationale:** Evita divergencia de regras entre packages. theo-memory tem eslint na raiz (OK); theo-rag tem per-package (divergencia). Flat config (ESLint 9) suporta cascade nativo.

**Alternatives considered:**
- Per-package eslint configs com base compartilhado: mais flexivel mas introduz indirectness desnecessario para 2-4 packages. Rejeitado (KISS).

**Consequences:** theo-rag move `packages/rag/eslint.config.ts` para raiz.

### D6 — Naming padronizado de packages npm

**Decision:**
| Projeto | Core | API | CLI | MCP |
|---|---|---|---|---|
| theo-memory | `@usetheo/memory` | `@usetheo/memory-api` | `@usetheo/memory-cli` | `@usetheo/memory-mcp` |
| theo-rag | `@usetheo/rag` | `@usetheo/rag-api` | (futuro) | (futuro) |

**Rationale:** Consistente com ecossistema (`@scope/name-suffix`). `@usetheo/rag-api` ja existe. theo-memory bundla tudo em `@usetheo/memory` hoje — separar permite install seletivo.

**Alternatives considered:**
- Manter subpath exports em package unico (`@usetheo/memory/server`): funciona mas instala deps de server para quem quer so a lib. Status quo rejeitado.

**Consequences:** Consumers de `@usetheo/memory/server` migram para `@usetheo/memory-api`. Breaking change aceito (pre-release).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Breaking change nos imports de consumers existentes | Medium | Ambos pre-release; CHANGELOG documenta migracao; nenhum consumer externo publicado | CTO |
| Risco de regressao na migracao de 340+ files (theo-memory) | High | Executar em branch `develop`, rodar suite completa (1216 unit + 328 integration) apos cada fase | Implementador |
| pnpm-lock.yaml de theo-memory gerado do zero pode ter versoes ligeiramente diferentes | Low | `pnpm install --frozen-lockfile` em CI valida; diff manual se necessario | Implementador |
| Perda de git blame history nos files movidos | Medium | `git mv` preserva parcialmente; `git log --follow` funciona. Splits across multiple commits (T3.2 then T3.5) may lose follow chain — `git log --all -- <old-path>` still works for archaeology. Documentar no CHANGELOG (EC-11) | Implementador |
| Tempo de execucao do refactor e alto (300+ files por projeto) | Low | Esforco aceito pelo CTO; automatizar com scripts sed/codemod onde possivel | CTO |

## Unresolved Questions

- Q1 — `src/benchmarks/` de theo-memory: fica em `packages/core/` ou vira `packages/benchmarks/`? Recomendacao: manter em core por enquanto (YAGNI para package separado). Decidir durante implementacao.
- Q2 — `src/theokit/` de theo-memory: fica em `packages/core/src/infrastructure/theokit/` ou vira `packages/theokit/`? Recomendacao: manter em core como adapter (e um binding fino, 4 files). Decidir durante implementacao.

## Dependency Graph

```
Phase 0 (Foundation doc)
    |
    v
Phase 1 (theo-rag) ──> Phase 2 (theo-rag validate)
    |
    v
Phase 3 (theo-memory):
    T3.1 (npm->pnpm + Dockerfile EC-2)
      |
      v
    T3.2 (extract api/) ──> T3.3 (extract cli/ — EC-4 dep mapping first)
      |                        |
      v                        v
    T3.4 (extract mcp/) ──> T3.5 (reorganize core — EC-1,3,5,8,12)
                               |
                               v  (strict sequencing per EC-5)
                             T3.6 (co-locate tests)
                               |
                               v
                          Phase 4 (validate)
                               |
                               v
                          Phase 5 (cross-project)
```

Phases 1-2 (theo-rag) e 3-4 (theo-memory) sao SEQUENCIAIS (theo-rag primeiro como piloto). Phase 5 valida ambos. Dentro de Phase 3, T3.5 -> T3.6 e STRICTLY SEQUENTIAL (EC-5: nao combinar directory rename com test co-location).

---

## Phase 0: Foundation — Architecture Standard Document

**Objective:** Criar o documento de referencia que define o padrao, antes de tocar qualquer codigo.

### T0.1 — Criar Architecture Standard Document

#### Objective
Escrever o documento `ARCHITECTURE-STANDARD.md` que sera copiado para ambos os repos como referencia canonica.

#### Why this step (action + reasoning)

**Action:** Criar um documento de referencia unico que define a estrutura padrao de qualquer projeto Theo.

**Reasoning:** Sem um documento de referencia, cada projeto implementa "o padrao" de forma ligeiramente diferente. O documento e o contrato; os projetos sao as implementacoes. Inngest tem `CONTRIBUTING.md` com layout docs; este e o nosso equivalente. Necessario ANTES de qualquer mudanca de codigo (D2, D3).

#### Evidence
- 18 divergencias documentadas na analise comparativa (sessao de conversa anterior)
- Inngest reference: `.claude/knowledge-base/references/inngest/` layout com 11 packages
- theo-rag `rules/architecture.md` Section 5 ja menciona "Package by layer" vs "Package by feature"

#### Files to edit
```
docs/ARCHITECTURE-STANDARD.md (NEW) — documento de padrao
```

#### Deep file dependency analysis
- Arquivo novo, sem dependentes existentes
- Sera referenciado por ambos os `rules/architecture.md` de cada projeto

#### Deep Dives
O documento define:
1. Layout de workspace (pnpm, `packages/` glob)
2. Nomenclatura de packages (`@usetheo/<x>`, `<x>-api`, `<x>-cli`, `<x>-mcp`)
3. Organizacao interna (`contract/`, `domain/`, `infrastructure/`)
4. Convencao de testes (co-located unit, separate integration/e2e)
5. Build tooling (tsc, vitest configs)
6. Naming conventions (kebab-case dirs, camelCase files)

#### Tasks
1. Escrever `docs/ARCHITECTURE-STANDARD.md` com todas as 6 secoes
2. Validar com o CTO

#### TDD
```
RED:     Nao aplicavel (documento, nao codigo)
GREEN:   Documento criado
REFACTOR: None expected
VERIFY:  Leitura manual pelo CTO
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Documento cobre todas as 6 secoes listadas acima
- [ ] Cada decisao tem rationale + alternativa rejeitada
- [ ] CTO aprova o documento

#### DoD (Definition of Done)
- [ ] Documento criado e commitado em `develop`

---

## Phase 1: Migrate theo-rag Structure

**Objective:** Ajustar theo-rag para conformar com o padrao. Mudancas menores pois ja e pnpm monorepo.

### T1.1 — Renomear packages/rag/ para packages/core/

#### Objective
Padronizar o nome do package principal de `rag` para `core`.

#### Why this step (action + reasoning)

**Action:** `git mv packages/rag packages/core`, atualizar `packages/core/package.json` name field (manter `@usetheo/rag`), atualizar workspace dep em `packages/api/package.json`.

**Reasoning:** D2 define que o package principal se chama `core/` em todos os projetos. theo-rag ja tem a estrutura correta internamente; so o nome do diretorio diverge. Necessario ANTES das mudancas internas (T1.2) para evitar conflitos de path.

#### Evidence
- `packages/rag/package.json` name: `@usetheo/rag` (mantem)
- `packages/api/package.json` dep: `"@usetheo/rag": "workspace:*"` (path resolve atualiza automaticamente com pnpm)

#### Files to edit
```
packages/rag/ -> packages/core/ — git mv do diretorio
packages/core/package.json — sem mudanca de name (continua @usetheo/rag)
packages/api/package.json — verificar que workspace:* resolve
pnpm-workspace.yaml — ja usa glob packages/*, sem mudanca
```

#### Deep file dependency analysis
- `packages/api/package.json` importa `@usetheo/rag` via `workspace:*` — pnpm resolve por name, nao por path. Sem mudanca necessaria.
- `pnpm-workspace.yaml` usa glob `packages/*` — captura `core/` automaticamente.
- tsconfig references em `packages/api/` podem referenciar `../rag/` — verificar e atualizar.

#### Deep Dives
- `git mv` preserva historia parcialmente
- pnpm `workspace:*` resolve pelo campo `name` do package.json, nao pelo nome do diretorio
- tsconfig.json `references` e `paths` podem usar caminhos relativos ao diretorio — verificar

#### Tasks
1. `git mv packages/rag packages/core`
2. `pnpm install` — verificar que workspace resolve `@usetheo/rag` via `name` field (EC-6: confirmar que `ls packages/api/node_modules/@usetheo/rag` symlinks para `../../core`)
3. Atualizar qualquer referencia relativa a `../rag/` em tsconfig de `packages/api/`
4. Rodar `pnpm test` e `pnpm typecheck`

#### TDD
```
RED:     pnpm typecheck falha se references estiverem quebrados
GREEN:   Atualizar paths; pnpm typecheck passa
REFACTOR: None expected
VERIFY:  pnpm test && pnpm typecheck && pnpm lint
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `packages/core/` existe com todo o conteudo de `packages/rag/`
- [ ] `pnpm install` resolve sem erros
- [ ] `pnpm test` passa (todos os 681 testes)
- [ ] `pnpm typecheck` zero erros
- [ ] Pass: lint — `pnpm lint` zero warnings

#### DoD (Definition of Done)
- [ ] Commit atomico com `git mv` + ajustes de path
- [ ] Todos os testes passing

### T1.2 — Reorganizar src/ de packages/core/ para layout padrao

#### Objective
Reorganizar de `core/` (flat Zod schemas) para `contract/` + `domain/` + `infrastructure/`.

#### Why this step (action + reasoning)

**Action:** Dentro de `packages/core/src/`, renomear `core/` para `contract/`, criar `domain/` para pipeline + retrievers + rerankers (logica pura), criar `infrastructure/` para vectorstore + embedders concretos + llm-providers concretos.

**Reasoning:** D3 define a separacao em 3 layers. theo-rag mistura Zod schemas (contract) com pipeline orchestration (domain) e vectorstore adapters (infrastructure) tudo em `src/` top-level. A reorganizacao torna explicita a direcao de dependencia e facilita onboarding.

#### Evidence
- `packages/core/src/core/` (48 files) — Zod schemas puros, sem logica -> `contract/`
- `packages/core/src/pipeline/` (28 files) — orchestration com DIP -> `domain/`
- `packages/core/src/retrievers/` (13 files) — interfaces DIP + impls -> split: interfaces em `domain/`, impls concretas em `infrastructure/`
- `packages/core/src/vectorstore/` (9 files) — Drizzle schema + pgvector adapter -> `infrastructure/db/`
- `packages/core/src/embedders/` (10 files) — interface DIP + OpenAI/stub impls -> interface em `domain/`, impls em `infrastructure/`

#### Files to edit
```
packages/core/src/core/ -> packages/core/src/contract/ — renomear
packages/core/src/pipeline/ -> packages/core/src/domain/pipeline/ — mover
packages/core/src/retrievers/ -> split domain/infrastructure
packages/core/src/rerankers/ -> split domain/infrastructure
packages/core/src/loaders/ -> packages/core/src/domain/loaders/ — logica pura
packages/core/src/chunkers/ -> packages/core/src/domain/chunkers/ — logica pura
packages/core/src/embedders/ -> split domain/infrastructure
packages/core/src/llm-providers/ -> split domain/infrastructure
packages/core/src/vectorstore/ -> packages/core/src/infrastructure/db/
packages/core/package.json — atualizar exports paths
```

#### Deep file dependency analysis
- 18 subpath exports em `package.json` precisam atualizar paths
- Todos os imports internos entre modulos precisam atualizar
- `packages/api/` importa via `@usetheo/rag/contract/*` etc — subpath export abstrai o path interno

#### Deep Dives
**Regra de split domain vs infrastructure:**
- Se o modulo define APENAS a interface DIP (type/interface) -> `domain/`
- Se o modulo IMPLEMENTA a interface com I/O concreto -> `infrastructure/`
- Se o modulo e logica pura sem I/O (loaders, chunkers) -> `domain/`
- `pipeline/` e orchestration que depende de interfaces -> `domain/`

**Invariante:** imports de `domain/` NUNCA importam de `infrastructure/`. `infrastructure/` importa interfaces de `domain/`.

#### Tasks
1. Criar estrutura de diretorios `domain/`, `infrastructure/`, renomear `core/` para `contract/`
2. Mover files conforme regra de split
3. Atualizar TODOS os imports internos (script automatizado com `sed` ou codemod)
4. Atualizar `package.json#exports` paths
5. Rodar `pnpm typecheck` — corrigir erros de import
6. Rodar `pnpm test` — todos passando
7. Atualizar `eslint.config.ts` include patterns se necessario

#### TDD
```
RED:     pnpm typecheck falha apos mover files (imports quebrados)
GREEN:   Corrigir todos os imports; typecheck + test passam
REFACTOR: Limpar imports redundantes
VERIFY:  pnpm test && pnpm typecheck && pnpm lint
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `packages/core/src/contract/` contem apenas Zod schemas e tipos
- [ ] `packages/core/src/domain/` contem logica pura e interfaces DIP
- [ ] `packages/core/src/infrastructure/` contem adapters com I/O
- [ ] Nenhum import de `domain/` referencia `infrastructure/`
- [ ] Todas as 18 subpath exports resolvem
- [ ] Pass: `pnpm test` (681 testes)
- [ ] Pass: `pnpm typecheck` zero erros
- [ ] Pass: `pnpm lint` zero warnings

#### DoD (Definition of Done)
- [ ] Commit atomico
- [ ] CHANGELOG atualizado

### T1.3 — Padronizar test co-location

#### Objective
Mover testes unitarios de `__tests__/` para co-located `*.test.ts`.

#### Why this step (action + reasoning)

**Action:** Para cada arquivo `src/foo/__tests__/bar.test.ts`, renomear para `src/foo/bar.test.ts`. Atualizar vitest include patterns.

**Reasoning:** D4 define co-location para unit tests. theo-rag mistura `__tests__/` (46 files) com co-located. Padronizar facilita refactor (mover source = mover teste) e e o padrao Inngest.

#### Evidence
- 46 test files em `packages/core/src/**/__tests__/**` patterns
- vitest.contract.config.ts include: `src/**/__tests__/**/*.test.ts` — precisa atualizar para `src/**/*.test.ts`

#### Files to edit
```
packages/core/src/**/__tests__/*.test.ts -> packages/core/src/**/*.test.ts (MOVE ~46 files)
packages/core/vitest.contract.config.ts — atualizar include pattern
packages/api/vitest.contract.config.ts — verificar pattern
```

#### Tasks
1. Script bash para mover todos os `__tests__/*.test.ts` para o diretorio pai
2. Remover diretorios `__tests__/` vazios
3. Atualizar vitest include patterns
4. Rodar `pnpm test` — todos passando

#### TDD
```
RED:     vitest nao encontra testes apos mover (include pattern antigo)
GREEN:   Atualizar include para src/**/*.test.ts; todos descobertos
REFACTOR: Remover dirs __tests__/ vazios
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Zero diretorios `__tests__/` em `packages/core/src/`
- [ ] Todos os test files co-located com seus sources
- [ ] `pnpm test` descobre e passa todos os 681 testes

#### DoD (Definition of Done)
- [ ] Commit atomico
- [ ] vitest configs atualizados

### T1.4 — Mover ESLint config para raiz do workspace

#### Objective
Consolidar ESLint config na raiz.

#### Why this step (action + reasoning)

**Action:** Mover `packages/core/eslint.config.ts` para raiz do workspace. Verificar que ambos os packages herdam.

**Reasoning:** D5 — config unico na raiz evita divergencia. ESLint flat config cascadeia naturalmente.

#### Files to edit
```
packages/core/eslint.config.ts -> eslint.config.ts (MOVE to root)
packages/api/eslint.config.ts — remover se existir (herda da raiz)
```

#### Tasks
1. Mover eslint config para raiz
2. Ajustar include patterns para cobrir `packages/*/src/**`
3. Verificar que ESLint descobre files atraves de symlinks pnpm: `pnpm lint --debug 2>&1 | head -20` (EC-7)
4. `pnpm lint` — zero warnings

#### TDD
```
RED:     pnpm lint nao encontra files apos mover config
GREEN:   Ajustar include; lint passa
VERIFY:  pnpm lint
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `eslint.config.ts` na raiz do workspace
- [ ] `pnpm lint` zero warnings em ambos packages

#### DoD (Definition of Done)
- [ ] Commit atomico

---

## Phase 2: Validate theo-rag Migration

**Objective:** Validar que toda a suite de testes passa e que nenhuma regressao foi introduzida.

### T2.1 — Full validation chain theo-rag

#### Objective
Rodar a chain completa de validacao pos-migracao de theo-rag.

#### Why this step (action + reasoning)

**Action:** Executar `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build` sequencialmente e verificar exit code 0 em cada um.

**Reasoning:** A Phase 1 moveu 138+ files, renomeou directories, e atualizou exports. Qualquer import quebrado, path stale, ou config desatualizado so sera detectado pela chain completa de validacao. Necessario ANTES de prosseguir para Phase 3 (theo-memory) — se theo-rag quebrou, o padrao precisa ser revisado.

#### Evidence
- 681 testes existentes (46 co-located + 32 separados em packages/core + 26+20 em packages/api)
- 18 subpath exports que devem resolver apos T1.2

#### Files to edit
```
(nenhum — task de validacao, nao de edicao)
```

#### Deep file dependency analysis
Todos os files movidos em T1.1-T1.4 sao verificados indiretamente via typecheck + test suite.

#### Tasks
1. `pnpm install` — exit code 0
2. `pnpm typecheck` — exit code 0, zero type errors
3. `pnpm lint` — exit code 0, zero warnings
4. `pnpm test` — exit code 0, all 681 tests pass
5. `pnpm test:integration` — exit code 0
6. `pnpm build` — exit code 0

#### TDD
```
RED:     N/A (validation task)
GREEN:   All 6 commands exit 0
REFACTOR: None expected
VERIFY:  All commands above
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm install` exit code 0
- [ ] `pnpm typecheck` exit code 0
- [ ] `pnpm lint` exit code 0
- [ ] `pnpm test` exit code 0 — 681 tests pass
- [ ] `pnpm test:integration` exit code 0
- [ ] `pnpm build` exit code 0
- [ ] Zero tests removed or skipped vs pre-migration count

#### DoD (Definition of Done)
- [ ] All 7 acceptance criteria verified
- [ ] Validation documented in commit message

---

## Phase 3: Migrate theo-memory to Monorepo

**Objective:** Transformar theo-memory de single-package npm em pnpm monorepo com packages separados.

### T3.1 — Converter npm -> pnpm workspace

#### Objective
Instalar pnpm, criar workspace config, migrar lockfile.

#### Why this step (action + reasoning)

**Action:** Criar `pnpm-workspace.yaml`, adicionar `packageManager` ao root `package.json`, deletar `package-lock.json`, rodar `pnpm install`.

**Reasoning:** D1 — pnpm como package manager unico. Primeiro passo antes de qualquer split de packages. Necessario para que `workspace:*` protocol funcione.

#### Evidence
- theo-memory `.npmrc`: `engine-strict=true` (ja suporta constraint de engine)
- Nenhum `packageManager` field em `package.json` — npm por default

#### Files to edit
```
pnpm-workspace.yaml (NEW) — workspace config
package.json — adicionar packageManager: pnpm@10.34.1
.npmrc — adicionar auto-install-peers=true (match theo-rag)
package-lock.json — DELETE (sera substituido por pnpm-lock.yaml)
Dockerfile — substituir npm ci -> pnpm install --frozen-lockfile; ajustar COPY paths (EC-2)
.github/workflows/docker-publish.yml — instalar pnpm antes de docker build (EC-2)
```

#### Tasks
1. Criar `pnpm-workspace.yaml` com `packages: ["packages/*"]`
2. Adicionar `"packageManager": "pnpm@10.34.1"` ao `package.json`
3. Adicionar `auto-install-peers=true` ao `.npmrc`
4. Deletar `package-lock.json`
5. Atualizar `Dockerfile`: Stage 1 `npm ci` -> `corepack enable && pnpm install --frozen-lockfile`; Stage 1 `npm run build` -> `pnpm build`; Stage 2 `npm ci --omit=dev` -> `pnpm install --prod --frozen-lockfile`; COPY paths ajustados para `packages/*/dist/` (EC-2 MUST FIX)
6. Atualizar `.github/workflows/docker-publish.yml`: adicionar `corepack enable` step antes de docker build (EC-2 MUST FIX)
7. `pnpm install` — gera `pnpm-lock.yaml`
8. Rodar `pnpm test` — todos os 1216 unit tests passam
9. Rodar `pnpm test:integration` — 328 integration tests passam

#### TDD
```
RED:     pnpm install pode falhar se deps incompativeis
GREEN:   Resolver conflitos; install bem-sucedido
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `pnpm-lock.yaml` gerado
- [ ] `package-lock.json` removido
- [ ] `pnpm install` resolve sem erros
- [ ] `pnpm test` passa (1216 testes)
- [ ] `Dockerfile` usa `pnpm install --frozen-lockfile` (EC-2)
- [ ] `docker compose build` passa sem erros (EC-2)

#### DoD (Definition of Done)
- [ ] Commit atomico

### T3.2 — Extrair packages/api/ de src/server/

#### Objective
Criar `packages/api/` como package separado com `@usetheo/memory-api`.

#### Why this step (action + reasoning)

**Action:** Criar `packages/api/`, mover `src/server/` para `packages/api/src/`, criar `packages/api/package.json` com dep `"@usetheo/memory": "workspace:*"`, atualizar imports.

**Reasoning:** D2 — server como package separado. theo-memory bundla server (41 files, ~2000 LoC) com CLI e MCP no mesmo package. Consumer que quer so a lib instala Hono, Commander, etc. Separar elimina deps desnecessarias para consumers da lib pura.

#### Files to edit
```
packages/api/ (NEW) — novo package
packages/api/package.json (NEW) — @usetheo/memory-api
packages/api/tsconfig.json (NEW) — extends root
packages/api/src/server/ — conteudo movido de src/server/
src/server/ — DELETE (movido)
package.json — remover export ./server, remover deps de server (hono, @hono/*)
```

#### Tasks
1. Criar `packages/api/` com package.json, tsconfig.json
2. `git mv src/server/ packages/api/src/`
3. Atualizar imports em `packages/api/src/` para usar `@usetheo/memory` (workspace dep)
4. Remover subpath export `./server` do root `package.json`
5. Mover deps de server (hono, @hono/zod-openapi, @hono/node-server) para `packages/api/`
6. `pnpm install` — resolve workspace deps
7. `pnpm typecheck` — corrigir erros
8. `pnpm test` — todos passando

#### TDD
```
RED:     Import de @usetheo/memory/server quebra (export removido)
GREEN:   Consumer agora importa de @usetheo/memory-api
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `packages/api/` existe com package.json name `@usetheo/memory-api`
- [ ] `src/server/` removido do core
- [ ] Hono deps apenas em `packages/api/package.json`
- [ ] `pnpm test` passa
- [ ] `pnpm typecheck` zero erros

#### DoD (Definition of Done)
- [ ] Commit atomico
- [ ] CHANGELOG atualizado

### T3.3 — Extrair packages/cli/ de src/agent-tools/cli.ts

#### Objective
Criar `packages/cli/` como package separado com `@usetheo/memory-cli`.

#### Why this step (action + reasoning)

**Action:** Criar `packages/cli/`, mover CLI-specific code de `src/agent-tools/` para `packages/cli/src/`, manter MCP tools em `src/agent-tools/` para T3.4.

**Reasoning:** D2 — CLI como deployment unit separada. Commander.js + CLI-specific code nao precisa estar no core package. `themory` bin migra para `packages/cli/package.json`.

#### Files to edit
```
packages/cli/ (NEW) — novo package
packages/cli/package.json (NEW) — @usetheo/memory-cli, bin: { themory }
packages/cli/src/commands/ (NEW) — comandos movidos de src/agent-tools/
src/agent-tools/cli.ts — DELETE (movido)
package.json — remover bin field
```

#### Tasks
1. **(EC-4 MUST FIX) Dependency mapping de src/agent-tools/:** Antes de mover, classificar cada arquivo como CLI-only, MCP-only, ou SHARED. Shared utilities (scope-binding, AsyncLocalStorage, common types) ficam em `packages/core/` e sao importados via `workspace:*` por cli e mcp. Rodar: `grep -rn "from '\.\." src/agent-tools/ | sort | uniq -c | sort -rn` para identificar imports cruzados.
2. Criar `packages/cli/` com package.json (name: @usetheo/memory-cli, bin: themory)
3. Mover CLI-only files de `src/agent-tools/` para `packages/cli/src/`
4. Mover SHARED utilities para `packages/core/src/domain/agent-shared/` (se houver)
5. Manter MCP-only tools (`src/agent-tools/tools/`) no core temporariamente (T3.4 extrai)
6. Atualizar imports
7. `pnpm test && pnpm typecheck`

#### TDD
```
RED:     themory CLI nao encontrado no PATH apos mover
GREEN:   bin field em packages/cli/package.json; pnpm install linka
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `packages/cli/` existe com bin `themory`
- [ ] `npx @usetheo/memory-cli themory --help` funciona
- [ ] `pnpm test` passa

#### DoD (Definition of Done)
- [ ] Commit atomico

### T3.4 — Extrair packages/mcp/ de src/agent-tools/

#### Objective
Criar `packages/mcp/` como package separado com `@usetheo/memory-mcp`.

#### Why this step (action + reasoning)

**Action:** Criar `packages/mcp/`, mover MCP tools de `src/agent-tools/tools/` e server setup para `packages/mcp/src/`.

**Reasoning:** D2 — MCP server como deployment unit. MCP tem deps especificas (@modelcontextprotocol/sdk) que nao pertencem ao core.

#### Files to edit
```
packages/mcp/ (NEW) — novo package
packages/mcp/package.json (NEW) — @usetheo/memory-mcp
packages/mcp/src/tools/ — 4 MCP tools movidos
src/agent-tools/ — DELETE (esvaziado por T3.3 + T3.4)
package.json — remover export ./agent-tools
```

#### Tasks
1. Criar `packages/mcp/` com package.json
2. Mover MCP tools e server de `src/agent-tools/`
3. Remover subpath export `./agent-tools`
4. Remover dir `src/agent-tools/` (vazio)
5. `pnpm test && pnpm typecheck`

#### TDD
```
RED:     Import de @usetheo/memory/agent-tools quebra
GREEN:   Consumer importa de @usetheo/memory-mcp
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `packages/mcp/` existe com 4 MCP tools
- [ ] `src/agent-tools/` removido
- [ ] `pnpm test` passa

#### DoD (Definition of Done)
- [ ] Commit atomico

### T3.5 — Reorganizar packages/core/src/ para layout padrao

#### Objective
Aplicar o mesmo layout `contract/` + `domain/` + `infrastructure/` ao core de theo-memory.

#### Why this step (action + reasoning)

**Action:** Renomear `src/core/` para `packages/core/src/domain/` (ja e logica pura), mover `src/local/` para `packages/core/src/infrastructure/`, mover `src/embedders/` e `src/llms/` para `packages/core/src/infrastructure/`.

**Reasoning:** D3 — layout padrao. theo-memory ja tem boa separacao (`core/` e puro, `local/` e adapter), so precisa renomear para os nomes padrao.

#### Evidence
- `src/core/` (94 files) — contracts + DIP + extraction pipeline. Tudo puro -> `domain/`
- `src/local/` (89 files) — Postgres adapter -> `infrastructure/`
- `src/embedders/` (8 files) — DIP impls -> `infrastructure/embedders/`
- `src/llms/` (6 files) — DIP impls -> `infrastructure/llms/`
- `src/theokit/` (4 files) -> `infrastructure/theokit/`
- `src/benchmarks/` (41 files) -> `domain/benchmarks/` (logica pura, sem I/O)

#### Files to edit
```
src/ -> packages/core/src/ (mover tudo que resta)
src/core/ -> packages/core/src/domain/
src/core/dip/ -> packages/core/src/domain/dip/ (interfaces DIP, ja contrato)
src/local/ -> packages/core/src/infrastructure/db/
src/embedders/ -> packages/core/src/infrastructure/embedders/
src/llms/ -> packages/core/src/infrastructure/llms/
src/theokit/ -> packages/core/src/infrastructure/theokit/
src/benchmarks/ -> packages/core/src/domain/benchmarks/
src/index.ts -> packages/core/src/index.ts
packages/core/package.json (NEW) — @usetheo/memory
```

#### Tasks
1. Criar `packages/core/` com package.json herdando deps do root
2. Mover source files conforme mapping acima
3. Criar `packages/core/src/contract/` extraindo Zod schemas de `domain/`
4. **(EC-5 MUST FIX)** Atualizar TODOS os imports (script automatizado). O script DEVE lidar com mudanca de profundidade dos imports relativos — ex: `../../../core/errors.js` em tests dentro de `__tests__/` muda de profundidade quando o source muda de `src/local/` para `packages/core/src/infrastructure/db/`. **Executar T3.5 ANTES de T3.6** (co-location de testes) para evitar combinar duas transformacoes de path simultaneamente.
5. Atualizar `package.json#exports` paths
6. **(EC-1 MUST FIX)** Atualizar `postbuild:copy-migrations` em `packages/core/package.json`: path de origem muda de `src/local/migrations` para `src/infrastructure/db/migrations`; path de destino muda de `dist/local/migrations` para `dist/infrastructure/db/migrations`. Verificar que `runMigrations()` em `src/infrastructure/db/index.ts` continua usando `dirname(fileURLToPath(import.meta.url))` + `./migrations` (path relativo, funciona se migrations esta no mesmo dir).
7. **(EC-3 MUST FIX)** Atualizar `files` field em `packages/core/package.json`: remover `src/local/migrations/**` e `dist/local/migrations/meta/**`; adicionar `src/infrastructure/db/migrations/**` e `dist/infrastructure/db/migrations/**`. Verificar com `pnpm pack --dry-run` que `*.sql` files estao incluidos.
8. **(EC-8 SHOULD TEST)** Atualizar `drizzle.config.ts`: path do schema muda de `src/local/schema.ts` para `packages/core/src/infrastructure/db/schema.ts`. Verificar com `pnpm db:generate` (deve encontrar o schema).
9. **(EC-12 DOCUMENT)** Atualizar `scripts/apply-trigger-migrations.mjs`: path de scan muda de `src/local/migrations/*.sql` para `packages/core/src/infrastructure/db/migrations/*.sql`. Dev-only script; low severity.
10. **(EC-9 SHOULD TEST)** Mover vitest configs para `packages/core/`; atualizar include patterns. Apos mover, verificar: `pnpm test --reporter=verbose 2>&1 | grep "Tests"` mostra contagem esperada (nao 0).
11. `pnpm typecheck` — corrigir erros
12. `pnpm test` — todos passando (1216 unit + 328 integration)
13. **(EC-10 DOCUMENT)** `.claude/rules/architecture.md` referencia paths antigos (`src/core/`, `src/local/`). Sera atualizado em T5.1. Plans historicos em `knowledge-base/plans/completed/` NAO sao editados (per audit-trail-rotation.md).

#### TDD
```
RED:     Imports quebrados em massa apos mover
GREEN:   Script de migracao corrige todos os imports; typecheck passa
REFACTOR: Limpar imports redundantes
VERIFY:  pnpm test && pnpm typecheck && pnpm lint
VERIFY:  pnpm pack --dry-run | grep -c ".sql" (deve ser >= 15, EC-3)
VERIFY:  pnpm db:generate (drizzle encontra schema, EC-8)
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `packages/core/src/contract/` — Zod schemas puros
- [ ] `packages/core/src/domain/` — logica + interfaces DIP
- [ ] `packages/core/src/infrastructure/` — adapters
- [ ] DIP preservado: domain/ NAO importa infrastructure/
- [ ] `pnpm test` passa (1216+ testes)
- [ ] `pnpm typecheck` zero erros
- [ ] Pass: size — nenhum arquivo > 500 linhas
- [ ] `pnpm pack --dry-run` inclui `*.sql` migration files (EC-3)
- [ ] `postbuild:copy-migrations` usa paths atualizados (EC-1)
- [ ] `drizzle.config.ts` aponta para novo schema path (EC-8)

#### DoD (Definition of Done)
- [ ] Commit atomico
- [ ] CHANGELOG atualizado

### T3.6 — Padronizar test co-location

#### Objective
Mover testes de `__tests__/` para co-located `*.test.ts` em theo-memory.

#### Why this step (action + reasoning)

**Action:** Script bash para mover cada `__tests__/*.test.ts` para o diretorio pai, ajustar imports relativos (perdem 1 nivel de profundidade), atualizar vitest include patterns.

**Reasoning:** D4 define co-location para unit tests. theo-memory tem 126 test files em `packages/core/src/**/__tests__/` (apos T3.5 move-los para la). **(EC-5):** Esta task DEVE rodar DEPOIS de T3.5 ter sido validada — nunca em paralelo. T3.5 muda os paths dos diretorios; T3.6 muda a profundidade dos tests. Combinar ambas transformacoes simultaneamente duplica o risco de import breaks.

#### Evidence
- 126 test files em `src/**/__tests__/` (baseline context)
- vitest.contract.config.ts include pattern precisa mudar de `__tests__/**/*.test.ts` para `**/*.test.ts`

#### Files to edit
```
packages/core/src/**/__tests__/*.test.ts -> packages/core/src/**/*.test.ts (MOVE ~126 files)
packages/core/vitest.contract.config.ts — atualizar include pattern
```

#### Deep file dependency analysis
- Cada test file tem imports relativos que referenciam o source 1 nivel acima (ex: `../foo.js`)
- Apos co-location, o test esta no MESMO dir que o source — imports mudam de `../foo.js` para `./foo.js`

#### Tasks
1. **(Pre-condition):** T3.5 `pnpm test && pnpm typecheck` GREEN — confirmar antes de iniciar.
2. Script bash para mover `__tests__/*.test.ts` para diretorio pai, ajustando imports relativos que perdem 1 nivel de profundidade (ex: `../../foo` -> `../foo`).
3. Remover diretorios `__tests__/` vazios.
4. Atualizar vitest include patterns para `src/**/*.test.ts`.
5. `pnpm test` — todos os 1216 testes passando.

#### TDD
```
RED:     vitest nao encontra testes apos mover (include pattern antigo)
GREEN:   Atualizar include para src/**/*.test.ts; todos descobertos
REFACTOR: Remover dirs __tests__/ vazios
VERIFY:  pnpm test && pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Zero diretorios `__tests__/` em `packages/core/src/`
- [ ] Todos os test files co-located com seus sources
- [ ] `pnpm test` exit code 0 — descobre e passa todos os 1216 testes
- [ ] `pnpm typecheck` exit code 0

#### DoD (Definition of Done)
- [ ] Commit atomico
- [ ] vitest configs atualizados

---

## Phase 4: Validate theo-memory Migration

**Objective:** Validacao completa de theo-memory.

### T4.1 — Full validation chain theo-memory

#### Objective
Validar que toda a suite de testes, build, e Docker de theo-memory passa apos a migracao completa.

#### Why this step (action + reasoning)

**Action:** Executar `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `docker compose build` sequencialmente.

**Reasoning:** Phase 3 moveu 340+ files, extraiu 3 packages, reorganizou o core, e co-locou 126 tests. Validacao completa e obrigatoria antes de prosseguir para cross-project validation. Docker build verifica que o Dockerfile atualizado em T3.1 (EC-2) funciona com o novo layout.

#### Evidence
- 1216 unit tests + 328 integration tests (baseline)
- Dockerfile atualizado em T3.1 para pnpm

#### Files to edit
```
(nenhum — task de validacao)
```

#### Tasks
1. `pnpm install` — exit code 0
2. `pnpm typecheck` — exit code 0
3. `pnpm lint` — exit code 0
4. `pnpm test` — exit code 0, 1216 unit tests pass
5. `pnpm test:integration` — exit code 0, 328 integration tests pass
6. `pnpm build` — exit code 0
7. `docker compose build` — exit code 0

#### TDD
```
RED:     N/A (validation task)
GREEN:   All 7 commands exit 0
VERIFY:  All commands above
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm install` exit code 0
- [ ] `pnpm typecheck` exit code 0
- [ ] `pnpm lint` exit code 0
- [ ] `pnpm test` exit code 0 — 1216 unit tests pass
- [ ] `pnpm test:integration` exit code 0 — 328 integration tests pass
- [ ] `pnpm build` exit code 0
- [ ] `docker compose build` exit code 0
- [ ] Zero tests removed or skipped vs pre-migration count

#### DoD (Definition of Done)
- [ ] All 8 acceptance criteria verified
- [ ] Validation documented in commit message

---

## Phase 5: Cross-Project Validation

**Objective:** Garantir que ambos os projetos seguem o mesmo padrao.

### T5.1 — Cross-validation checklist

#### Objective
Verificar que ambos os projetos conformam com o Architecture Standard definido em T0.1.

#### Why this step (action + reasoning)

**Action:** Executar um checklist de 8 pontos contra ambos os repos, verificando conformidade estrutural. Atualizar `rules/architecture.md` de ambos para referenciar o Architecture Standard.

**Reasoning:** Sem validacao cruzada, cada projeto pode ter implementado o padrao de forma ligeiramente diferente. O checklist garante equivalencia estrutural — a propria razao de existir deste plano.

#### Evidence
- T0.1 Architecture Standard document define os 8 criterios
- T2.1 + T4.1 validaram cada projeto individualmente — T5.1 valida CRUZADO

#### Files to edit
```
theo-memory/.claude/rules/architecture.md — adicionar referencia ao Architecture Standard
theo-rag/.claude/rules/architecture.md — adicionar referencia ao Architecture Standard
```

#### Tasks
1. Verificar que ambos tem `pnpm-workspace.yaml` com `packages/*`
2. Verificar que ambos tem `packageManager: pnpm@10.34.1`
3. Verificar que ambos tem layout `packages/{core,api,...}/`
4. Verificar que ambos tem `contract/` + `domain/` + `infrastructure/` em core
5. Verificar que testes unitarios sao co-located em ambos
6. Verificar que ESLint config esta na raiz em ambos
7. Verificar que naming conventions sao identicas (kebab-case dirs)
8. Atualizar `rules/architecture.md` de ambos para referenciar o Architecture Standard

#### TDD
```
RED:     N/A (validation + documentation task)
GREEN:   Checklist 8/8 pass; architecture.md updated
VERIFY:  Manual review of both repos
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Checklist 8/8 items confirmados via `ls` + `cat` em ambos repos
- [ ] `rules/architecture.md` de theo-memory atualizado com referencia ao Architecture Standard
- [ ] `rules/architecture.md` de theo-rag atualizado com referencia ao Architecture Standard
- [ ] CHANGELOG de ambos atualizado sob `[Unreleased] § Changed`

#### DoD (Definition of Done)
- [ ] All 4 acceptance criteria verified
- [ ] Commits atomicos em ambos repos

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | npm vs pnpm divergencia | T3.1 | theo-memory migra para pnpm |
| 2 | Single-package vs monorepo | T3.2, T3.3, T3.4 | theo-memory vira monorepo com 4 packages |
| 3 | Folder naming inconsistente (rag/ vs nome especifico) | T1.1 | theo-rag renomeia para core/ |
| 4 | Organizacao interna divergente (core/ flat vs layered) | T1.2, T3.5 | Ambos adotam contract/ + domain/ + infrastructure/ |
| 5 | Testes: __tests__/ vs co-located inconsistente | T1.3, T3.6 | Ambos adotam co-located para unit |
| 6 | ESLint config location divergente | T1.4 | Ambos movem para raiz |
| 7 | Server bundled vs separado | T3.2 | theo-memory extrai para packages/api/ |
| 8 | CLI bundled vs separado | T3.3 | theo-memory extrai para packages/cli/ |
| 9 | MCP bundled vs separado | T3.4 | theo-memory extrai para packages/mcp/ |
| 10 | Package naming inconsistente | T3.2, T3.3, T3.4 | Padrao @usetheo/<x>-{api,cli,mcp} per ADR D6 |
| 11 | Architecture standard document | T0.1 | Documento de referencia criado |
| 12 | Cross-project validation | T5.1 | Checklist de conformidade |

**Coverage: 12/12 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm test` green em ambos os projetos
- [ ] Zero type errors — `pnpm typecheck` em ambos
- [ ] Zero lint warnings — `pnpm lint` em ambos
- [ ] File-size budget respected (500 LoC per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` em ambos os projetos
- [ ] Backward compatibility: subpath exports que mudaram documentados em CHANGELOG com guia de migracao
- [ ] `rules/architecture.md` de ambos os projetos referencia o Architecture Standard
- [ ] Docker builds de ambos os projetos funcionam

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `pnpm install` (theo-memory migracao) | Resolucao de deps falha por peer dep mismatch | `pnpm install --frozen-lockfile` em CI | Corrigir peer deps; re-gerar lockfile |
| `pnpm workspace:*` protocol | Package nao encontrado apos rename | `pnpm typecheck` detecta | Verificar name field match em package.json |
| `git mv` (rename de dirs) | Historia de git perdida | `git log --follow -- <file>` | Aceitar perda parcial; documentar no CHANGELOG |

```
(external I/O limited to pnpm install + git operations — no runtime services affected)
```

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validar que ambos os projetos funcionam end-to-end apos a migracao.

### Execution

```bash
# theo-rag
cd /home/paulo/Projetos/usetheo/theo-data/theo-rag
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build

# theo-memory
cd /home/paulo/Projetos/usetheo/theo-data/theo-memory
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
docker compose build
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration) em ambos
- [ ] Zero type errors em ambos
- [ ] Zero lint warnings em ambos
- [ ] Docker builds em ambos
- [ ] Cross-validation checklist T5.1 aprovado

---

## Appendix: Edge Cases Absorbed (v1.1)

Source: `standardize-project-structure-edge-cases-2026-06-10.md`

EC-1 (MUST FIX): `postbuild:copy-migrations` hardcodes `src/local/migrations` — absorbed into T3.5 step 6.
EC-2 (MUST FIX): Dockerfile uses `npm ci` — absorbed into T3.1 steps 5-6.
EC-3 (MUST FIX): `package.json#files` references old paths — absorbed into T3.5 step 7.
EC-4 (MUST FIX): CLI/MCP share code — absorbed into T3.3 step 1 (dependency mapping).
EC-5 (MUST FIX): Deep relative imports break on depth change — absorbed into T3.5 step 4 + T3.6 pre-condition.
EC-6 (SHOULD TEST): pnpm workspace symlink resolution — absorbed into T1.1 step 2.
EC-7 (SHOULD TEST): ESLint flat config cascade — absorbed into T1.4 step 3.
EC-8 (SHOULD TEST): drizzle.config.ts schema path — absorbed into T3.5 step 8.
EC-9 (SHOULD TEST): Vitest include patterns — absorbed into T3.5 step 10.
EC-10 (DOCUMENT): `.claude/rules/architecture.md` stale paths — absorbed into T3.5 step 13, updated in T5.1.
EC-11 (DOCUMENT): Git follow chain breaks — absorbed into Drawbacks row 4.
EC-12 (DOCUMENT): `apply-trigger-migrations.mjs` path — absorbed into T3.5 step 9.
