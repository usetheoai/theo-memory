---
slug: claude-code-kit-recall-parity
milestone_id: M14
created_at: 2026-07-24
goal: Entregar recall contínuo por-prompt + 4 tools MCP no kit Claude Code, scoped a (workspace,user,session-opcional), provado por teste de isolamento cross-tenant E cross-user verde.
---

# Plan: Paridade de recall do kit Claude Code (leitura contínua + autoria + 9 tools MCP), multi-tenant

> **Version 1.1** (edge-cases EC-1 ordem remember-then-forget, EC-2 token-guard, EC-3/EC-4 testes absorvidos 2026-07-24) — Fecha o gap de LEITURA do agente Claude Code em duas superfícies (lifecycle hooks + tools MCP), preservando o isolamento multi-tenant `(workspace, user, session-opcional)` de ADR-0021. Hoje o kit escreve 1.804 memórias/24h mas 79% nunca são lidas (recall busca por nome-do-projeto, 1×/sessão). Entrega: recall por-PROMPT scoped ao Principal, `attributed_to` por origem de hook, as 4 tools MCP faltantes (`get_memory`, `list_entities`, `update_memory`, `delete_entities`), hooks contextuais + guarda, e wizard de onboarding — cada superfície com a identidade vindo do SERVIDOR (Principal), jamais do argumento da tool.

## Goal

Entregar recall contínuo por-prompt + as 4 tools MCP faltantes no kit Claude Code, scoped a `(workspace, user, session-opcional)`, **provado por um teste de isolamento cross-tenant E cross-user verde (N/N passando)** sobre todas as superfícies novas.

Métrica observável primária: `tests/integration/kit-recall-parity/isolation.test.ts` passa 100% (um workspace/user jamais lê ou deleta dado de outro). Métrica secundária (benchmark do goal): a fração `last_accessed_at IS NULL` na base live cai de 79% após 48h de uso do recall por-prompt.

## Context

Blueprint SHIPPABLE_WITH_CAVEATS (89) em `.claude/knowledge-base/discoveries/blueprints/claude-code-kit-recall-parity-blueprint.md` investigou o `mem0-plugin` e produziu a decisão central de identidade server-side (registrada como ADR-M14-1 abaixo): o mem0 é single-tenant e injeta identidade NO CLIENTE (`enforce_metadata_defaults.sh`); nós somos multi-tenant e a identidade DEVE vir do Principal NO SERVIDOR — copiar a injeção client-side seria IDOR cross-tenant. O grill (`knowledge-base/grills/claude-code-kit-recall-parity-feature-grill.md`) travou a invariante e o escopo (paridade total, owner reafirmou incluir `update_memory` + `delete_entities`).

## Baseline Context (deep review of current state)

### Files that will be touched

| Arquivo | LoC hoje | Último commit | Por que existe |
|---|---|---|---|
| `docs/claude-code-kit/hooks/theo-recall.mjs` | 62 | 3de5325 (2026-07-23) | SessionStart recall — busca por `query: project` (o defeito) |
| `docs/claude-code-kit/hooks/theo-remember.mjs` | 53 | 3de5325 | Stop remember — escrita (recebe `attributed_to`) |
| `docs/claude-code-kit/hooks/merge-settings.mjs` | 122 | 3de5325 | Registro idempotente de hooks (`theoAdditions`) |
| `docs/claude-code-kit/hooks/theo-lib.mjs` | 200 | 29b0496 (2026-07-21) | `post`/`postDetached`/`loadEnv` — cliente REST do kit |
| `docs/claude-code-kit/hooks/theo-prompt-recall.mjs` | — | (NEW) | Hook UserPromptSubmit — recall por-prompt |
| `docs/claude-code-kit/hooks/theo-tool-context.mjs` | — | (NEW) | PostToolUse Bash — erro-context |
| `docs/claude-code-kit/hooks/theo-block-memory-write.mjs` | — | (NEW) | PreToolUse — guarda MEMORY.md |
| `docs/claude-code-kit/hooks/theo-onboard.mjs` | — | (NEW) | Wizard /onboard idempotente |
| `packages/mcp/src/tools/dispatch.ts` | 75 | bde870b (2026-07-20) | Mapa tool-name → handler (`HANDLERS`) |
| `packages/mcp/src/tools/list-handler.ts` | ~40 | 156755f | `tools/list` — declara as tools + schemas |
| `packages/mcp/src/tools/get-memory-handler.ts` + `-schema.ts` | — | (NEW) | tool `get_memory` |
| `packages/mcp/src/tools/list-entities-handler.ts` + `-schema.ts` | — | (NEW) | tool `list_entities` |
| `packages/mcp/src/tools/update-memory-handler.ts` + `-schema.ts` | — | (NEW) | tool `update_memory` (forget+remember) |
| `packages/mcp/src/tools/delete-entities-handler.ts` + `-schema.ts` | — | (NEW) | tool `delete_entities` |
| `packages/core/src/domain/memory-store.ts` | 244 | 3de5325 | DIP `MemoryStore` — `get(id)` já existe (linha 60) |
| `packages/core/src/domain/dip/memory-entity-store.ts` | 89 | 5cfd3ec (2026-07-23) | DIP `MemoryEntityStore` — só `supersedeEntity` (linha 88); FALTA forget-de-entidade |
| `packages/api/src/server/handlers/entities.ts` | 131 | 33df5eb (2026-07-23) | `entitiesHandler` + `filtersFor` — reuso para `list_entities` |
| `packages/api/src/server/handlers/_body-parsing.ts` | 156 | c6eaffa | `actingUserId(c)` — o Principal auth-trusted (linha 79) |

### Current callers / dependents

- `MemoryStore.get(memoryId)` (`memory-store.ts:60`) — DIP method; hoje sem caller no MCP (o gap de `get_memory`). Implementado em `memory-store.ts:217`.
- `filtersFor(type, id, userId)` (`entities.ts:58`) — chamado por `entitiesHandler` (`entities.ts:91`) com `actingUserId(c)`; é o padrão de scope a reusar em `list_entities`.
- `MemoryEntityStore.supersedeEntity` (`memory-entity-store.ts:88`) — chamado pelo reextract (M13); re-tipa, NÃO deleta. `delete_entities` precisa de um método novo.
- `dispatch.HANDLERS` (`dispatch.ts:32-46`) — o registro central; toda tool nova entra aqui + no `list-handler.ts`.
- `attributedTo` (`RememberOptions`, v1.1) — consumido por `remember`; os hooks de escrita passam a defini-lo por origem.

### Domain glossary

- **Principal** — identidade auth-trusted `(workspace, user)` resolvida da credencial via ForwardAuth + AsyncLocalStorage; nunca do body. `actingUserId(c)` a expõe.
- **attributed_to** — peer multi-valente (v1.1) que marca a AUTORIA de uma memória (user vs assistant), dentro do escopo `(workspace,user)`.
- **scope-aware recall** — M10: `recall` retorna `(workspace,user)` global ∪ sessão atual quando `session_id` presente.
- **fail-closed de filtro** — lição #252: uma operação destrutiva ABORTA se o filtro de escopo não for ecoado/confirmado, em vez de deletar em escopo aberto.
- **forget+remember** — o padrão ADD-only (ADR-0003) para simular "update" sem UPDATE in-place.

### Architecture boundaries affected

- `.claude/rules/architecture.md § 1-2` (layering + DIP): as tools MCP (interface) chamam o core via `Memory` (application); nunca importam infra direto. `delete_entities` adiciona um método à DIP `MemoryEntityStore` (domain define, infra implementa).
- Budget de LoC: 500/arquivo (`architecture.md`). Cada handler MCP novo fica < 100 LoC (padrão dos existentes).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | (lockfile atual) | npm | SDK MCP — as 4 tools novas são handlers sobre o server existente (ADR-M14-3) |
| `pg` | (lockfile atual) | npm | `forgetEntity` (T2.4a) usa CTE data-modifying via o driver já declarado |
| `zod` | (lockfile atual) | npm | schemas das tools novas (padrão dos `-schema.ts` existentes) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | — | **ZERO deps novas** (confirmado no blueprint § Coverage Corner 2). As 4 tools MCP reusam primitivos shipados (`MemoryStore.get`, handler REST `/entities`, `forget`+`remember`); `delete_entities` adiciona um MÉTODO à DIP interna (`forgetEntity`), não uma dep externa. Os hooks do kit são `.mjs` puro (Node stdlib + `theo-lib.mjs` existente). É uma feature de composição de primitivos internos — nada a instalar. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Prior Art & Related Work

- **Blueprint interno** `.claude/knowledge-base/discoveries/blueprints/claude-code-kit-recall-parity-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89) — a fonte de cada decisão; as decisões de identidade server-side e reconciliação de contratos (reproduzidas nos ADR-M14-1 e ADR-M14-2 deste plano).
- **Referência** `mem0-plugin` (`.claude/knowledge-base/references/mem0/integrations/mem0-plugin/`) — a mecânica de recall por-prompt, guarda (`block_memory_write.sh`), tool-context (`on_bash_output.sh`).
- **Milestones internos reusados:** M8/ADR-0021 (isolamento), M10 (scope-aware recall), M12 (import claude-code + kit), v1.1 (`attributed_to`), M13 (entidades).
- Nenhum `*-patterns` skill existe no repo (verificado Step 0) — nada a citar/sobrepor por esse gate.

## Objective

Fechar o gap de leitura do agente sem tocar a estrutura de tenancy: recall por-prompt + 4 tools MCP + hooks contextuais + wizard, todos herdando o Principal server-side, provado por isolamento cross-tenant/cross-user.

## ADRs

### ADR-M14-1 — Identidade do Principal no servidor, nunca do argumento da tool

**Decisão:** toda tool MCP e todo hook de recall resolve `(workspace,user)` do Principal (credencial + AsyncLocalStorage); o argumento `user_id`/`workspace_id` de qualquer tool é IGNORADO.

**Rationale:** per `architecture.md § 2` (DIP) e ADR-0021 (M8), a identidade é do servidor. O mem0 injeta client-side (`enforce_metadata_defaults.sh`) porque é single-tenant; replicar isso seria IDOR cross-tenant. Reusa o precedente `actingUserId` (`_body-parsing.ts:79`).

**Alternativa rejeitada:** injeção client-side + validação server-side — dupla verdade; o servidor já tem a verdade única, validar de novo é redundância que mascara a intenção de confiar no argumento.

### ADR-M14-2 — update_memory via forget+remember; delete_entities com fail-closed

**Decisão:** `update_memory` é a tool com o nome da referência mas implementada como `forget(id)+remember(newText)` (preserva ADR-0003 ADD-only + `history()`). `delete_entities` ganha um método novo `forgetEntity` na DIP `MemoryEntityStore` + guarda fail-closed: aborta se o filtro `(workspace,user)` não for confirmado; evento tipado; soft-delete via `t_invalid`.

**Rationale:** ADR-0003 proíbe UPDATE in-place; a lição #252 proíbe delete sem guarda de filtro. Honra os dois contratos locked.

**Alternativa rejeitada:** UPDATE in-place (viola ADR-0003); reusar `supersedeEntity` para delete (ele re-tipa, não deleta — semântica errada).

### ADR-M14-3 — Hooks de leitura como arquivos novos, registro via merge-settings idempotente

**Decisão:** cada hook novo é um `.mjs` próprio; o registro entra no `theoAdditions` do `merge-settings.mjs` (já idempotente, `alreadyPresent()`).

**Rationale:** SRP (`architecture.md § 3`) — um hook, um arquivo; o `merge-settings.mjs` já é o ponto único de registro testado. Não reescrever o `theo-recall.mjs` (SessionStart) — ele continua válido para o boot; o recall por-prompt é ADITIVO.

**Alternativa rejeitada:** empilhar a lógica de recall por-prompt dentro do `theo-recall.mjs` — mistura dois eventos (SessionStart vs UserPromptSubmit) num arquivo, viola SRP.

## Drawbacks & Risks

| Risco | Severidade | Mitigação | Owner |
|---|---|---|---|
| Vazamento cross-tenant/cross-user (recall/tool aceita user_id do body) | **ALTA** | ADR-M14-1: Principal server-side; teste de isolamento no DoD (Fase 5) | implementador |
| Latência: 1 recall por prompt trava o turno | MÉDIA | skip prompts curtos + timeout não-bloqueante (`postDetached` do kit já existe) | implementador |
| `delete_entities` repete o cascade-delete #252 (filtro descartado) | **ALTA** | ADR-M14-2: guarda fail-closed + soft-delete; teste do cenário #252 | implementador |
| `update_memory` viola ADD-only se implementado in-place | MÉDIA | ADR-M14-2: forget+remember; teste que confirma `history()` preservado | implementador |
| Escopo grande (4 tools + 4 hooks) estoura um único /implement | MÉDIA | fases independentes; cada uma commitável; F1 entrega 80% do valor sozinha | implementador |

## Unresolved Questions

(none — every decision is resolved at plan time. Escopo de `update_memory`/`delete_entities` reafirmado pelo owner; reconciliação com ADR-0003/#252 em ADR-M14-2.)

## Dependency Graph

```
Fase 1 (recall por-prompt + autoria)  ── independente, entrega 80% do valor
Fase 2 (4 tools MCP)                  ── independente de F1 (superfície MCP vs hooks)
   T2.1 get_memory ─┐
   T2.2 list_entities ─┼─ paralelas (reuso puro)
   T2.3 update_memory ─┘
   T2.4 delete_entities ── depende de T2.4a (forgetEntity no core)
Fase 3 (tool-context + guarda)        ── independente
Fase 4 (wizard onboard)               ── depende de nada novo (reusa import M12)
Fase 5 (Integration Validation)       ── depende de F1..F4 (teste de isolamento cobre TODAS)
```

## Phase 1: Recall por-prompt + autoria (núcleo, 80% do valor)

### T1.1 — Hook UserPromptSubmit com recall pelo PROMPT, scoped ao Principal

#### Files to edit
- `docs/claude-code-kit/hooks/theo-prompt-recall.mjs` (NEW, < 90 LoC)
- `docs/claude-code-kit/hooks/theo-prompt-recall.test.mjs` (NEW)

#### Deep file dependency analysis
Reusa `theo-lib.mjs` (`post`, `loadEnv`) — o mesmo cliente REST do `theo-recall.mjs`. O `/v1/recall` (M10) já é scope-aware: passa `sessionId` quando presente (SESSION ∪ GLOBAL), senão `userId`. O Principal `(workspace,user)` vem da credencial no header (`THEOMEM_MEMORY_TOKEN` do env), NÃO do payload do hook.

#### Why this step
**Ação:** criar o hook que dispara em toda mensagem do usuário, busca `/v1/recall` com `query = prompt` (não o nome do projeto), pula prompts < 20 chars, e injeta via `hookSpecificOutput.additionalContext`.
**Razão:** o defeito medido (`theo-recall.mjs:28` usa `query: project` constante → 79% não-lidos) é fechado ao usar o prompt como query — a mecânica provada em `on_user_prompt.sh:161` (blueprint T1). O canal de injeção já é o correto (`theo-recall.mjs:48`).

#### TDD
- RED: test_recall_uses_prompt_as_query() — mock `post`, verifica que `/v1/recall` recebeu `query === prompt` (não `project`).
- RED: test_skips_short_prompt() — prompt < 20 chars → `post` NÃO chamado, stdout vazio.
- RED: test_recall_at_exact_skip_boundary() (EC-4, EDGE) — prompt de EXATAMENTE 20 chars NÃO pula (régua `< 20`, alinhada a `on_user_prompt.sh:25`); fixa o off-by-one.
- RED: test_skips_recall_without_token() (EC-2, NEGATIVE) — `loadEnv().token == null` → `post` NÃO chamado, stdout vazio. Defesa em profundidade da invariante ADR-M14-1 (não confiar que o servidor recuse token-ausente).
- RED: test_injects_additionalContext_on_hits() — resultados → stdout JSON com `hookSpecificOutput.UserPromptSubmit.additionalContext`.
- RED: test_passes_sessionId_when_present() — payload com `session_id` → `post` recebe `sessionId` (M10 scope).
- GREEN: implementar o hook.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
- `node --test theo-prompt-recall.test.mjs` passa: o mock de `post` recebe `query === prompt` (asserção exata); prompt de 19 chars → `post` chamado 0 vezes; `post` que rejeita → stdout emite string vazia e o processo retorna exit code `0`.

#### DoD
`node --test docs/claude-code-kit/hooks/theo-prompt-recall.test.mjs` verde; `npm run lint` limpo.

### T1.2 — attributed_to por origem de hook (user vs assistant)

#### Files to edit
- `docs/claude-code-kit/hooks/theo-remember.mjs` (edit — passar `attributedTo: 'assistant'` nos resumos)
- `docs/claude-code-kit/hooks/theo-prompt-recall.mjs` (edit — quando detecta "remember this", marcar `attributedTo: 'user'`)
- `docs/claude-code-kit/hooks/theo-lib.mjs` (edit se preciso — expor `attributedTo` no `post`)
- `docs/claude-code-kit/hooks/theo-remember.test.mjs` (NEW/edit)

#### Deep file dependency analysis
`RememberOptions.attributedTo` (v1.1) já existe no core; o kit só precisa passá-lo. `theo-remember.mjs` (Stop) escreve o resumo do assistente; `theo-precompact.mjs` idem. O "remember this" do usuário é detectado no prompt (padrão de `on_user_prompt.sh:85`).

#### Why this step
**Ação:** definir `attributed_to` pela ORIGEM DO HOOK — Stop/PreCompact (assistente) → `assistant`; captura de "remember this" (usuário) → `user`.
**Razão:** blueprint T3 — no mem0 a autoria é `metadata.source` porque é single-tenant; nós temos o peer real `attributed_to`. Sem isso, resumos do assistente viram "preferência do usuário" (poluição auto-alimentada).

#### TDD
- RED: test_stop_summary_attributed_to_assistant() — `theo-remember` chama `post('/v1/remember', {attributedTo:'assistant', ...})`.
- RED: test_user_remember_attributed_to_user() — captura de "remember this" → `attributedTo:'user'`.
- GREEN: implementar.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`node --test theo-remember.test.mjs` passa: o mock de `post` recebe `attributedTo === 'assistant'` no Stop e `attributedTo === 'user'` na captura de "remember this" (asserção exata do campo).

#### DoD
`node --test` verde nos hooks de escrita; `npm run lint` limpo.

### T1.3 — Registrar os hooks de leitura no merge-settings.mjs

#### Files to edit
- `docs/claude-code-kit/hooks/merge-settings.mjs` (edit — adicionar `UserPromptSubmit` ao `theoAdditions`)
- `docs/claude-code-kit/test-merge.mjs` (edit — asserir o novo hook + idempotência)

#### Deep file dependency analysis
`theoAdditions()` (`merge-settings.mjs:92`) retorna o mapa de eventos→hooks; `mergeHooks()` (linha 61) já é idempotente. Adicionar a entrada `UserPromptSubmit` sem duplicar.

#### Why this step
**Ação:** registrar `theo-prompt-recall.mjs` sob `UserPromptSubmit` no `theoAdditions`.
**Razão:** o hook só dispara se registrado; `merge-settings.mjs` é o ponto único testado (ADR-M14-3). Idempotência já garantida por `alreadyPresent()`.

#### TDD
- RED: test_merge_adds_userpromptsubmit() — `theoAdditions()` inclui `UserPromptSubmit` apontando para `theo-prompt-recall.mjs`.
- RED: test_merge_idempotent_for_new_hook() — merge 2× não duplica.
- GREEN: implementar.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`node docs/claude-code-kit/test-merge.mjs` retorna exit `0`: `theoAdditions()` emite uma entrada `UserPromptSubmit` → `theo-prompt-recall.mjs`; merge aplicado 2× produz array de tamanho idêntico (assert de comprimento).

#### DoD
Teste de merge verde.

## Phase 2: As 4 tools MCP faltantes

### T2.1 — get_memory (por ID, reusa MemoryStore.get)

#### Files to edit
- `packages/mcp/src/tools/get-memory-schema.ts` (NEW) + `get-memory-handler.ts` (NEW, < 80 LoC)
- `packages/mcp/src/tools/dispatch.ts` (edit — registrar no HANDLERS)
- `packages/mcp/src/tools/list-handler.ts` (edit — declarar a tool)
- `packages/mcp/src/tools/get-memory-handler.test.ts` (NEW)

#### Deep file dependency analysis
`MemoryStore.get(memoryId)` (`memory-store.ts:60`) já retorna `MemoryItem | null`. O handler resolve o `Memory` scoped ao Principal (via `deps.memoryFactory`, padrão dos handlers existentes) e chama `get`. O `MemoryItem` retornado já é do workspace do Principal — get de outro workspace retorna null por construção.

#### Why this step
**Ação:** expor `get_memory` como tool MCP, reusando `MemoryStore.get`.
**Razão:** blueprint Q6 — falta no MCP mas o primitivo existe. Reuso puro, zero core novo.

#### TDD
- RED: test_get_memory_returns_item() — id válido → `MemoryItem`.
- RED: test_get_memory_not_found_returns_null_result() — id inexistente → resultado vazio, não erro.
- RED: test_get_memory_ignores_user_id_arg() (ISOLAMENTO) — arg `user_id` de outro user é IGNORADO; o scope é do Principal.
- GREEN: implementar handler+schema+registro.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`npm test -w packages/mcp` passa: `get_memory(id)` retorna um `MemoryItem` com o mesmo `id`; id inexistente retorna resultado vazio (não erro); arg `user_id` de outro user NÃO altera o `MemoryItem` retornado (asserção de isolamento).

#### DoD
`npm test -w packages/mcp` verde para o novo handler; typecheck limpo.

### T2.2 — list_entities (reusa a lógica do handler REST /entities)

#### Files to edit
- `packages/mcp/src/tools/list-entities-schema.ts` (NEW) + `list-entities-handler.ts` (NEW, < 90 LoC)
- `packages/mcp/src/tools/dispatch.ts` (edit) + `list-handler.ts` (edit)
- `packages/mcp/src/tools/list-entities-handler.test.ts` (NEW)

#### Deep file dependency analysis
`entitiesHandler` (`entities.ts:69`) usa `filtersFor(type, id, actingUserId(c))` (`entities.ts:58,91`) + `memoryEntityStore.list`. No MCP não há `Context c` (Hono), mas há o Principal via AsyncLocalStorage — o handler resolve o scope do mesmo modo (workspace+user do Principal). Reusa o `filtersFor` (exportá-lo se preciso) ou espelha a lógica de scope.

#### Why this step
**Ação:** expor `list_entities` no MCP com o mesmo scope `(workspace,user)` do handler REST.
**Razão:** blueprint Q6/Corner1 — o agente escreve entidades (M13) mas não tem `list_entities` no MCP. Mesmo gap de leitura, superfície MCP.

#### TDD
- RED: test_list_entities_scoped_to_principal() — retorna só entidades do `(workspace,user)` do Principal.
- RED: test_list_entities_ignores_scope_arg_from_other_user() (ISOLAMENTO) — arg de outro user não vaza.
- GREEN: implementar.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`npm test -w packages/mcp` passa: `list_entities` retorna apenas entidades cujo `workspace_id`/`user_id` == Principal; um arg de scope de outro user retorna array que NÃO contém a entidade do outro user (assert de isolamento).

#### DoD
`npm test -w packages/mcp` verde; typecheck limpo.

### T2.3 — update_memory (via forget+remember, ADR-0003)

#### Files to edit
- `packages/mcp/src/tools/update-memory-schema.ts` (NEW) + `update-memory-handler.ts` (NEW, < 90 LoC)
- `packages/mcp/src/tools/dispatch.ts` (edit) + `list-handler.ts` (edit)
- `packages/mcp/src/tools/update-memory-handler.test.ts` (NEW)

#### Deep file dependency analysis
`Memory.forget(id)` + `Memory.remember(text)` já existem. **Ordem crítica (edge EC-1):** o handler compõe `remember(newText)` PRIMEIRO; só APÓS o sucesso do remember, `forget(oldId)`. `history()` do id antigo é preservado (soft-delete via `t_invalid`), não hard-delete. O retorno expõe o id NOVO (edge EC-3).

#### Why this step
**Ação:** `update_memory` com o nome da referência, implementado como **remember-then-forget** (nessa ordem).
**Razão:** ADR-M14-2 + ADR-0003 (ADD-only). **A ordem importa (edge EC-1):** se fosse forget-then-remember e o remember falhasse (I/O externo), o dado antigo seria apagado sem substituição = perda de dado. Remember-first degrada para no-op se o remember falhar (o antigo continua vivo), nunca para perda. O agente vê "update"; o banco continua append-only e auditável.

#### TDD
- RED: test_update_remembers_before_forgets() (EC-1) — a ordem observada é `remember(newText)` ENTÃO `forget(oldId)`; NUNCA o inverso.
- RED: test_update_keeps_old_when_remember_fails() (EC-1, NEGATIVE) — `remember` rejeita → `forget` NÃO executa, oldId ainda vivo, erro tipado propagado.
- RED: test_update_returns_new_id_not_old() (EC-3) — o `CallToolResult` expõe o id NOVO (de remember), não o antigo; o schema documenta a divergência do "overwrite by ID" do mem0.
- RED: test_update_preserves_history() — `history(oldId)` ainda resolve pós-update (soft-delete).
- RED: test_update_ignores_cross_user_id() (ISOLAMENTO) — não atualiza memória de outro user.
- GREEN: implementar.

#### Concurrency tests
(none — single-threaded)

#### Failure scenarios
- `remember(newText)` falha (rede/extração) → `forget` NÃO executa, oldId permanece vivo, erro tipado propagado (degrada para no-op, não perda — EC-1).

#### Acceptance criteria
`npm test -w packages/mcp` passa: o mock observa `remember` chamado ANTES de `forget` (assert de ordem); `remember` que rejeita → `forget` chamado 0 vezes e `get(oldId)` ainda retorna o item; o `CallToolResult` expõe o novo `id` (assert != oldId).

#### DoD
`npm test -w packages/mcp` verde; typecheck limpo.

### T2.4a — Primitivo forgetEntity na DIP MemoryEntityStore + guarda fail-closed

#### Files to edit
- `packages/core/src/domain/dip/memory-entity-store.ts` (edit — declarar `forgetEntity`)
- `packages/core/src/infrastructure/db/pg-memory-entity-store.ts` (edit — implementar com CTE + guarda de filtro)
- `packages/core/src/**/pg-memory-entity-store.test.ts` (edit/NEW)

#### Deep file dependency analysis
Hoje só existe `supersedeEntity` (`memory-entity-store.ts:88`), que re-tipa. `forgetEntity` é novo: soft-delete da entidade + seus edges/links por `entity_id`, scoped a `(workspace, user)`, com **guarda fail-closed** — a operação recebe o filtro de escopo e ABORTA (erro tipado) se ele vier vazio/não-confirmado, em vez de deletar em escopo aberto (lição #252). Data-modifying CTE para atomicidade (um round-trip, não hops de conexão).

#### Why this step
**Ação:** adicionar o primitivo de forget-de-entidade que o core não tem, com a rede de segurança do #252.
**Razão:** ADR-M14-2 — `delete_entities` precisa disso; `supersedeEntity` tem semântica errada (re-tipa). A guarda fail-closed é a lição direta do incidente #252.

#### TDD
- RED: test_forget_entity_soft_deletes_scoped() — entidade + edges do `(workspace,user)` marcados `t_invalid`; entidade de outro user intacta.
- RED: test_forget_entity_aborts_without_scope_filter() (GUARDA #252) — filtro vazio → erro tipado, ZERO deleção.
- RED: test_forget_entity_emits_typed_event() — evento de deleção emitido (Princípio 3, auditável).
- GREEN: implementar na DIP + pg impl.

#### Concurrency tests
`#### Concurrency tests` — a CTE data-modifying é atômica (um statement); teste que uma deleção concorrente não deixa edges órfãos (invariante: edges sempre soft-deletados junto com a entidade). Sinal race-aware: transação única, não hops de pool.

#### Failure scenarios
- Filtro de escopo ausente/não-confirmado → `EntityForgetScopeError` (typed), zero linhas afetadas — o cenário #252 exato.

#### Acceptance criteria
`npm run test:integration` passa contra `ankane/pgvector:v0.5.1`: `forgetEntity` seta `t_invalid` nas linhas do `(workspace,user)` e deixa a entidade de outro user com `t_invalid` NULL; filtro vazio lança `EntityForgetScopeError` e afeta `0` linhas; um evento tipado é emitido (assert de contagem).

#### DoD
`npm run test:integration` verde contra `ankane/pgvector:v0.5.1` para o novo método; typecheck limpo.

### T2.4b — delete_entities (tool MCP sobre forgetEntity)

#### Files to edit
- `packages/mcp/src/tools/delete-entities-schema.ts` (NEW) + `delete-entities-handler.ts` (NEW, < 90 LoC)
- `packages/mcp/src/tools/dispatch.ts` (edit) + `list-handler.ts` (edit)
- `packages/mcp/src/tools/delete-entities-handler.test.ts` (NEW)

#### Deep file dependency analysis
Depende de T2.4a (`forgetEntity`). O handler resolve o Principal, passa o filtro `(workspace,user)` CONFIRMADO para `forgetEntity` — o argumento nunca vem do cliente sem o Principal por cima.

#### Why this step
**Ação:** expor `delete_entities` no MCP sobre o primitivo `forgetEntity`.
**Razão:** ADR-M14-2 — a tool que o owner reafirmou; entra com a guarda, não sem ela.

#### TDD
- RED: test_delete_entities_scoped_to_principal() — deleta só do `(workspace,user)` do Principal.
- RED: test_delete_entities_cross_user_denied() (ISOLAMENTO) — arg de outro user não deleta nada dele.
- RED: test_delete_entities_aborts_on_missing_scope() (GUARDA #252) — sem escopo confirmado → aborta.
- GREEN: implementar.

#### Concurrency tests
(delegado a T2.4a — a atomicidade está no core.)

#### Failure scenarios
- Escopo não-confirmado → erro tipado, zero deleção (herda de T2.4a).

#### Acceptance criteria
`npm test -w packages/mcp` + `npm run test:integration` passam: `delete_entities` remove só do Principal; arg de outro user deixa as linhas dele com `t_invalid` NULL (assert); escopo não-confirmado lança erro tipado e afeta `0` linhas.

#### DoD
`npm test -w packages/mcp` + `npm run test:integration` verdes; typecheck limpo.

## Phase 3: Tool-context + guarda anti-escrita

### T3.1 — PostToolUse Bash: erro-context

#### Files to edit
- `docs/claude-code-kit/hooks/theo-tool-context.mjs` (NEW, < 90 LoC)
- `docs/claude-code-kit/hooks/merge-settings.mjs` (edit — registrar PostToolUse Bash)
- `docs/claude-code-kit/hooks/theo-tool-context.test.mjs` (NEW)

#### Deep file dependency analysis
Espelha `on_bash_output.sh`: detecta erro no output do comando (Traceback/panic/Error×2), busca `/v1/recall` com a linha de erro como query, injeta via `PostToolUse.additionalContext`. Skip git commit/merge + output < 50 chars. Scope do Principal.

#### Why this step
**Ação:** hook que traz a memória do bug quando ele reaparece.
**Razão:** blueprint T4 — a superfície de maior valor do tool-context (o erro que já vimos antes).

#### TDD
- RED: test_detects_traceback_and_searches() — output com Traceback → `/v1/recall` com a linha de erro.
- RED: test_skips_short_output() — < 50 chars → sem busca.
- RED: test_skips_git_commit() — comando git commit → sem busca.
- GREEN: implementar.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`node --test theo-tool-context.test.mjs` passa: output com `Traceback` → `post('/v1/recall', ...)` chamado com a linha de erro como `query`; output < 50 chars → `post` chamado `0` vezes; comando `git commit` → `post` chamado `0` vezes.

#### DoD
`node --test` verde; lint limpo.

### T3.2 — Guarda anti-escrita em MEMORY.md

#### Files to edit
- `docs/claude-code-kit/hooks/theo-block-memory-write.mjs` (NEW, < 40 LoC)
- `docs/claude-code-kit/hooks/merge-settings.mjs` (edit — registrar PreToolUse Write|Edit)
- `docs/claude-code-kit/hooks/theo-block-memory-write.test.mjs` (NEW)

#### Deep file dependency analysis
Espelha `block_memory_write.sh:28-32`: PreToolUse matcher Write|Edit, `case` sobre `file_path` — path de MEMORY.md → exit 2 (block) com stderr redirecionando ao nosso `remember`/MCP.

#### Why this step
**Ação:** bloquear escrita direta em MEMORY.md, redirecionando ao remember.
**Razão:** blueprint T5 — evita memória fora do sistema (arquivo local invisível ao recall).

#### TDD
- RED: test_blocks_memory_md_write() — path `*/MEMORY.md` → exit 2 + stderr.
- RED: test_allows_other_writes() — path normal → exit 0.
- GREEN: implementar.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`node --test theo-block-memory-write.test.mjs` passa: path `*/MEMORY.md` → processo retorna exit code `2` e stderr contém a mensagem de redirecionamento; path normal → exit code `0`.

#### DoD
`node --test` verde; lint limpo.

## Phase 4: Wizard de onboarding idempotente

### T4.1 — /onboard: detecta CLAUDE.md/AGENTS.md e importa, idempotente

#### Files to edit
- `docs/claude-code-kit/hooks/theo-onboard.mjs` (NEW, < 120 LoC) OU um subcomando reusando o import do M12
- `docs/claude-code-kit/hooks/theo-onboard.test.mjs` (NEW)

#### Deep file dependency analysis
Reusa a lógica de import do M12 (`themory import claude-code`). Alvos: `CLAUDE.md`, `AGENTS.md` no cwd. Idempotência por hash de conteúdo (padrão `auto_import.py:124,313` do mem0): re-rodar não duplica. Scope `(workspace,user)` do Principal.

#### Why this step
**Ação:** wizard que importa o contexto do projeto como memórias de perfil, uma vez.
**Razão:** blueprint Q7/Corner3 — paridade com o `/onboard` do mem0; reusa o import shipado do M12.

#### TDD
- RED: test_onboard_imports_claude_md() — CLAUDE.md presente → importado como memória.
- RED: test_onboard_idempotent() — 2ª execução com conteúdo igual → não duplica (hash).
- RED: test_onboard_scoped_to_principal() (ISOLAMENTO) — importa no `(workspace,user)` do Principal.
- GREEN: implementar.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`node --test theo-onboard.test.mjs` passa: `CLAUDE.md` presente → `post('/v1/remember', ...)` chamado 1 vez; 2ª execução com conteúdo idêntico → `post` chamado `0` vezes (assert de idempotência por hash).

#### DoD
`node --test` verde; lint limpo.

### T4.2 — Manifesto de distribuição (marketplace)

#### Files to edit
- `docs/claude-code-kit/` — manifesto de plugin/marketplace (formato per `plugin.json` + `marketplace.json` do mem0)
- `docs/claude-code-kit/README.md` (edit — documentar os hooks novos + /onboard)

#### Deep file dependency analysis
Espelha `plugin.json` + `.claude-plugin/marketplace.json` do mem0. Declara os hooks + o comando /onboard.

#### Why this step
**Ação:** empacotar o kit para distribuição via marketplace.
**Razão:** blueprint Corner1/Q8 — a paridade inclui a distribuição, não só os hooks.

#### TDD
- RED: test_manifest_lists_all_hooks() — o manifesto declara os 4 hooks novos + os 4 existentes.
- GREEN: escrever o manifesto.

#### Concurrency tests
(none — single-threaded)

#### Acceptance criteria
`node --test` do manifesto passa: o parse do manifesto retorna os `8` hooks (4 novos + 4 existentes) na lista; `grep -c '/onboard' README.md` retorna `>= 1`.

#### DoD
Manifesto parseável; README menciona /onboard + recall por-prompt.

## Coverage Matrix

| Requisito (DoD do ROADMAP M14) | Task(s) |
|---|---|
| Bullet 1: UserPromptSubmit recall pelo PROMPT, scoped, skip curtos | T1.1, T1.3 |
| Bullet 2: attributed_to por origem de hook | T1.2 |
| Bullet 3: PreToolUse/PostToolUse tool-context | T3.1 (+ guarda T3.2) |
| Bullet 4: wizard /onboard idempotente + guarda MEMORY.md + marketplace | T3.2, T4.1, T4.2 |
| Bullet 5: 4 tools MCP (list_entities, get_memory, update_memory, delete_entities) | T2.1, T2.2, T2.3, T2.4a, T2.4b |
| Bullet 6: teste de isolamento cross-tenant E cross-user | Fase 5 (+ testes de isolamento em T2.1/2.2/2.3/2.4b/4.1) |
| Benchmark (goal): redução dos 79% não-lidos | Fase 5 |
| Contrato ADR-0003 (update via forget+remember) | T2.3 |
| Contrato #252 (delete com fail-closed) | T2.4a, T2.4b |

100% dos requisitos mapeados.

## Global Definition of Done

- Todas as tasks com TDD verde (RED antes de GREEN).
- `npm run typecheck` zero erros; `npm run lint` zero warnings.
- `npm test` + `npm run test:integration` (contra `ankane/pgvector:v0.5.1`) verdes.
- Cada arquivo novo < 500 LoC (`architecture.md`); handlers MCP < 100 LoC.
- CHANGELOG `[Unreleased]` atualizado (Unbreakable Rule 6).
- Wiring triad por feature: caller (hook registrado / tool no dispatch) + teste de integração + observabilidade (evento/log).
- Fase 5 (Integration Validation) passa.

## Failure scenarios (external I/O touched)

O plano toca I/O externo (recall HTTP via `/v1/recall`; MCP tools contra o core/DB). Cenários obrigatórios:

- **Recall HTTP timeout/5xx** (T1.1, T3.1): o hook injeta stdout vazio e exit 0 — nunca bloqueia o turno. Teste: mock `post` que rejeita/timeout → stdout vazio.
- **DB indisponível no `forgetEntity`** (T2.4a): erro tipado propagado, ZERO deleção parcial (CTE atômica). Teste: pool que falha mid-tx → rollback, sem edges órfãos.
- **`forget` de id inexistente no update_memory** (T2.3): erro tipado, `remember` não executa (sem órfão).

## Final Phase: Integration Validation (MANDATORY)

### Execution
1. `npm run typecheck && npm run lint`
2. `npm test` (unit — todos os hooks + handlers)
3. `npm run test:integration` (contra `ankane/pgvector:v0.5.1`) — inclui `tests/integration/kit-recall-parity/isolation.test.ts`:
   - Cria 2 workspaces (A, B) + 2 users no A (X, Y).
   - Para CADA superfície nova (recall, get_memory, list_entities, update_memory, delete_entities, onboard): prova que `(A,X)` não lê/deleta dado de `(B)` nem de `(A,Y)`.
   - Prova o cenário #252: `delete_entities` sem escopo confirmado → aborta.
4. **Benchmark do goal:** rodar a query `SELECT count(*) FILTER (WHERE last_accessed_at IS NULL)::float / count(*) FROM memories WHERE workspace_id=$ws AND t_invalid IS NULL` antes/depois de uma janela de uso do recall por-prompt; registrar a redução no relatório de implementação.

### Acceptance Criteria
- `npm run test:integration -- isolation` retorna exit `0` com `N/N` casos verdes (o gate do DoD bullet 6 — cross-tenant + cross-user).
- `npm test && npm run typecheck && npm run lint` retornam exit `0` (suite completa + tipos + lint limpos).
- O relatório de implementação registra a fração `last_accessed_at IS NULL` medida via `psql` antes/depois (número real, não estimativa).

### If Validation Fails
Loop de volta à task da superfície que vazou; NUNCA relaxar o teste de isolamento. Um vazamento cross-tenant é BLOQUEADOR, não caveat.
