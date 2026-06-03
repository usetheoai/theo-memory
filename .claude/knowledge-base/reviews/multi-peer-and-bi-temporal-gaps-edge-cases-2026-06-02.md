# Discover Edge Case Review — multi-peer-and-bi-temporal-gaps

Data: 2026-06-02
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/multi-peer-and-bi-temporal-gaps-plan.md` v1.0
Research questions analisadas: 7 (Q1-Q7) + 5 ADRs (D1-D5)
Edge cases encontrados: 10 (MUST FIX: 5, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: ADR D3 ignora subdomain risk — `docs.honcho.dev` é separate allowlist entry

- **Question afetada:** Q5
- **Família:** Citation / Method (web)
- **Cenário:** ADR D3 adiciona apenas `honcho.dev` ao allowlist. Per `.claude/rules/discover-web-allowlist.txt` regra "Subdomains are NOT auto-allowed", se Honcho hospedar technical docs em `docs.honcho.dev` OR `developer.honcho.dev` (padrão comum em SaaS), Q5 vai falhar com `domain_not_in_allowlist` cap mesmo após D3 ser aplicada. Plan Fase B explicitamente menciona `WebFetch https://docs.honcho.dev/` mas não acrescenta esse subdomain ao allowlist.
- **Impacto:** Q5 BLOCKED em `/discover-execute`; fallback github plastic-labs/honcho/README é cobertura parcial (README ≠ data model docs).
- **Fix sugerido:** ADR D3 deve listar 3 entries: `honcho.dev` + `docs.honcho.dev` + `app.honcho.dev`. 1-line correction em ADR D3 antes de `/discover-execute`.

### EC-2: Q3 hardcodes line range 231-300 que CORTA ~17 LoC do função alvo

- **Question afetada:** Q3
- **Família:** Method
- **Cenário:** Empirical verification 2026-06-02 confirmou `_build_filters_and_metadata` começa linha 231 mas próxima função `_build_session_scope` começa linha 317. A função alvo é ~86 LoC, NÃO 70. Plan "Read mem0/memory/main.py:231-300" perde linhas 301-316 (provavelmente a parte da função que aplica filters de query, justamente onde attribution patterns aparecem).
- **Impacto:** Resposta da Q3 baseada em ~80% da função; conclusion sobre "Mem0 metadata convention" pode estar INCOMPLETA.
- **Fix sugerido:** Mudar Fase A para "Grep `_build_filters_and_metadata` + Read from match line to next `^def` boundary" OR ajustar range para 231-316. ≤1 frase no plan task.

### EC-3: Q4 `find ... -name "*block*"` em Letta alembic explode (167 migrations no total)

- **Question afetada:** Q4
- **Família:** Method
- **Cenário:** Empirical 2026-06-02: `letta/alembic/versions/` tem **167 migrations**. `find ... -name "*block*"` vai retornar MUITAS — Letta usa block-prefixed naming para várias features (block_history, block, blocks_agents, blocks_tags, blocks_conversations, block_history_versions etc). Sem filter mais específico, /discover-execute pode gastar 30+ min lendo migrations irrelevantes.
- **Impacto:** Q4 estoura time budget (45 min stop condition per ADR D1) sem chegar à migration certa. BLOCKED.
- **Fix sugerido:** Trocar para `grep -l "block_history" letta/alembic/versions/*.py` OR `find ... -name "*block_history*"` (mais específico). ≤1 frase.

### EC-4: Q7 synthesis dimensions NÃO pré-definidas → comparison table não-comparável

- **Question afetada:** Q7
- **Família:** Interpretation / State
- **Cenário:** Plan diz Q7 produz "3×3 comparison table (migration cost / query expressiveness / backward compat)". MAS as 3 colunas só foram declaradas no plan, NÃO operacionalizadas. Se Q3 retorna shape `{convention_name, key_format, filter_method}` e Q5 retorna shape `{schema_columns, sql_excerpt, query_api_url}`, a synthesis vai forçar tradução tardia. Halt-loop checkpoint 4 ("Before Q7 synthesis: Q3+Q4+Q5 must be DONE") não resolve isso.
- **Impacto:** Comparison table fica heterogênea (Mem0 row cita convention name; Honcho row cita schema columns; Letta row cita block parent FK) — incomparável.
- **Fix sugerido:** Q3 + Q4 + Q5 respostas DEVEM seguir mesmo shape: `{schema_or_convention: str, query_api_signature: str, migration_cost: 'zero|low|medium|high'}`. Adicionar essa instrução em cada question Expected answer shape line.

### EC-5: Pre-condition ADR D3 allowlist edit é gate humano não-mecanizado

- **Question afetada:** Q5 (indirectly all halt-loop)
- **Família:** Dependency / Permission
- **Cenário:** ADR D3 diz "honcho.dev MUST be added to allowlist BEFORE invoking /discover-execute". MAS /discover-execute halt-loop não verifica isso. Se humano esquecer, iteration 1 (Q5) bate `domain_not_in_allowlist` cap e plan fails Q5 inteiro.
- **Impacto:** Plan executa quase-completamente mas Q5 vira BLOCKED na primeira tentativa, gastando WebFetch tokens em vão.
- **Fix sugerido:** Adicionar a halt-loop checkpoint 1 explícito: "Iteration 1 (BEFORE answering Q1): verify `grep -q 'honcho.dev' .claude/rules/discover-web-allowlist.txt` returns 0; if not, HALT with reason 'ADR D3 pre-condition'". Movemos a verificação para dentro do loop.

## SHOULD TEST

### EC-6: Zep technical docs podem viver em `help.getzep.com` OR `docs.zep.ai` subdomains

- **Question afetada:** Q6
- **Halt-loop checkpoint sugerido:** Antes de Q6 Fase B (WebFetch), tentar primeiro `WebFetch zep.ai` + `WebFetch www.getzep.com/blog/`; se nenhum surfaca SDK example com `as_of=...` syntax, registrar `<!-- BLOCKED: zep technical docs likely at subdomain — extend allowlist if found -->` em iteration log e move on. Honest BLOCKED é aceitável; não cobrir subdomain sem evidence é melhor que assumir.

### EC-7: Q4 interpretation "is it bi-temporal Y/N" é binário demais — captura espectro

- **Question afetada:** Q4
- **Teste sugerido:** Q4 Expected answer shape deve incluir 3 categorias explicit: (a) `audit_log_only` (apenas timestamps de inserção; sem semantics bi-temporal), (b) `temporal_versioning` (valid_from/valid_to MAS sem query API exposing them), (c) `full_bitemporal` (storage + query). Q4 escolhe uma das três + cita SQL.

### EC-8: Q1/Q2 both-empty case é finding POSITIVO, não failure

- **Question afetada:** Q1 + Q2 (combined)
- **Teste sugerido:** Se Q1 retorna `bi-temporal-test-hits: 0` AND Q2 retorna `deps_delta: ∅`, a conclusion deve ser "bi-temporal in Letta is implementation-cost-only + zero infra burden" — finding HIGHLY POSITIVO para TheMemory (não precisa de SQLAlchemy-Continuum-like dependency). Adicionar este shortcut como halt-loop checkpoint: "If Q1 + Q2 both-empty, gate Q4 to focus on schema-only investigation (skip dep audit subsection)".

## DOCUMENT

### EC-9: v0-7 + v0-8 snapshots JÁ cobrem some Mem0 + Zep narrative — read first to avoid re-fetch

- **Question afetada:** Q3 + Q6
- **Risco aceito:** Existem 5 snapshots em `v0-7-episodic-semantic-distillation/` + 6 em `v0-8-benchmark-methodology/`. Especificamente `2026-06-02-dmr-memgpt-zep.md` (v0-8) cobre Zep bi-temporal context na narrativa de comparação de benchmarks. Para Q3 (Mem0 attribution convention) e Q6 (Zep bi-temporal), `/discover-execute` deve PRIMEIRO read those existing snapshots ANTES de WebFetch novamente. Token saving + faster execution. NÃO MUST FIX porque o plan já é honesto sobre custos.

### EC-10: Time budget 3h para prior_art pode ser overspend se Q5/Q6 ficam BLOCKED

- **Question afetada:** Q5 + Q6 (combined)
- **Risco aceito:** Se Honcho landing page é puro marketing E Zep SDK docs gated atrás de sign-up, ambos Q5 e Q6 podem ficar PARTIAL com 1h gasto cada — sobra 1h sem uso útil. Plan já permite honest BLOCKED. Documentar que se ambos ficam PARTIAL após 2h total, o restante do budget vai para reforçar Q3+Q4+Q7 (deeper code analysis sintetizando o que sabemos sem confirmação web).

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| Q1 | 1 | 0 | 0 (EC-8 combined) | 0 |
| Q2 | 1 | 0 | 0 (EC-8 combined) | 0 |
| Q3 | 2 | 1 (EC-2) | 0 | 1 (EC-9) |
| Q4 | 2 | 1 (EC-3) | 1 (EC-7) | 0 |
| Q5 | 2 | 2 (EC-1, EC-5) | 0 | 0 |
| Q6 | 2 | 0 | 1 (EC-6) | 1 (EC-9 partial) |
| Q7 | 1 | 1 (EC-4) | 0 | 0 |
| Q1+Q2 | 1 | 0 | 1 (EC-8) | 0 |
| Q5+Q6 | 1 | 0 | 0 | 1 (EC-10) |

**Total: 10 edge cases (5 MUST FIX + 3 SHOULD TEST + 2 DOCUMENT)**

**Veredicto: DISCOVERY PLAN PRECISA DE AJUSTE**

5 MUST FIX devem ser absorvidos via plan v1.0 → v1.1 ANTES de `/discover-execute`:

1. **EC-1** (Q5 + ADR D3) — Allowlist deve incluir `honcho.dev` + `docs.honcho.dev` + `app.honcho.dev` (3 entries, não 1).
2. **EC-2** (Q3) — Trocar range hardcoded 231-300 para grep-then-Read pattern OR ampliar para 231-316 (próxima `^def`).
3. **EC-3** (Q4) — Refinar `find -name "*block*"` para `-name "*block_history*"` (Letta alembic tem 167 migrations; over-inclusive find estoura budget).
4. **EC-4** (Q7) — Pré-definir 3 dimensions homogêneas (`schema_or_convention`, `query_api_signature`, `migration_cost: zero|low|medium|high`) em Expected answer shape de Q3 + Q4 + Q5 — torna a Q7 synthesis trivial.
5. **EC-5** (Q5 + ADR D3 enforcement) — Adicionar halt-loop checkpoint que VERIFICA allowlist contém `honcho.dev` ANTES de iteration 1 começar (mecaniza o gate humano).

Os 3 SHOULD TEST + 2 DOCUMENT são notas para `/discover-execute` driver — não bloqueiam mas guiam comportamento.

**Recommended next step:** humano bumpa plan v1.0 → v1.1 absorvendo os 5 MUST FIX, adiciona `honcho.dev` + `docs.honcho.dev` + `app.honcho.dev` ao `.claude/rules/discover-web-allowlist.txt`, então invoca `/discover-execute multi-peer-and-bi-temporal-gaps`.
