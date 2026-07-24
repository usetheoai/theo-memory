# Implementation — claude-code-kit-recall-parity (M14)

## Estado: 4/12 tasks committed (Fase 1 completa + T2.1)

| Task | Status | Commit |
|---|---|---|
| T1.1 recall por-prompt | committed | 8d5eb5f |
| T1.3 registro UserPromptSubmit | committed | 8ca37d1 |
| T1.2 attributed_to (Stop=assistant) | committed | 33a8e27 |
| T2.1 get_memory | committed | 317656f |
| T2.2 list_entities | **pending** | — |
| T2.3 update_memory | pending | — |
| T2.4a forgetEntity (core) | pending | — |
| T2.4b delete_entities | pending | — |
| T3.1 tool-context, T3.2 guarda MEMORY.md | pending | — |
| T4.1 onboard, T4.2 marketplace | pending | — |

## Wiring mapeado para T2.2 (list_entities) — 5 pontos

1. `packages/mcp/src/run-mcp-server.ts:262` tem o `pool`; construir `new PgMemoryEntityStore(pool)` e passar como option em `:344` (junto com recallTraceStore).
2. `packages/mcp/src/server.ts:109-138`: adicionar `memoryEntityStore` a McpServerOptions + espalhar ao dispatch (linhas 135/138).
3. `packages/mcp/src/tools/dispatch.ts:30,60`: adicionar `memoryEntityStore?: MemoryEntityStore` ao deps type + passar ao handler.
4. NEW `list-entities-handler.ts` + `-schema.ts`: usar `getScope()` para o workspaceId + `memoryEntityStore.list({ workspaceId, filters })`. filters do scope, NÃO do arg (ADR-M14-1). Espelhar `filtersFor` de `entities.ts:58`.
5. NEW `list-entities-handler.test.ts` (vitest, padrão withScope) — isolamento cross-user.
6. list-handler.ts: registrar as 4 tools novas EM LOTE no fim da Fase 2 + ajustar o count-test (9→13).

## Invariante em TODAS as tools (ADR-M14-1)
Identidade `(workspace,user)` do Principal via `getScope()`/`workspaceScopedMemory`, NUNCA do argumento. Schema `.strict()` rejeita args de identidade. Provado por teste de isolamento cross-user por tool + o `isolation.test.ts` da Fase 5.

## T2.3 (update_memory): EC-1 CRÍTICO
Ordem `remember(newText)` ANTES de `forget(oldId)`. Se remember falha, forget NÃO executa (degrada para no-op, nunca perda de dado). Retorno expõe o id NOVO.

## T2.4a (forgetEntity): guarda fail-closed #252
Novo método na DIP `MemoryEntityStore`; soft-delete via t_invalid; ABORTA (EntityForgetScopeError) se filtro de escopo não confirmado; CTE atômica (não hops de pool).
