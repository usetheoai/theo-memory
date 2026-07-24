# Edge Case Review — claude-code-kit-recall-parity

Date: 2026-07-24
Tasks analyzed: 12 (T1.1–T4.2)
Cases found: 5 (EDGE: 2, NEGATIVE: 3 | MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: update_memory na ordem `forget→remember` PERDE dado se o remember falhar

- **Affected task:** T2.3
- **Kind:** NEGATIVE (falha parcial mid-operation)
- **Family:** State
- **Scenario:** o plano (linha 290, 297) especifica `forget(oldId)` **então** `remember(newText)`. Se o `remember` falhar (rede/timeout/erro de extração — I/O externo real), a memória antiga já foi soft-deletada (`t_invalid` setado) e a nova NÃO foi criada. Resultado: o "update" apagou o conteúdo do usuário sem substituí-lo. `history()` preserva o antigo mas o estado VIVO ficou vazio.
- **Impact:** perda de dado visível — o agente pediu "update" e a memória sumiu do recall.
- **Suggested fix:** inverter a ordem — `remember(newText)` PRIMEIRO; só após o sucesso, `forget(oldId)`. Se o remember falhar, o forget NÃO executa e o dado antigo continua vivo (degrada para no-op, não para perda). Ajustar T2.3 TDD: `test_update_remembers_before_forgets` + `test_update_keeps_old_when_remember_fails` (NEGATIVE — remember rejeita → oldId ainda vivo, erro tipado propagado).

### EC-2: recall por-prompt sem `THEOMEM_MEMORY_TOKEN` — degradar explicitamente

- **Affected task:** T1.1, T3.1
- **Kind:** NEGATIVE (credencial ausente)
- **Family:** Permission / Input
- **Scenario:** `loadEnv()` (`theo-lib.mjs:61`) retorna `token: null` quando `~/.claude/theo-memory.env` não tem `THEOMEM_MEMORY_TOKEN`. Sem token, o `/v1/recall` não resolve o Principal `(workspace,user)` — e a invariante do milestone é que a identidade vem do Principal. Um recall sem token OU falha (bom) OU — pior — cai num escopo default sem workspace.
- **Impact:** se o servidor tratar token-ausente como escopo aberto, o recall por-prompt vaza. Se falhar, o hook precisa degradar silencioso (exit 0).
- **Suggested fix:** T1.1 deve pular o recall quando `loadEnv().token == null` (sem token → sem recall, exit 0) — não confiar que o servidor recuse. Adicionar `test_skips_recall_without_token` (NEGATIVE): token null → `post` NÃO chamado, stdout vazio. Isso é defesa em profundidade da invariante ADR-M14-1.

## SHOULD TEST

### EC-3: update_memory retorna um id NOVO (contrato diverge do mem0)

- **Affected task:** T2.3
- **Kind:** EDGE (extremo de contrato válido)
- **Suggested test:** `test_update_returns_new_id_not_old` — asserir que o `CallToolResult` do `update_memory` expõe o id NOVO (de `remember`), não o antigo. O mem0 faz "overwrite by ID" (id preservado); nós fazemos forget+remember (id muda). Um agente que guardou o oldId e depois chama `get_memory(oldId)` recebe null. O retorno DEVE deixar o novo id explícito para o agente reancorar. Assert: resultado contém o novo id, e a descrição do schema documenta a divergência.

### EC-4: recall por-prompt com prompt exatamente = 20 chars (boundary do skip)

- **Affected task:** T1.1
- **Kind:** EDGE (limite exato)
- **Suggested test:** `test_recall_at_exact_skip_boundary` — o plano diz "pula < 20 chars". Assertar o comportamento em EXATAMENTE 20 (mem0 usa `< 20` → 20 NÃO pula, `on_user_prompt.sh:25`). Fixar a régua (`< N` vs `<= N`) com um teste, para não virar off-by-one silencioso.

## DOCUMENT

### EC-5: delete_entities é destrutivo mesmo com soft-delete — sem confirmação do agente

- **Affected task:** T2.4b
- **Kind:** NEGATIVE (operação destrutiva)
- **Accepted risk:** `delete_entities` faz soft-delete (`t_invalid`, recuperável) com guarda fail-closed de escopo (T2.4a). Um agente pode deletar entidades legítimas por engano, mas: (a) é soft-delete (recuperável via `history`/bi-temporal), (b) scoped ao Principal (não vaza), (c) a guarda #252 impede delete em escopo aberto. Adicionar confirmação interativa contradiz o modelo agente-autônomo (o agente É quem cura). Risco aceito: soft-delete + scope + guarda são a rede suficiente; confirmação humana é fora do escopo (o agente opera sem humano no loop).

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 | 1 | 1 (EC-2) | 1 (EC-4) | 0 |
| T2.3 | 1 | 1 | 1 (EC-1) | 1 (EC-3) | 0 |
| T2.4b | 0 | 1 | 0 | 0 | 1 (EC-5) |
| T3.1 | 0 | 1 | (EC-2 compart.) | 0 | 0 |

**Coverage check:** os boundaries de I/O (recall HTTP, forget+remember, delete) têm EDGE e NEGATIVE considerados. As tools de leitura pura (get_memory, list_entities) já têm o teste de isolamento no plano — sem edge adicional relevante.

**Verdict:** PLAN NEEDS ADJUSTMENT (2 MUST FIX: EC-1 ordem forget+remember = perda de dado; EC-2 token-ausente = defesa da invariante. Ambos corrigíveis com 1 ajuste de ordem + 1 guard, e cada um vira 1-2 testes.)
