# Plan: Extract CLI to packages/cli/ — Complete Workspace Uniformization

> **Version 1.1** — Move `src/agent-tools/` (2,154 LoC production + 1,555 LoC tests) para `packages/cli/`, completando a uniformizacao do workspace. Apos a movimentacao, `src/` fica vazio e e removido. Atualiza 11 configs (package.json bin/lint, 2 tsconfigs, vitest, eslint, Dockerfile, pnpm-workspace) e 9 import paths em `packages/mcp/`. Refactor puro — zero mudanca de API publica, zero feature nova. Qualifica como P0 hardening.
>
> **v1.1 changes (edge-case absorption):** EC-1 rootDir fix via postbuild:move-cli script (dist path stable); EC-2 auth/ subdir added to baseline; EC-3 GitHub Actions check added to T2.6; EC-4 postbuild:copy-migrations verification in T2.3; EC-5 D1 Consequences text corrected to align with D2.

## Goal

> "Mover `src/agent-tools/` para `packages/cli/src/` e deletar o diretorio `src/` raiz, medido por `pnpm test && pnpm typecheck && pnpm lint` com zero erros, `themory --help` funcional apos build, e `ls src/ 2>&1` retornando 'No such file or directory'."

## Context

Apos a reorganizacao do workspace (commits `ab62443`..`1827fbe`), `packages/core/`, `packages/api/` e `packages/mcp/` existem como workspace packages. Porem `src/agent-tools/` permaneceu no diretorio raiz `src/` como o unico ocupante. Isso cria inconsistencia: 3 modulos vivem em `packages/`, 1 vive em `src/`. Configuracoes de build, lint e test tem que listar ambos os paths. O subpath `@usetheo/memory/agent-tools` resolve via tsconfig path mapping apontando para `src/agent-tools/index.ts` — funciona em dev mas e fragil para publicacao.

Mover para `packages/cli/` uniformiza o workspace: todo codigo fonte vive sob `packages/`. As 11 configs que referenciam `src/agent-tools/` sao atualizadas em uma unica passada atomica.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/agent-tools/` (18 .ts + 12 tests) | 3,709 total | `fc4b4b8` (2026-06-11) | CLI `themory` + shared helpers | Todos os exports via `@usetheo/memory/agent-tools` devem continuar resolvendo |
| `packages/cli/` (NEW) | 0 | — | Destino da movimentacao | — |
| `packages/cli/package.json` (NEW) | 0 | — | Workspace package manifest | — |
| `package.json` (root) | ~95 | — | bin, lint script | `themory` e `themory-mcp` bin commands devem funcionar pos-build |
| `tsconfig.contract.json` | ~35 | — | Path mappings + include | `@usetheo/memory/agent-tools` deve resolver para novo path |
| `tsconfig.build.json` | ~20 | — | Build include | CLI deve compilar para dist/ |
| `vitest.contract.config.ts` | ~35 | — | Alias + test include | Testes CLI devem rodar |
| `eslint.config.ts` | ~80 | — | File patterns | CLI deve ser lintado |
| `Dockerfile` | ~95 | — | COPY + ENTRYPOINT | Container deve bootar `themory server` |
| `pnpm-workspace.yaml` | ~3 | — | Workspace packages | `packages/cli` deve ser reconhecido |

### Current callers / dependents

- **`@usetheo/memory/agent-tools` subpath**: 9 importers em `packages/mcp/src/` (run-mcp-server.ts, server.ts, index.ts, dispatch.ts, 4 handlers, handlers.test.ts). Path mapping em tsconfig aponta para `src/agent-tools/index.ts`.
- **`themory` bin**: `package.json#bin.themory` aponta para `./dist/agent-tools/cli.js`. Dockerfile ENTRYPOINT usa `/app/dist/agent-tools/cli.js`.
- **Nenhum import relativo cruzando para `src/agent-tools/`** de outros packages (confirmado via grep).

### Domain glossary

- **Workspace package** — Diretorio sob `packages/` com seu proprio `package.json`, reconhecido por `pnpm-workspace.yaml`.
- **Subpath export** — Entrada em `package.json#exports` que permite `import from '@usetheo/memory/agent-tools'`.
- **Barrel** — `index.ts` que re-exporta simbolos de submodulos.

### Architecture boundaries affected

- **`packages/cli/` → `@usetheo/memory` (core)**: CLI importa de core via package name — sem mudanca na direcao.
- **`packages/mcp/` → `@usetheo/memory/agent-tools`**: MCP importa shared helpers do CLI via subpath — path mapping muda mas semantica preservada.
- **`rules/architecture.md` § 3**: Precisa ser atualizado para refletir que `src/agent-tools/` nao existe mais.

## Prior Art & Related Work

- **Plan `architecture-review-fixes` v1.1** (`knowledge-base/plans/architecture-review-fixes-plan.md`) — precedente direto: T2.1 configurou o subpath `@usetheo/memory/agent-tools` que este plano atualiza.
- **Plan `standardize-project-structure`** (`knowledge-base/plans/standardize-project-structure-plan.md`) — plano original de reorganizacao que moveu core/api/mcp para `packages/`. `src/agent-tools/` ficou pendente.
- **`rules/architecture.md` § 3** — DIP boundaries, dependency direction.

## Objective

- [ ] `src/agent-tools/` movido para `packages/cli/src/`
- [ ] `src/agent-tools/__tests__/` movido para `packages/cli/src/__tests__/`
- [ ] `src/` raiz deletado (vazio)
- [ ] 11 configs atualizados (package.json, 2 tsconfigs, vitest, eslint, Dockerfile, pnpm-workspace)
- [ ] 9 import paths em `packages/mcp/` inalterados (resolvem via path mapping atualizado)
- [ ] `pnpm test && pnpm typecheck && pnpm lint` = zero erros novos
- [ ] `themory --help` funcional apos `pnpm build`

## ADRs

### D1 — `packages/cli/` como workspace package interno (sem publicacao npm separada)

**Decision:** `packages/cli/` e um workspace package interno com `"private": true`. Nao e publicado como pacote npm separado. O root `package.json` mantem `bin` apontando para o output compilado do CLI.

**Rationale:** O CLI e o entry-point do monorepo, nao uma lib consumivel. Criar um pacote npm separado (`@usetheo/memory-cli`) seria YAGNI — ninguem `npm install`a o CLI como dependencia; usam `npx @usetheo/memory mcp` ou o Docker image. Per `CLAUDE.md` § 11 (YAGNI).

**Alternatives considered:**
- *Pacote npm publicavel `@usetheo/memory-cli`*: Rejeitado — adiciona overhead de publicacao (package.json exports, barrel, versioning independente) sem consumidor identificado. O CLI ja e distribuido via root package (`npx @usetheo/memory`) e Docker.
- *Manter em `src/agent-tools/`*: Rejeitado — unico diretorio restante em `src/`, inconsistente com workspace structure. 11 configs referenciam dois prefixos diferentes (`packages/` + `src/`).

**Consequences:** `packages/cli/` participa do workspace pnpm mas nao aparece no npm registry. Root `package.json#bin` continua como distribuicao path. Build output preserva `dist/agent-tools/` per D2 (EC-5 fix — v1.0 dizia incorretamente que mudaria para `dist/cli/`).

### D2 — Preservar dist path `dist/agent-tools/cli.js` via postbuild:move-cli (EC-1 absorbed)

**Decision:** Apos `tsc`, um script `postbuild:move-cli` move `dist/packages/cli/src/` para `dist/agent-tools/`. Isso preserva o dist path estavel (`dist/agent-tools/cli.js`) que o Dockerfile ENTRYPOINT, `package.json#bin`, e `postbuild:copy-migrations` referenciam.

**Rationale:** EC-1 descobriu que tsc sem `rootDir` explicito computa o LCA dos `include` paths. Com `include: ["packages/core/src/**", "packages/cli/src/**"]`, o LCA e `packages/`, entao tsc emite `dist/core/src/...` e `dist/cli/src/...`. Isso quebraria TODOS os dist paths existentes. Investigacao pos-EC-1 revelou que o dist anterior (`dist/core/`, `dist/agent-tools/`) era de um build stale — o build ATUAL com o tsconfig pos-reorganizacao ja emite `dist/packages/core/src/...` e `dist/src/agent-tools/...` (bin path ja quebrado). A solucao mais simples: `postbuild:move-cli` que faz `mv dist/packages/cli/src dist/agent-tools` apos tsc.

**NOTA:** O dist path de core (`dist/packages/core/src/` vs `dist/core/`) tambem esta inconsistente mas e um problema pre-existente FORA do escopo deste plano. Este plano garante apenas que o CLI emite em `dist/agent-tools/` — o core dist path sera corrigido em plano separado.

**Alternatives considered:**
- *`rootDir: "."`*: Rejeitado — com include `["packages/core/src/**", "packages/cli/src/**"]` e rootDir `.`, tsc emite `dist/packages/core/src/...` e `dist/packages/cli/src/...`. Corrige o LCA problem mas ADICIONA prefix `packages/` que nao existia antes.
- *Symlink `dist/agent-tools/` → `dist/packages/cli/src/`*: Rejeitado — fragil, nao portavel.
- *tsconfig.cli.json separado com `outDir: "../../dist/agent-tools"`*: Rejeitado — requer 2 builds separados, complica o pipeline.

**Consequences:** `postbuild:move-cli` e um script de 1 linha no package.json (`mv dist/packages/cli/src dist/agent-tools`). Adiciona overhead minimo ao build. Source em `packages/cli/src/`, build output em `dist/agent-tools/`. Comentario no script documenta o motivo.

### D3 — Subpath `@usetheo/memory/agent-tools` mantido (nao renomear para `/cli`)

**Decision:** O subpath import `@usetheo/memory/agent-tools` nao e renomeado para `@usetheo/memory/cli`. Apenas o path mapping muda de `./src/agent-tools/index.ts` para `./packages/cli/src/index.ts`.

**Rationale:** Renomear o subpath e breaking change para `packages/mcp/` (9 import paths) e para qualquer consumidor externo que importa de `@usetheo/memory/agent-tools`. O nome `agent-tools` descreve o que o modulo EXPOE (tools para agentes), nao onde ele MORA. Per KISS + backward-compat.

**Alternatives considered:**
- *Renomear para `@usetheo/memory/cli`*: Rejeitado — breaking change. 9 importers em MCP + qualquer consumidor externo. Ganho cosmetico, risco real.

**Consequences:** Consumidores continuam importando de `@usetheo/memory/agent-tools`. Zero breaking change.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Source em `packages/cli/src/` mas dist output em `dist/agent-tools/` — mismatch confuso | Low | Comentario no postbuild:move-cli script explica o motivo (D2). Futuro refactor de dist paths e um plano separado. | Implementador |
| Git history de `src/agent-tools/` nao segue automaticamente para `packages/cli/src/` com `git mv` | Low | `git log --follow` funciona com `git mv`. Historico preservado na branch `develop` pre-move. | Implementador |
| Dist path de core (`dist/packages/core/src/`) tambem esta inconsistente com o esperado (`dist/core/`) — build stale mascarava o problema | Medium | FORA do escopo deste plano. O core dist path sera corrigido em plano separado. Este plano garante APENAS que `dist/agent-tools/cli.js` existe pos-build. | Implementador |
| `postbuild:move-cli` adiciona 1 step ao build pipeline | Low | Mesmo padrao ja usado por `postbuild:copy-migrations`. Overhead de <1s. | Implementador |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (Move files + create package.json) ──▶ Phase 2 (Update configs) ──▶ Phase 3 (Integration Validation)
```

Fases sao sequenciais — Phase 2 depende de Phase 1 (files precisam existir no novo path antes de atualizar configs).

---

## Phase 1: Move Files and Create Workspace Package

**Objective:** Mover todo o conteudo de `src/agent-tools/` para `packages/cli/src/` e criar o package.json do workspace package.

### T1.1 — Move source files via git mv + create packages/cli/package.json

#### Objective
Mover `src/agent-tools/` para `packages/cli/src/` preservando git history via `git mv`. Criar `packages/cli/package.json` como workspace package privado.

#### Why this step
**Action:** `git mv src/agent-tools packages/cli/src` seguido de criacao de `packages/cli/package.json` com `"private": true`.
**Reasoning:** `git mv` preserva tracking de rename para `git log --follow`. O package.json marca o diretorio como workspace package reconhecido por pnpm. Per D1 — workspace package interno, sem publicacao npm.

#### Evidence
- `src/agent-tools/` e o unico ocupante de `src/` (baseline § 1)
- `pnpm-workspace.yaml` declara `packages: ["packages/*"]` — `packages/cli/` sera reconhecido automaticamente (baseline § 9)

#### Files to edit
```
src/agent-tools/ — git mv para packages/cli/src/
packages/cli/package.json (NEW) — workspace package manifest
packages/cli/tsconfig.json (NEW) — herda de root, outDir configurado
```

#### Deep file dependency analysis
- **src/agent-tools/** (18 production + 12 test files + 1 auth/ subdir): Nenhum import relativo cruzando para fora de `src/agent-tools/`. Todos os imports externos usam package paths (`@usetheo/memory`, `@usetheo/memory/contract`, etc.) — funcionam independente da localizacao fisica.
- **src/agent-tools/auth/with-bearer-auth.ts** (164 LoC, EC-2): Subdiretorio com MCP HTTP auth wrapper. Incluido no `git mv` recursivo. Verificar que nenhum importer usa deep path `agent-tools/auth/` via grep.
- **__tests__/**: Imports relativos para `../` (parent implementation files) — funcionam apos move porque a estrutura interna e preservada.

#### Deep Dives
- **`git mv` atomicidade**: `git mv src/agent-tools packages/cli/src` move recursivamente, incluindo `auth/` subdir (EC-2). Se `packages/cli/` nao existir, `mkdir -p packages/cli` antes.
- **Invariante**: Nenhum arquivo dentro de agent-tools importa via path relativo que saia do diretorio. Confirmado pelo baseline § 11.
- **EC-2 pre-flight**: `grep -rn 'agent-tools/auth' packages/ src/ --include='*.ts'` deve retornar zero hits (deep imports).

#### Tasks
1. `mkdir -p packages/cli`
2. `git mv src/agent-tools packages/cli/src`
3. Criar `packages/cli/package.json` com `{ "name": "@usetheo/memory-cli", "private": true, "version": "0.0.0" }`
4. Deletar `src/` se vazio (`rmdir src`)
5. Verificar que `packages/cli/src/cli.ts` existe

#### TDD
```
RED:     test('packages/cli/src/cli.ts exists after move') — fs.existsSync
GREEN:   git mv
REFACTOR: None expected
VERIFY:  ls packages/cli/src/cli.ts && ! ls src/agent-tools/ 2>/dev/null
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `packages/cli/src/cli.ts` existe
- [ ] `packages/cli/src/__tests__/cli.test.ts` existe
- [ ] `src/` nao existe
- [ ] `packages/cli/package.json` existe com `private: true`
- [ ] `git status` mostra renames (nao deletes + adds)

#### DoD
- [ ] `git status` mostra renames detectados
- [ ] `packages/cli/package.json` valido

---

## Phase 2: Update All Configuration Files

**Objective:** Atualizar 11 configs para apontar para `packages/cli/src/` ao inves de `src/agent-tools/`.

### T2.1 — Update root package.json (bin + lint script)

#### Objective
Atualizar `package.json#bin` e `package.json#scripts.lint` para referenciar o novo path.

#### Why this step
**Action:** Mudar bin paths e lint glob de `src/agent-tools/` para `packages/cli/src/`. Per D2, dist path permanece `dist/agent-tools/cli.js` (bin nao muda).
**Reasoning:** O script lint referencia `src/agent-tools/**/*.ts` — precisa mudar para `packages/cli/src/**/*.ts`. Os bin paths apontam para dist, que per D2 nao muda.

#### Evidence
- `package.json:7-10` — bin field aponta para `dist/agent-tools/cli.js` (baseline § 3)
- `package.json:22` — lint script inclui `src/agent-tools/**/*.ts`

#### Files to edit
```
package.json — atualizar scripts.lint glob
```

#### Deep file dependency analysis
- **bin field**: Per D2, dist path nao muda — bin permanece `./dist/agent-tools/cli.js`. NAO editar.
- **lint script**: Mudar `'src/agent-tools/**/*.ts'` para `'packages/cli/src/**/*.ts'`.

#### Tasks
1. Atualizar `scripts.lint` glob
2. Verificar que bin paths NAO foram alterados (D2)

#### TDD
```
RED:     test('lint script references packages/cli/src') — grep package.json
GREEN:   Edit lint script
REFACTOR: None
VERIFY:  cat package.json | grep lint
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `scripts.lint` referencia `packages/cli/src/**/*.ts`
- [ ] `bin.themory` ainda aponta para `./dist/agent-tools/cli.js` (D2)

#### DoD
- [ ] `pnpm lint` roda sem erro de "no files matched"

---

### T2.2 — Update tsconfig.contract.json (path mapping + include)

#### Objective
Atualizar path mapping `@usetheo/memory/agent-tools` e include array.

#### Why this step
**Action:** Mudar `"@usetheo/memory/agent-tools": ["./src/agent-tools/index.ts"]` para `["./packages/cli/src/index.ts"]`. Mudar include de `src/agent-tools/**/*.ts` para `packages/cli/src/**/*.ts`.
**Reasoning:** Per D3, subpath name nao muda — apenas o path mapping interno.

#### Evidence
- `tsconfig.contract.json:29` — path mapping (baseline § 4)
- `tsconfig.contract.json:32` — include array

#### Files to edit
```
tsconfig.contract.json — paths + include
```

#### Tasks
1. Atualizar paths `@usetheo/memory/agent-tools` → `["./packages/cli/src/index.ts"]`
2. Atualizar include: `src/agent-tools/**/*.ts` → `packages/cli/src/**/*.ts`

#### TDD
```
RED:     test('tsconfig resolves @usetheo/memory/agent-tools to packages/cli') — grep
GREEN:   Edit tsconfig
VERIFY:  pnpm typecheck
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Path mapping aponta para `./packages/cli/src/index.ts`
- [ ] Include array contem `packages/cli/src/**/*.ts`
- [ ] `pnpm typecheck` zero erros

#### DoD
- [ ] `pnpm typecheck` PASS

---

### T2.3 — Update tsconfig.build.json + add postbuild:move-cli script (EC-1 absorbed)

#### Objective
Atualizar include array e adicionar `postbuild:move-cli` script que move `dist/packages/cli/src/` para `dist/agent-tools/` apos tsc, preservando o dist path estavel per D2.

#### Why this step
**Action:** Mudar include de `src/agent-tools/**/*.ts` para `packages/cli/src/**/*.ts`. Adicionar `postbuild:move-cli` no package.json que faz `mv dist/packages/cli/src dist/agent-tools && rmdir dist/packages/cli 2>/dev/null`. Encadear no build script.
**Reasoning:** EC-1 descobriu que tsc sem rootDir explicito computa o LCA dos include paths. Com ambos includes sob `packages/`, o LCA muda e o dist output inclui prefixos diferentes. A solucao mais simples e um postbuild mv — mesmo padrao ja usado pelo `postbuild:copy-migrations` existente.

#### Evidence
- EC-1: `knowledge-base/reviews/extract-cli-to-packages-edge-cases-2026-06-12.md` § MUST FIX EC-1
- Investigacao pos-EC-1: `pnpm build` atual emite `dist/packages/core/src/...` e `dist/src/agent-tools/...` — bin path `dist/agent-tools/cli.js` JA esta quebrado (build stale)
- `package.json:18-20` — build script ja encadeia postbuild steps

#### Files to edit
```
tsconfig.build.json — atualizar include array
package.json — adicionar postbuild:move-cli script + encadear no build
```

#### Deep Dives
- **Mecanismo**: tsc emite `dist/packages/cli/src/cli.js`. O postbuild move para `dist/agent-tools/cli.js`. O bin path `./dist/agent-tools/cli.js` resolve corretamente.
- **EC-4 (SHOULD TEST)**: Verificar que `postbuild:copy-migrations` continua funcionando — ele referencia `packages/core/src/infrastructure/db/migrations` (source) e `dist/infrastructure/db/migrations` (dest). O source path nao muda. O dest path pode precisar de ajuste se o rootDir shift afetar core tambem — verificar empiricamente.
- **Idempotencia**: O `mv` falha se `dist/agent-tools/` ja existir de um build anterior. Usar `rm -rf dist/agent-tools 2>/dev/null; mv dist/packages/cli/src dist/agent-tools`.

#### Tasks
1. Atualizar `tsconfig.build.json` include: `src/agent-tools/**/*.ts` → `packages/cli/src/**/*.ts`
2. Adicionar `postbuild:move-cli` no package.json: `rm -rf dist/agent-tools 2>/dev/null; mv dist/packages/cli/src dist/agent-tools; rmdir -p dist/packages/cli 2>/dev/null || true`
3. Encadear no build script: `&& npm run postbuild:move-cli`
4. Verificar que `pnpm build` emite `dist/agent-tools/cli.js`
5. Verificar que `postbuild:copy-migrations` ainda funciona (EC-4)

#### TDD
```
RED:     test('pnpm build produces dist/agent-tools/cli.js') — fs.existsSync after clean build
GREEN:   Configure tsconfig + postbuild script
VERIFY:  npm run prebuild:clean && pnpm build && node dist/agent-tools/cli.js --help
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm build` produz `dist/agent-tools/cli.js`
- [ ] Include array referencia `packages/cli/src/**/*.ts`
- [ ] `postbuild:move-cli` script existe no package.json
- [ ] `node dist/agent-tools/cli.js --help` funciona
- [ ] `postbuild:copy-migrations` ainda copia migrations corretamente (EC-4)

#### DoD
- [ ] `pnpm build` PASS
- [ ] `node dist/agent-tools/cli.js --help` funciona
- [ ] `ls dist/infrastructure/db/migrations/*.sql` retorna migrations

---

### T2.4 — Update vitest.contract.config.ts (alias + test include)

#### Objective
Atualizar alias e test include patterns.

#### Why this step
**Action:** Mudar alias `@usetheo/memory/agent-tools` de `./src/agent-tools/index.ts` para `./packages/cli/src/index.ts`. Mudar test include de `src/agent-tools/**/__tests__/**/*.test.ts` para `packages/cli/src/**/__tests__/**/*.test.ts`.
**Reasoning:** Vitest precisa resolver o subpath import em testes e incluir os test files do CLI.

#### Evidence
- `vitest.contract.config.ts:21` — alias (baseline § 6)
- `vitest.contract.config.ts:29` — test include

#### Files to edit
```
vitest.contract.config.ts — alias + include
```

#### Tasks
1. Atualizar alias path
2. Atualizar test include pattern

#### TDD
```
RED:     test('vitest config resolves CLI alias') — grep
GREEN:   Edit config
VERIFY:  pnpm test -- --reporter=verbose 2>&1 | grep 'cli'
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Alias aponta para `./packages/cli/src/index.ts`
- [ ] Test include contem `packages/cli/src/**`
- [ ] `pnpm test` roda testes CLI

#### DoD
- [ ] Testes CLI aparecem no output de `pnpm test`

---

### T2.5 — Update eslint.config.ts (file patterns)

#### Objective
Atualizar file patterns de lint.

#### Why this step
**Action:** Mudar `src/agent-tools/**/*.ts` para `packages/cli/src/**/*.ts` nos patterns de lint.
**Reasoning:** Sem update, eslint nao analisa o CLI no novo path.

#### Evidence
- `eslint.config.ts:20` — main files pattern (baseline § 7)
- `eslint.config.ts:48` — test files pattern

#### Files to edit
```
eslint.config.ts — 2 file patterns
```

#### Tasks
1. Atualizar linha 20 (main files)
2. Atualizar linha 48 (test files) — remover `src/{...,agent-tools,...}` pattern, adicionar `packages/cli/src/**/*.ts`

#### TDD
```
RED:     test('eslint config includes packages/cli') — grep
GREEN:   Edit patterns
VERIFY:  pnpm lint 2>&1 | head -5
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Main files pattern inclui `packages/cli/src/**/*.ts`
- [ ] Test files pattern atualizado
- [ ] `pnpm lint` nao reporta "no files matched"

#### DoD
- [ ] `pnpm lint` funciona

---

### T2.6 — Update Dockerfile (COPY path)

#### Objective
Atualizar COPY instruction para copiar `packages/cli/` ao inves de `src/`.

#### Why this step
**Action:** Mudar `COPY src/ ./src/` para `COPY packages/cli/ ./packages/cli/`. ENTRYPOINT nao muda per D2 (aponta para dist path estavel).
**Reasoning:** `src/` nao existe mais. Docker build falharia sem esta mudanca.

#### Evidence
- `Dockerfile:46` — `COPY src/ ./src/` (baseline § 8)
- `Dockerfile:94-95` — ENTRYPOINT usa dist path (nao muda per D2)

#### Files to edit
```
Dockerfile — COPY instruction
```

#### Tasks
1. Mudar `COPY src/ ./src/` para `COPY packages/cli/ ./packages/cli/`
2. Verificar que ENTRYPOINT NAO foi alterado (D2)
3. **EC-3:** `grep -n 'src/' .github/workflows/docker-publish.yml` — verificar que nao ha referencia hardcoded a `src/agent-tools/` no workflow. Se houver, atualizar.

#### TDD
```
RED:     test('Dockerfile copies packages/cli') — grep
GREEN:   Edit COPY line
VERIFY:  grep 'COPY packages/cli' Dockerfile
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `COPY packages/cli/` presente no Dockerfile
- [ ] ENTRYPOINT inalterado (`dist/agent-tools/cli.js`)
- [ ] `COPY src/` removido

#### DoD
- [ ] Dockerfile sintaticamente valido

---

### T2.7 — Update rules/architecture.md (remove src/agent-tools reference)

#### Objective
Atualizar `rules/architecture.md` § 3 para refletir o novo layout.

#### Why this step
**Action:** Remover referencia a `src/agent-tools/` no diagrama de dependency direction. Adicionar `packages/cli/` ao diagrama.
**Reasoning:** O diagrama DIP em `architecture.md` e a fonte de verdade para dependency direction. Se nao for atualizado, `/review` vai reportar divergencia.

#### Evidence
- `rules/architecture.md:56` — `src/agent-tools/` referenciado no diagrama

#### Files to edit
```
.claude/rules/architecture.md — § 3 dependency direction diagram
```

#### Tasks
1. Substituir `src/agent-tools/` por `packages/cli/` no diagrama
2. Manter a constraint: CLI depende apenas de `packages/core/`

#### TDD
```
RED:     test('architecture.md references packages/cli') — grep
GREEN:   Edit diagram
VERIFY:  grep 'packages/cli' .claude/rules/architecture.md
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Diagrama DIP referencia `packages/cli/`
- [ ] Zero referencias a `src/agent-tools/` em `architecture.md`

#### DoD
- [ ] `grep 'src/agent-tools' .claude/rules/architecture.md` retorna vazio

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Mover src/agent-tools/ para packages/cli/src/ | T1.1 | git mv + package.json |
| 2 | Deletar src/ raiz | T1.1 | rmdir apos move |
| 3 | Atualizar package.json bin + lint | T2.1 | Lint glob atualizado; bin preservado per D2 |
| 4 | Atualizar tsconfig.contract.json paths + include | T2.2 | Path mapping + include atualizados |
| 5 | Atualizar tsconfig.build.json include + dist path | T2.3 | Include atualizado; dist path preservado per D2 |
| 6 | Atualizar vitest alias + test include | T2.4 | Alias + include atualizados |
| 7 | Atualizar eslint file patterns | T2.5 | 2 patterns atualizados |
| 8 | Atualizar Dockerfile COPY | T2.6 | COPY atualizado; ENTRYPOINT preservado per D2 |
| 9 | Atualizar architecture.md | T2.7 | Diagrama DIP atualizado |
| 10 | Imports MCP via @usetheo/memory/agent-tools | T2.2 | Path mapping atualizado; imports inalterados per D3 |
| 11 | pnpm-workspace.yaml | T1.1 | packages/* wildcard ja cobre packages/cli/ |

**Coverage: 11/11 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (T1.1 through T2.7)
- [ ] All tests passing — `pnpm test` green
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings novos — `pnpm lint`
- [ ] `src/` nao existe
- [ ] `packages/cli/src/cli.ts` existe
- [ ] `themory --help` funcional apos `pnpm build`
- [ ] `dist/agent-tools/cli.js` existe apos build (D2)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved — `@usetheo/memory/agent-tools` resolve (D3)
- [ ] Plan archived — after `/review` returns `READY_TO_MERGE` AND PR merged

## Failure scenarios

(none — no external I/O touched)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validar que a movimentacao nao quebrou nenhuma funcionalidade.

### Execution

```
pnpm test                          # unit + integration tests
pnpm typecheck                     # zero type errors
pnpm lint                          # zero lint warnings novos
pnpm build                         # build produces dist/agent-tools/cli.js
node dist/agent-tools/cli.js --help # CLI funcional
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Zero type errors
- [ ] Zero lint warnings novos
- [ ] `dist/agent-tools/cli.js` existe apos build
- [ ] `node dist/agent-tools/cli.js --help` retorna sem erro
- [ ] `ls src/ 2>&1` retorna "No such file or directory"
- [ ] Docker build funciona (se CI disponivel)
