# Discovery Plan: Paridade de recall do kit Claude Code (leitura contínua + autoria + 9 tools MCP), multi-tenant

> **Version 1.1** (edge-cases EC-1, EC-2, EC-3 absorvidos 2026-07-24) — Investiga como o plugin de memória de referência para o Claude Code (clonado em `.claude/knowledge-base/references/mem0/integrations/mem0-plugin/`) implementa recall CONTÍNUO (por-prompt + contextual em ferramentas), separação de autoria, as 9 tools MCP, e o wizard de onboarding — para produzir um blueprint que diga COMO adaptar cada superfície ao nosso modelo multi-tenant `(workspace, user, session-opcional)` SEM copiar um plugin single-tenant. Escopo: só o `mem0-plugin`. Saída esperada: blueprint com decisão concreta por questão + tabela de reconciliação com nossos contratos locked (ADR-0003 ADD-only; guarda fail-closed #252; M8 isolamento).

**Slug:** `claude-code-kit-recall-parity`
**Owner:** paulohenriquevn
**Created:** 2026-07-24
**Time budget:** 4h (breakdown em ADR D1)

## Context

O que motiva AGORA (evidência medida, não estimada): o kit atual em `docs/claude-code-kit/` registra 4 hooks e **3 são ESCRITA**. Medição na base live `tn-f50e039ca488a1bc` (2026-07-24): 2.520 memórias vivas, 1.804 escritas nas últimas 24h, mas **1.990 (79%) nunca foram lidas** (`last_accessed_at IS NULL`). O único hook de leitura (`docs/claude-code-kit/hooks/theo-recall.mjs`) busca pelo NOME DO PROJETO (constante `query: project`), uma vez por sessão, `topK:5`. O sistema escreve memória que nunca volta ao agente — anula o valor de M9–M13.

O ROADMAP M14 (linha `## M14 — [ ]` em `ROADMAP.md`) define o objetivo e a invariante NÃO-NEGOCIÁVEL: toda superfície nova preserva o isolamento `(workspace, user, session-opcional)` de `.claude/knowledge-base/adrs/ADR-0021-m8-boundary-enforced-user-isolation.md` — `workspace` da credencial, `user` do Principal, JAMAIS do body. Restrições de contrato: `.claude/knowledge-base/adrs/ADR-0003-add-only-public-api.md` (mutação = forget+remember) e a lição do cascade-delete (guarda fail-closed de filtro). As convenções que qualquer padrão emprestado deve respeitar estão em `.claude/rules/architecture.md` (fronteiras/DIP), `.claude/rules/testing.md` (pirâmide + isolamento cross-tenant provado como o M8 fez) e `.claude/rules/error-handling.md` (fail-fast, typed errors — base da guarda fail-closed).

## Objective

Uma frase: o blueprint deve permitir DECIDIR, para cada uma das 5 superfícies (recall por-prompt, autoria, tool-context, 9 tools MCP, onboarding), COMO implementá-la no nosso stack TS multi-tenant, reusando primitivos já shipados e reconciliando com contratos locked — sem copiar cego do plugin single-tenant.

Critérios de sucesso mensuráveis do blueprint:

- [ ] Todas as 8 questões respondidas com citação a `.claude/knowledge-base/references/mem0/`
- [ ] Tabela de reconciliação populada: cada superfície mem0 → nosso equivalente TS + o ajuste multi-tenant/contrato
- [ ] Ao menos 1 proposta de decisão concreta por questão (o QUE construir, reusando qual primitivo)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `integrations/mem0-plugin/scripts/`, `integrations/mem0-plugin/*.json`, `.claude-plugin/marketplace.json` | O plugin de memória do Claude Code — a superfície que M14 replica |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/` (todo o resto: `mem0/`, `server/`, `docs/`, `evaluation/`, `cli/`, `examples/`) | O SDK/servidor Python do produto — NÃO é o que replicamos; somos backend nativo, não wrapper (cut de 2026-05-21) |
| `integrations/mem0-plugin/scripts/*_cursor.sh` | Variantes Cursor — o M14 é Claude Code; a mecânica canônica está nas variantes não-`_cursor` |
| `.claude/knowledge-base/references/graphiti/` | Outro peer; fora do escopo desta questão (recall/kit) |
| Qualquer projeto NÃO clonado em `references/` | Cross-Project Rule: nunca alegar feature sem ler a fonte |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** mem0-plugin: 4h (projeto único). Sem split — só um peer em escopo.

**Rationale:** o plugin é ~40 arquivos, a maioria shell/Python curtos (< 250 linhas). 4h cobrem leitura das 5 superfícies com folga. É o único análogo direto do M14.

**Alternatives considered:** incluir graphiti (rejeitado — não tem plugin de Claude Code); 2h (rejeitado — as 9 tools MCP + autoria exigem leitura cuidadosa dos schemas).

**Stop condition — per question:** quando a Fase A de uma questão retorna zero matches após 3 tentativas com variações de query, marcar BLOCKED com razão "Fase A exhausted" e seguir. Não preencher com hotspots de outra questão.

**Stop condition — per project:** budget de 4h esgotado com N questões pendentes → marcar as pendentes BLOCKED "budget exhausted". Se todas as questões estão `done` OU honestamente `blocked`, emitir o promise apropriado.

### D2 — Só a variante Claude Code (não Cursor)

**Decision:** para cada mecânica, ler o script canônico (ex.: `on_user_prompt.sh`), não a variante `_cursor`.

**Rationale:** M14 é Claude Code. As variantes `_cursor` diferem só no formato de payload do host; a lógica de memória é idêntica e mais limpa na canônica.

**Consequences:** blueprint cobre a mecânica Claude Code; se uma decisão de UX precisar do payload exato do hook, consultamos `hooks.json`.

### D3 — Comparar contra o kit atual, não reimplementar

**Decision:** cada questão fecha com "o que o nosso kit (`docs/claude-code-kit/`) já faz vs o gap".

**Rationale:** M14 ESTENDE o kit existente (M12), não começa do zero. O blueprint tem que dizer o delta, não redesenhar.

## Research questions

Cada questão → coverage corner → método → formato de resposta esperado.

### Q1 — [Techniques] Como o recall por-prompt decide O QUE buscar e QUANDO pular?

O `on_user_prompt.sh` usa o PROMPT do usuário como query (vs nosso `query: project` constante)? Como decide pular prompts curtos? Qual o top-K e o mecanismo de timeout não-bloqueante para não travar o turno?

- **Método:** `Read integrations/mem0-plugin/scripts/on_user_prompt.sh` + `Read integrations/mem0-plugin/scripts/_search.py`. Grep por `MIN_`, `timeout`, `top_k`, `limit`, `len(`.
- **Resposta esperada:** tabela {gatilho de skip, fonte da query, top-K, mecanismo de timeout} + o delta contra `docs/claude-code-kit/hooks/theo-recall.mjs`.

### Q2 — [Techniques] Como o recall é INJETADO no contexto e formatado?

O hook injeta via qual canal (stdout JSON `additionalContext`? um bloco formatado?) e como formata as memórias recuperadas (ranking, deduplicação, cabeçalho)?

- **Método:** `Read integrations/mem0-plugin/scripts/_formatting.py` + grep `additionalContext|hookSpecificOutput|context` em `on_user_prompt.sh`.
- **Resposta esperada:** o contrato de injeção + o formato de saída, mapeado para o que nosso `theo-recall.mjs` já faz (linhas 42-55).

### Q3 — [Techniques] De QUAL HOOK cada autoria nasce? (user-prompt vs assistant-summary)

> **v1.1 (edge-review EC-2):** a autoria NÃO está num campo de um arquivo só — é EMERGENTE da origem do hook. `on_user_prompt.sh:~85` captura o "remember this" do USUÁRIO (=user); `on_stop.sh`/`capture_session_summary.py` capturam o resumo do ASSISTENTE (=assistant). Pergunta reformulada de "qual campo?" para "de qual hook?".

O que o usuário digita entra como `user`; resumos de sessão/compactação (produzidos pelo assistente) entram como `assistant`. De QUAL hook cada autoria nasce, e o `enforce_metadata_defaults.sh` força qual default de metadata por cima?

- **Método:** `Read integrations/mem0-plugin/scripts/on_user_prompt.sh` (linha ~85, captura lado-usuário) + `Read integrations/mem0-plugin/scripts/on_stop.sh` + `Read integrations/mem0-plugin/scripts/capture_session_summary.py` (lado-assistente) + `Read integrations/mem0-plugin/scripts/enforce_metadata_defaults.sh` (defaults). Grep `role|author|actor|agent_id|metadata`.
- **Resposta esperada:** o MAPA hook→autoria (qual hook escreve com qual autoria), mapeado para nosso `attributed_to` (v1.1, `RememberOptions.attributedTo`).

### Q4 — [Techniques] Como o recall contextual em ferramentas funciona (arquivo aberto / erro de bash)?

Ao ler um arquivo (PreToolUse) e ao falhar um comando (PostToolUse), o plugin busca memórias relacionadas com qual query? Qual o gatilho e o filtro?

- **Método:** `Read integrations/mem0-plugin/scripts/file_context.py` + `Read integrations/mem0-plugin/scripts/on_bash_output.sh`.
- **Resposta esperada:** {evento, fonte da query, filtro} para cada um dos dois — para decidir se replicamos ambos ou só um.

### Q5 — [Techniques] Como a guarda anti-escrita em MEMORY.md é implementada?

O PreToolUse bloqueia escrita em MEMORY.md como? Retorna exit code? Bloqueia por path-match?

- **Método:** `Read integrations/mem0-plugin/scripts/block_memory_write.sh`.
- **Resposta esperada:** o mecanismo exato (exit code / permission decision), replicável como hook TS.

### Q6 — [Dependencies] Quais são as 9 tools MCP, e como o server + identidade são declarados?

> **v1.1 (edge-review EC-1):** as 9 tools NÃO estão no `.mcp.json` — ele só declara a conexão HTTP a um servidor remoto (`https://mcp.mem0.ai/mcp/`). A fonte real dos NOMES é o `README.md` (tabela linhas 270-278, verificada). Limitação honesta: o README dá DESCRIÇÕES, não schemas de argumentos — o schema exato de cada arg é INFERIDO do nome/descrição + do nosso MCP existente, NUNCA alegado como copiado do repo.

Os 9 nomes exatos (do README), como o plugin declara o MCP server (URL, transporte, auth header), e — o ponto que importa para o nosso multi-tenant — como a identidade viaja (o header `Authorization: Token ${MEM0_API_KEY}` é single-tenant; nós substituímos por Principal `(workspace,user)`).

- **Método:** `Read integrations/mem0-plugin/README.md` (tabela de tools, linhas ~270-278) para os NOMES + descrições; `Read integrations/mem0-plugin/.mcp.json` para o padrão de auth (`Token ${API_KEY}` no header — o ponto single-tenant a substituir). Grep `Authorization|Token|user_id|agent_id`.
- **Resposta esperada:** tabela das 9 tools {nome, descrição, como a identidade viaja no mem0} → mapeada contra nosso MCP atual (`packages/mcp/src/tools/`, delta já sabido: faltam `list_entities`, `get_memory`, `update_memory`, `delete_entities`) → com a coluna "ajuste multi-tenant" (header single-tenant → Principal).

### Q7 — [Tools] Como o wizard de onboarding detecta e importa contexto, e é idempotente?

O `/onboard` detecta `CLAUDE.md`/`AGENTS.md` como? Instala categorias de memória? O que o torna re-executável sem duplicar?

- **Método:** `Read integrations/mem0-plugin/scripts/auto_import.py` + `Read integrations/mem0-plugin/scripts/setup_coding_categories.py`. Grep `exists|idempotent|already|skip`.
- **Resposta esperada:** o algoritmo de detecção + a garantia de idempotência, para decidir o que nosso wizard precisa.

### Q8 — [Integration tests] Como o plugin registra os hooks e é distribuído (marketplace)?

O `hooks.json` mapeia quais eventos → quais scripts? O `marketplace.json` declara a distribuição como? Há teste/smoke do registro?

- **Método:** `Read integrations/mem0-plugin/hooks.json` + `Read integrations/mem0-plugin/plugin.json` + `Read .claude/knowledge-base/references/mem0/.claude-plugin/marketplace.json`.
- **Resposta esperada:** o mapa evento→script + o shape do manifesto de marketplace, mapeado contra nosso `docs/claude-code-kit/hooks/merge-settings.mjs` (que já registra 4 hooks) — o delta são os hooks de leitura + o manifesto de distribuição.

## Coverage Matrix

| # | Corner | Método (arquivo/grep) | Citação pré-validada |
|---|---|---|---|
| Q1 | Techniques | Read on_user_prompt.sh + _search.py | ✅ ambos existem |
| Q2 | Techniques | Read _formatting.py + grep on_user_prompt.sh | ✅ existe |
| Q3 | Techniques | Read enforce_metadata_defaults.sh + capture_session_summary.py | ✅ ambos |
| Q4 | Techniques | Read file_context.py + on_bash_output.sh | ✅ ambos |
| Q5 | Techniques | Read block_memory_write.sh | ✅ existe |
| Q6 | Dependencies | Read .mcp.json + mcp_config.json + README.md | ✅ os 3 |
| Q7 | Tools | Read auto_import.py + setup_coding_categories.py | ✅ ambos |
| Q8 | Integration tests | Read hooks.json + plugin.json + marketplace.json | ✅ os 3 |

**Cobertura dos 4 corners:** Techniques (Q1-Q5, 5 questões), Dependencies (Q6), Tools (Q7), Integration tests (Q8). Todos ≥ 1. Techniques tem 5 — acima do "max 3 por corner" do budget, MAS justificado: o M14 é dominantemente uma feature de TÉCNICA de recall (5 mecânicas distintas: por-prompt, injeção, autoria, tool-context, guarda). Dividir em duas discovery plans fragmentaria uma investigação coesa. **ADR de deferral não se aplica** — nenhum corner está vazio; a concentração em Techniques é a natureza do milestone, não uma lacuna. Registrado como decisão consciente (ADR D3 escopo).

## Halt-loop checkpoints (para /discover-execute)

Antes de marcar uma questão `done`:

- A resposta cita ao menos um path REAL em `.claude/knowledge-base/references/mem0/` (verificável via Read).
- A resposta inclui o DELTA contra nosso stack (kit atual em `docs/claude-code-kit/` OU `packages/mcp/src/`), não só descreve o mem0.
- Para Q6 (MCP): a resposta identifica QUAIS das 9 tools já temos e QUAIS faltam, nomeadas.
- Para Q7 (edge EC-3): NÃO transcrever as 374 linhas do `auto_import.py` — citar SÓ o trecho de detecção de `CLAUDE.md`/`AGENTS.md` (grep `exists|already|skip`) + a guarda de idempotência.

## Acceptance Criteria

- Todas as 8 questões `done` OU honestamente `blocked` com razão.
- Cada citação resolve via `Path.exists()` (hard cap de citação fabricada).
- Os 4 coverage corners não-vazios.
- Blueprint tem seção de reconciliação: mem0 surface → nosso equivalente → ajuste multi-tenant/contrato.
- ≥ 1 ADR no blueprint (decisão de arquitetura para a implementação).

## Global Definition of Done

`/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS, sem hard cap disparado (coverage corners populados + zero citação fabricada), per `.claude/rules/discover-blueprint-golden-rule.md`.
