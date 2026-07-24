---
slug: claude-code-kit-recall-parity
generated_by: roadmap-feature
milestone_id: M14
date: 2026-07-24
status: completed
out_of_scope_overlap_false_positive: "Wrapping X as a backend or data-adapter — este milestone é interop de SUPERFÍCIE (hooks/MCP tool-shape do Claude Code), NÃO um data-adapter de vendor. Mesmo raciocínio que liberou M12 (import claude-code) e o OpenMemory-compat (Item 26): mapeia nomes de tool/eventos de ciclo de vida sobre nossos verbos existentes; zero dependência de SDK de vendor, zero backend de terceiro. O cut de 2026-05-21 continua valendo para data-adapters reais."
---

# Grill — M14: Claude Code kit recall parity

## Contexto capturado (das mensagens do owner, 2026-07-24)

O owner enviou a doc do plugin de memória do Claude Code do concorrente e pediu **a mesma
experiência**, "sem mencioná-lo", **no nosso modelo `(workspace, user, session — opcional)`**.

### Diagnóstico que motivou o milestone (medido, não estimado)

Base live `tn-f50e039ca488a1bc`:

| Métrica | Valor |
|---|---|
| Memórias vivas | 2.520 |
| Escritas nas últimas 24h | 1.804 |
| **Nunca lidas (`last_accessed_at IS NULL`)** | **1.990 (79%)** |

O kit atual (`docs/claude-code-kit/`) registra 4 hooks — SessionStart (recall), Stop
(remember), PreCompact, SessionEnd (promote). **Três dos quatro são ESCRITA.** O único de
leitura (`theo-recall.mjs`) tem três defeitos:

1. Dispara só uma vez, no SessionStart.
2. A query é o NOME DO PROJETO (`query: project`), não o prompt do usuário — busca semântica
   contra a string constante `"theo-memory"` toda sessão.
3. `topK: 5` — 5 de 2.520.

Segundo achado: o kit NÃO distingue autoria (`grep attributedTo` nos hooks → nada). O que o
usuário digita e o que o assistente produz (resumos de sessão/compactação) entram
indistinguíveis; com o tempo, sugestões do assistente viram "preferências do usuário".

### Invariante NÃO-NEGOCIÁVEL (owner, explícita 2×)

Toda superfície nova preserva o isolamento multi-tenant `(workspace, user, session-opcional)`
de ADR-0021 / M8:

- `workspace` — SEMPRE da credencial (ForwardAuth), JAMAIS do body.
- `user` — SEMPRE do Principal (auth-trusted `X-Theo-User-Id`), JAMAIS do body.
- `session` — OPCIONAL, do payload do hook (`session_id` do Claude Code).
- `remember`: grava em `(workspace, user)`; se session presente, tagueia session_id.
- `recall`: `(workspace, user)` global ∪ sessão atual (quando presente) — já é o comportamento
  do M10 (scope-aware recall).
- **Prova obrigatória:** teste de isolamento cross-tenant E cross-user, como o M8 fez.

Tese do produto: clientes criam agentes que têm memória SEPARADA por cliente-final deles.
Copiar o recall do concorrente cego (single-tenant, `user_id` do body) vazaria memória entre
tenants/usuários e destruiria a tese.

## Q1 — O que é a feature e por que AGORA?

**Resposta:** Paridade de experiência com o plugin de memória de referência do Claude Code,
adaptada ao modelo multi-tenant. Escopo escolhido pelo owner: **paridade TOTAL** — recall por
prompt (UserPromptSubmit) + autoria (`attributed_to`) + recall contextual em ferramentas
(PreToolUse/PostToolUse) + wizard de onboarding idempotente + guarda anti-escrita em MEMORY.md
+ distribuição via marketplace de plugin.

**Por que agora:** o sistema ESCREVE (1.804/24h) e não LÊ (79% nunca lido) — o produto grava
memória que nunca volta ao agente. É o gap que anula o valor do que já shipamos (M9–M13).

## Q2 — Dependências (quais milestones `[x]` são pré-requisito)?

**Resposta (owner):** **M8 + M10 + M12.** M8 (isolamento `(workspace,user)` — a invariante),
M10 (scope-aware recall global ∪ session — o motor do recall por prompt), M12 (o kit + skill do
Claude Code que estamos estendendo). M9 e M11 NÃO são pré-requisito técnico do recall/autoria.

## Q2.5 — Autoria (attributed_to)

**Resposta (owner):** o que o usuário digita → `attributed_to=user`; resumos de
sessão/compactação (produzidos pelo assistente) → `attributed_to=assistant`. Explícito por
ORIGEM DE HOOK, nunca inferido. Reusa o `attributed_to` da v1.1 (já shipado).

## Q3 — Definition of Done verificável

**Resposta (owner) — 5 bullets:**

1. Hook `UserPromptSubmit` faz recall pelo **PROMPT** do usuário (não pelo nome do projeto),
   scoped a `(workspace, user, session-opcional)`; pula prompts curtos.
2. `attributed_to` separa user-prompt (=user) de resumos do assistente (=assistant), por origem
   de hook.
3. `PreToolUse`/`PostToolUse` trazem memórias contextuais (por arquivo aberto / por erro de
   comando).
4. Wizard `/onboard` idempotente + guarda anti-escrita em `MEMORY.md` + distribuição via
   marketplace de plugin.
5. **Paridade de superfície MCP** (owner, follow-up 2026-07-24): `list_entities` (reusa handler
   REST `/entities`) + `get_memory` por ID (reusa `MemoryStore.get`, já shipado), herdando o
   Principal `(workspace,user)`. **Ladder aplicada:** `update_memory` FORA (ADR-0003 ADD-only);
   `delete_entities` FORA (sem primitivo de forget-de-entidade no core — só `supersedeEntity` que
   re-tipa; e toca a classe de bug do cascade-delete #252 → milestone próprio).
6. **Teste de isolamento cross-tenant E cross-user PASSA** (como o M8 fez) — a prova de que o
   recall/autoria/list_entities/get_memory não vaza entre tenants nem entre end-users.

## Q4 — Top 2 riscos NOVOS

**Resposta (owner):**

- **R1 — Vazamento cross-tenant/cross-user.** Um recall por prompt que pegue `user_id` do body
  (como o concorrente single-tenant faz) vazaria memória entre tenants/usuários.
  *Mitigação:* `workspace` da credencial, `user` do Principal, `session` opcional do payload —
  jamais do body; teste de isolamento no DoD (bullet 5).
- **R2 — Latência por prompt.** 1 recall por mensagem adiciona latência ao turno.
  *Mitigação:* pular prompts curtos + timeout não-bloqueante (o kit já escreve destacado via
  `theo-lib postDetached`).
