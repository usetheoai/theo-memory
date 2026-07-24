# Blueprint: Paridade de recall do kit Claude Code (leitura contínua + autoria + 9 tools MCP), multi-tenant

> **Version 1.0** — Sintetiza como o `mem0-plugin` (`.claude/knowledge-base/references/mem0/integrations/mem0-plugin/`) implementa recall CONTÍNUO, separação de autoria, as 9 tools MCP e o onboarding — e traduz cada superfície para o nosso stack TS multi-tenant `(workspace, user, session-opcional)`. O insight central: **o mem0 é single-tenant e injeta identidade NO CLIENTE (hook); nós somos multi-tenant e a identidade DEVE vir do Principal NO SERVIDOR** — copiar a injeção client-side seria IDOR cross-tenant. Informa as decisões de implementação do M14.

**Slug:** `claude-code-kit-recall-parity`
**Source plan:** `.claude/knowledge-base/discoveries/plans/claude-code-kit-recall-parity-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-07-24 via `/discover-execute` (execução direta dentro do goal-loop; ralph-loop não aninhado por anti-pattern de Stop-hook concorrente)
**Confidence verdict:** _(preenchido por /discover-confidence)_

## Context

Kit atual (`docs/claude-code-kit/`) registra 4 hooks, 3 de escrita; 79% das 2.520 memórias vivas nunca lidas (medição live 2026-07-24). O único recall (`docs/claude-code-kit/hooks/theo-recall.mjs:26-30`) busca por `query: project` (constante), 1×/sessão, `topK:5`. M14 fecha o gap de leitura nas duas superfícies (hooks + MCP), preservando o isolamento `(workspace,user)` de ADR-0021.

## Objective

Decidir, por superfície, O QUE construir no nosso stack TS reusando primitivos shipados, reconciliando com contratos locked (ADR-0003 ADD-only; guarda fail-closed #252; M8 isolamento).

---

## Coverage Corner 1 — Integration Tests

### mem0-plugin — como os hooks são registrados e a distribuição é declarada (Q8)

O `hooks.json` mapeia 7 hooks em 5 eventos (`integrations/mem0-plugin/hooks.json:2-104`):

| Evento | matcher | script | timeout | papel |
|---|---|---|---|---|
| SessionStart | `*` | `ensure_deps.sh` + `on_session_start.sh` | 60s | setup deps + banner (`hooks.json:3-20`) |
| **UserPromptSubmit** | (todos) | `on_user_prompt.sh` | **8s** | **recall por-prompt** (`hooks.json:21-32`) |
| PreToolUse | `Write\|Edit\|MultiEdit` | `block_memory_write.sh` | — | guarda MEMORY.md (`hooks.json:35-43`) |
| PreToolUse | `mcp__mem0__.*` | `enforce_metadata_defaults.sh` | 3s | injeção de identidade (`hooks.json:44-54`) |
| PreToolUse | `Read` | `on_file_read.sh` | 5s | contexto por arquivo (`hooks.json:55-65`) |
| Stop | (todos) | `on_stop.sh` | 30s | resumo de sessão (`hooks.json:67-78`) |
| PostToolUse | `Bash` | `on_bash_output.sh` | 5s | contexto por erro (`hooks.json:91-101`) |

**Timeouts explícitos por hook** (`hooks.json:28,51,63,74,98`) — a rede de segurança de latência: o UserPromptSubmit tem 8s de teto, e todo hook usa `2>/dev/null || true` para nunca bloquear o turno.

Distribuição via marketplace: `integrations/mem0-plugin/plugin.json` (manifesto) + `.claude-plugin/marketplace.json` (registro).

**Delta vs nosso kit:** nosso `docs/claude-code-kit/hooks/merge-settings.mjs:92-122` registra 4 hooks (SessionStart/Stop/PreCompact/SessionEnd) — TODOS de escrita exceto o SessionStart. **Faltam: UserPromptSubmit (recall por-prompt), PreToolUse×3 (guarda + tool-context), PostToolUse (erro-context).** O `merge-settings.mjs` já é idempotente (`alreadyPresent()`, linha 39) — a estrutura de registro existe; só faltam as entradas de leitura.

**Teste de isolamento (o gate do DoD bullet 6):** o mem0 NÃO tem teste de isolamento cross-tenant (é single-tenant — só existe o `MEM0_API_KEY` do dono). Nós PRECISAMOS dele — precedente em M8. Não há o que emprestar aqui; é obrigação nossa.

---

## Coverage Corner 2 — Dependencies

### mem0-plugin — as 9 tools MCP e como a identidade viaja (Q6)

As 9 tools (fonte autoritativa: `integrations/mem0-plugin/README.md:268-278` + confirmado em `.claude/knowledge-base/references/mem0/CLAUDE.md` § MCP Integration):

| # | Tool mem0 | Descrição (README:270-278) | Temos? | Nosso equivalente |
|---|---|---|---|---|
| 1 | `add_memory` | save text/conversation | ✅ | `remember` (`packages/mcp/src/tools/remember-handler.ts`) + `add_memories` |
| 2 | `search_memories` | semantic search + filters | ✅ | `recall` (`packages/mcp/src/tools/recall-handler.ts`) + `search_memory` |
| 3 | `get_memories` | list + pagination | ✅ | `list` (`packages/mcp/src/tools/list-handler.ts`) |
| 4 | `get_memory` | retrieve by ID | ❌ | **FALTA** — mas `MemoryStore.get(memoryId)` shipado (`packages/core/src/domain/memory-store.ts:60`) |
| 5 | `update_memory` | overwrite by ID | ❌ | **FALTA** — via `forget+remember` (ADR-0003) |
| 6 | `delete_memory` | delete single | ✅ | `forget` (`packages/mcp/src/tools/forget-handler.ts`) |
| 7 | `delete_all_memories` | bulk delete in scope | ✅ | `delete_memories` (openmemory-compat) |
| 8 | `delete_entities` | delete entity + memories | ❌ | **FALTA** — primitivo novo + guarda fail-closed |
| 9 | `list_entities` | list users/agents/apps/runs | ❌ | **FALTA** — reusa handler REST `/entities` |

**Como a identidade viaja no mem0 (o ponto crítico de segurança):** o `enforce_metadata_defaults.sh` é um **PreToolUse hook que injeta `user_id`/`app_id` NO CLIENTE**, via `hookSpecificOutput.updatedInput` (`enforce_metadata_defaults.sh:14-16, 197-205`). Para `add_memory`/`delete_all` injeta top-level (`:66-75`); para `search`/`get` injeta em `filters.AND[]` (`:78-135`). A auth do server é `Token ${MEM0_API_KEY}` no header (`.mcp.json:6`).

**Reconciliação multi-tenant (a decisão que define M14):** esse padrão é **INACEITÁVEL** no nosso modelo. Injetar identidade do lado do cliente/hook significa que o `user_id` viaja como argumento — e num contexto multi-tenant o argumento é controlado pelo agente, logo seria IDOR cross-tenant. **Nós fazemos o oposto: a identidade `(workspace,user)` vem do Principal NO SERVIDOR** (credencial via ForwardAuth + `AsyncLocalStorage`, precedente `packages/api/src/server/handlers/_body-parsing.ts:79-81 actingUserId`), e o argumento `user_id` de qualquer tool é IGNORADO. O mem0 mistura sessão em `metadata.session_id` porque `run_id` cria partição invisível no v3 (`enforce_metadata_defaults.sh:160-176`) — nós já resolvemos isso com o M10 (session-optional, global ∪ session).

**Deps novas:** ZERO. As 4 tools faltantes reusam primitivos shipados (`MemoryStore.get`, handler REST `/entities`, `forget`+`remember`). `delete_entities` precisa de um método novo de forget-de-entidade no core — não é dep externa.

---

## Coverage Corner 3 — Tools

### mem0-plugin — wizard de onboarding idempotente (Q7)

`auto_import.py` importa arquivos de contexto do projeto como memórias de perfil. Alvos: `TARGET_FILES = ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".windsurfrules", "mem0.md"]` (`auto_import.py:46`). Idempotência em **três camadas** (edge EC-3: sem transcrever as 374 linhas):

1. **`already_imported()`** (`auto_import.py:124`) — checa se o arquivo já está no mem0 (skip se inalterado, `:319-320`).
2. **Hash de conteúdo** — pula arquivo com conteúdo duplicado de outro já importado (`:313` "Duplicate content, skipping").
3. **Lock de instância** — pula se outra instância de auto_import está rodando (`:366` "Another auto_import instance is running").

`setup_coding_categories.py` instala categorias via `project.update(custom_categories=[...])` — replace-all (README:263).

**Delta vs nós:** não temos wizard de onboarding. Mas o M12 já shipou `themory import claude-code` (migração), então a peça de "ler CLAUDE.md e importar" tem precedente. O wizard M14 é um comando `/onboard` que: (a) detecta `CLAUDE.md`/`AGENTS.md` no cwd, (b) importa como memórias de perfil scoped a `(workspace,user)`, (c) é idempotente via hash — reusando a lógica de import do M12. Categorias de memória são opcionais (nossa taxonomia de entidades M13 já cobre a tipagem).

---

## Coverage Corner 4 — Techniques

### T1 — Recall por-prompt: query do usuário, skip de curtos, timeout (Q1)

O `on_user_prompt.sh` decide QUERY e SKIP assim:

- **Skip de prompts curtos:** `if [ ${#PROMPT} -lt 20 ]; then exit 0` (`on_user_prompt.sh:25`) — não busca para prompts < 20 chars.
- **Query = o PROMPT do usuário:** `MEM0_SEARCH_QUERY="$PROMPT"` (`on_user_prompt.sh:161`) — busca semântica contra o que o usuário digitou (NÃO uma constante). Este é o defeito exato do nosso `theo-recall.mjs:28` (`query: project`).
- **top_k = 5** para prefetch (`on_user_prompt.sh:171`).
- **Timeout:** `SEARCH_TIMEOUT = 5` no `_search.py:14` + teto de hook 8s no `hooks.json:28`. Nunca bloqueia: `set -uo pipefail` sem `-e`, `exit 0` sempre (`on_user_prompt.sh:15,228`).
- **Rerank ON por default** (`_search.py:29-32`) — +150-200ms dentro do budget; a memória mais relevante cai fora do top_k sem rerank.
- **Detecção especial:** resume-intent busca targeted `session_state`+`decision` (`on_user_prompt.sh:120-154`); erro/file-paths ajustam o rubric (`:64-75`).

**Filtro de busca (o ponto multi-tenant):** `{"AND": [{"user_id"}, {"app_id"}]}` (`_search.py:66-73`) — single-tenant (o user é o dono; app é o projeto). Nós substituímos por `(workspace, user)` do Principal + session-optional (M10, `global ∪ session`).

**Decisão de implementação:** novo hook `theo-prompt-recall.mjs` em `UserPromptSubmit` que: query = prompt (não project), skip < N chars, top_k configurável, timeout não-bloqueante (o kit já escreve destacado via `theo-lib postDetached`). Reusa o `/v1/recall` do M10.

### T2 — Injeção no contexto + formato (Q2)

**Canal:** `hookSpecificOutput.additionalContext` com `hookEventName: "UserPromptSubmit"`, emitido como JSON via jq (`on_user_prompt.sh:219-226`). **Idêntico** ao que nosso `theo-recall.mjs:48-55` já faz — o mecanismo de injeção está correto no nosso kit; só o gatilho (SessionStart vs UserPromptSubmit) e a query estão errados.

**Formato:** `- [category] text[:200] [mem0:id[:8]]` sob um heading (`_search.py:96-102`). Nosso `theo-recall.mjs:36-46` já formata como `- text` — podemos enriquecer com type + id, reusando os campos do `MemoryItem`.

### T3 — Autoria por origem de hook (Q3, edge EC-2)

A autoria é **EMERGENTE da origem do hook**, não um campo lido:

- **Lado usuário:** `on_user_prompt.sh:85` detecta "remember this/save this" → o skill `/mem0:remember` grava com `confidence=1.0, infer=False` (verbatim, `on_user_prompt.sh:182`).
- **Lado assistente:** `on_stop.sh:50` → `capture_session_summary.py` com `infer=True` (extração LLM do resumo); **guarda contra subagente:** `if [ -n "$AGENT_ID" ]; then exit 0` (`on_stop.sh:26-29`).
- **Metadata default:** `source=auto_capture, type=task_learning` (`enforce_metadata_defaults.sh:149-153`).

**Insight de reconciliação:** no mem0 single-tenant, TUDO é o mesmo `user_id` (o dono) — a "autoria" é só `metadata.source`, não um peer separado. **Nós temos algo mais forte: `attributed_to` multi-peer real (v1.1, `RememberOptions.attributedTo`).** A regra M14: o hook de origem determina o `attributed_to` — `theo-prompt-recall`/`remember` do usuário → `attributed_to=user`; `theo-remember` (Stop) e `theo-precompact` do assistente → `attributed_to=assistant`. Explícito por hook, nunca inferido. Isso impede que resumos do assistente virem "preferência do usuário" — o problema que o mem0 mitiga com `source` e nós mitigamos com o peer real.

### T4 — Recall contextual em ferramentas (Q4)

- **PreToolUse Read** → `on_file_read.sh`/`file_context.py` (`hooks.json:55-65`): ao abrir um arquivo, busca memórias sobre ele.
- **PostToolUse Bash** → `on_bash_output.sh`: detecta erro no OUTPUT do comando (`on_bash_output.sh:36-40`), extrai a linha de erro + arquivos do stack trace (`:50-53`), busca `anti_pattern`+`bug_fix` (`:88-89`) e injeta via `PostToolUse.additionalContext` (`:116-121`). Skip para git commit/merge (`:28-32`) e output < 50 chars (`:22`).

**Decisão:** replicar ambos como hooks TS, mesmo escopo `(workspace,user)`. O de erro (PostToolUse Bash) é o de maior valor — traz a memória do bug quando ele reaparece. O de arquivo (PreToolUse Read) é secundário; pode entrar como segundo slice se latência preocupar.

### T5 — Guarda anti-escrita em MEMORY.md (Q5)

`block_memory_write.sh` — PreToolUse matcher `Write|Edit`, `case` sobre `file_path`: `*/.claude/*/MEMORY.md|*/.claude/memory/*` → `exit 2` (block) com stderr redirecionando ao `add_memory` (`block_memory_write.sh:28-32`). Contrato: `exit 0`=allow, `exit 2`=block com stderr mostrado ao Claude (`:10-12`).

**Decisão:** hook TS trivial — mesmo `case` sobre o path, `exit 2` redirecionando ao nosso `remember`/MCP. Uma dúzia de linhas.

---

## Cross-cutting Comparison

| Superfície mem0 | Mecanismo mem0 (citação) | Nosso equivalente | Ajuste multi-tenant / contrato |
|---|---|---|---|
| Recall por-prompt | `on_user_prompt.sh:161` query=PROMPT | novo `UserPromptSubmit` hook | scope `(workspace,user)` do Principal + session-opt (M10) |
| Injeção | `on_user_prompt.sh:219` additionalContext | `theo-recall.mjs:48` (já igual) | — (mecanismo já correto) |
| Autoria | `metadata.source` por hook | `attributed_to` multi-peer (v1.1) | peer real > source; por hook de origem |
| Tool-context | `on_bash_output.sh` erro→busca | novo PostToolUse hook | scope idêntico |
| Guarda MEMORY.md | `block_memory_write.sh:31` exit 2 | hook TS trivial | — |
| Identidade nas MCP tools | `enforce_metadata_defaults.sh` CLIENT-side inject | **Principal SERVER-side** | **INVERSÃO — o ponto de segurança** |
| get_memory/list_entities | remoto | `MemoryStore.get` / REST `/entities` | herda Principal |
| update_memory | overwrite by ID | `forget`+`remember` | ADR-0003 ADD-only |
| delete_entities | `delete_all` inject identity | primitivo novo | **guarda fail-closed de filtro (#252)** |
| Onboarding | `auto_import.py:124` idempotente | `/onboard` reusa import M12 | scope `(workspace,user)` |

## ADRs

### D1 — Identidade SEMPRE do Principal no servidor, NUNCA do argumento da tool

**Decisão:** rejeitar o padrão `enforce_metadata_defaults.sh` (injeção client-side). Toda tool MCP e todo hook de recall resolve `(workspace,user)` do Principal (credencial via ForwardAuth + AsyncLocalStorage); o argumento `user_id`/`workspace_id` de qualquer tool é IGNORADO.

**Rationale:** o mem0 é single-tenant — só existe o dono, então injetar no cliente é seguro lá. No nosso multi-tenant, aceitar identidade do argumento é IDOR cross-tenant (o agente controla o argumento). Precedente: M8/ADR-0021, `actingUserId` (`_body-parsing.ts:79`).

**Alternatives considered:** injeção client-side com validação server-side (rejeitado — dupla verdade, o server já tem a verdade); confiar no argumento (rejeitado — IDOR).

**Consequences:** teste de isolamento cross-tenant E cross-user obrigatório (DoD bullet 6). Impossível vazar entre tenants por construção.

### D2 — update_memory via forget+remember; delete_entities com guarda fail-closed

**Decisão:** `update_memory` é a tool com o nome da referência mas implementada como `forget(id)+remember(newText)` (preserva ADR-0003 ADD-only + `history()`). `delete_entities` ganha um primitivo novo de forget-de-entidade no core + guarda fail-closed: aborta se o filtro `(workspace,user)` não for ecoado/confirmado; evento tipado por deleção (Princípio 3); soft-delete via `t_invalid`.

**Rationale:** o mem0 faz UPDATE in-place (`README:274` "Overwrite by ID") e `delete_all` sem guarda robusta. Nossos contratos proíbem ambos: ADR-0003 (ADD-only) e a lição do cascade-delete #252 (filtro descartado → delete em escopo aberto).

**Alternatives considered:** UPDATE in-place (rejeitado — viola ADR-0003); delete_entities sem guarda (rejeitado — repete #252).

## Recommendations for the project

1. **Slice 1 (núcleo, ~80% do valor):** hook `UserPromptSubmit` com recall por-prompt (T1) scoped ao Principal (D1) + `attributed_to` por origem de hook (T3). Fecha os 79% não-lidos.
2. **Slice 2 (MCP):** as 4 tools faltantes — `list_entities` (REST `/entities`), `get_memory` (`MemoryStore.get`), `update_memory` (forget+remember, D2), `delete_entities` (primitivo novo + guarda fail-closed, D2). Todas herdando Principal (D1).
3. **Slice 3 (contexto + guarda):** PostToolUse Bash erro-context (T4) + guarda MEMORY.md (T5).
4. **Slice 4 (onboarding):** `/onboard` idempotente reusando import do M12 + registro no marketplace.
5. **Gate transversal:** teste de isolamento cross-tenant E cross-user cobrindo TODAS as superfícies (DoD bullet 6) — a única coisa que o mem0 não tem para emprestar, porque é single-tenant.

## Blocked questions (if any)

Nenhuma. As 8 questões respondidas com citação verificável.

## Halt-loop progress (audit trail)

Execução direta dentro do goal-loop (decisão de engine: ralph-loop aninhado seria Stop-hook concorrente, anti-pattern `loop-engine-convention.md`). 8/8 questões `done`, 0 `blocked`. Iterações: 1 pass (leitura em lote). Citações: 8 arquivos-fonte + README + CLAUDE.md do mem0, todas verificadas via Read.

## Related

- Source plan: `.claude/knowledge-base/discoveries/plans/claude-code-kit-recall-parity-plan.md`
- Edge cases: `.claude/knowledge-base/reviews/claude-code-kit-recall-parity-edge-cases-2026-07-24.md`
- Kit atual: `docs/claude-code-kit/`
- Downstream: `/discover-confidence claude-code-kit-recall-parity` → depois `/to-plan`
