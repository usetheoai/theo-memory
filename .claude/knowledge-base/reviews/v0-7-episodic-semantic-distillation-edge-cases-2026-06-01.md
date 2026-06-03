# Discover Edge Case Review — v0-7-episodic-semantic-distillation

Data: 2026-06-01
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/v0-7-episodic-semantic-distillation-plan.md` v1.0
Research questions analisadas: 8 (Q1-Q8)
Edge cases encontrados: 9 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 3)

## MUST FIX

### EC-1: Letta `tests/` path no plan está errado

- **Question afetada:** Q4 (tests corner)
- **Família:** Citation / Reference path
- **Cenário:** Plano cita `letta/letta/tests/` ("verify path exists first") — durante `/discover-execute`, Fase A `find ... -name '*test*' -path '*memory*'` em `letta/letta/tests/` retornará 0 hits porque o path NÃO EXISTE.
- **Impacto:** Q4 (letta sub-tarefa) marcada BLOCKED por "Fase A exhausted", ou pior, /discover-confidence fail por `fabricated_citation` hard cap (cap 49 INVALID) se o /execute insistir.
- **Fix sugerido (1 linha no plano):** trocar `letta/letta/tests/` por `.claude/knowledge-base/references/letta/tests/` em Q4 + In-Scope table (path verificado via `ls`: contém `adapters/`, `conftest.py`, `configs/`, etc).

### EC-2: Web allowlist gaps — 6 domínios/subdomínios não estão em `.claude/rules/discover-web-allowlist.txt`

- **Question afetada:** Q7 + Q8 (prior_art corner)
- **Família:** Citation / Allowlist coverage
- **Cenário:** Plano cita `blog.mem0.ai`, `www.letta.com`, `zep.ai`, `cognee.ai`, `aclanthology.org`, `martinfowler.com` em D4 + In-Scope. Allowlist atual contém SÓ `arxiv.org`, `mem0.ai`, `letta.com`, `ar5iv.labs.arxiv.org`. Per cycle-discover.md v1.1 hard gate #5 (`domain_not_in_allowlist`): subdomínios NÃO são auto-allowed; `blog.mem0.ai` ≠ `mem0.ai`; `www.letta.com` ≠ `letta.com`. /discover-execute citará URL → /discover-confidence cap 49 INVALID.
- **Impacto:** 6 URLs candidate para Q7+Q8 falham allowlist; ou /execute fabrica citation skip → /confidence INVALID; ou pula Q7+Q8 inteiras → coverage cap 49.
- **Fix sugerido (1 frase + commit):** pre-flight step BEFORE /discover-execute: adicionar entradas a `.claude/rules/discover-web-allowlist.txt` (com rationale inline citando este slug + data) para os 6 domínios — `aclanthology.org`, `martinfowler.com`, `blog.mem0.ai`, `www.letta.com`, `zep.ai`, `cognee.ai`. Único commit `chore(allowlist)(v0-7): seed prior_art domains`.

### EC-3: Clones são `--depth 1` — Q2 Fase A com `git log` não traz histórico

- **Question afetada:** Q2 (techniques: Letta sleep-time v1→v4 iteration)
- **Família:** Method
- **Cenário:** Plano lista `git log --oneline -- letta/letta/groups/sleeptime_multi_agent*.py` como Fase A para capturar commit messages = failure-mode hints. Verificação: `git -C .claude/knowledge-base/references/letta log --oneline | head -3` retorna 1 commit somente → clone é `--depth 1` (per CLAUDE.md "references/ clones --depth 1, 2026-05-21"). Não há histórico para diferenciar v1 vs v2 vs v3 vs v4.
- **Impacto:** Q2 perde o sinal de "failure-mode driver" que motivaria a iteração; a investigação degenera para "4 versões existem coexistindo, motivo desconhecido" — claim fraco no blueprint, /discover-confidence soft cap por baixa densidade de citação.
- **Fix sugerido (≤3 linhas no plano):** trocar Fase A de Q2 para `diff sleeptime_multi_agent_v1.py sleeptime_multi_agent_v2.py | head -100` (e v2→v3, v3→v4) + grep por TODO/FIXME/DEPRECATED comments nos próprios arquivos + grep `from .sleeptime_multi_agent_v` em todo `letta/` para descobrir qual versão é IMPORTADA hoje (o producer atual revela qual venceu).

## SHOULD TEST

### EC-4: Mem0 extraction prompt pode não estar em `memory/utils.py`

- **Question afetada:** Q1 (techniques: Mem0 two-stage pipeline)
- **Halt-loop checkpoint sugerido:** "Se Fase A grep `prompt|extract` em `mem0/memory/utils.py` retornar 0 hits, retry em `mem0/mem0/configs/`, `mem0/mem0/memory/prompts.py`, `mem0/mem0/prompts/`. Mem0 frequentemente extrai constantes para módulo dedicado; checkpoint estende busca antes de marcar BLOCKED."

### EC-5: Q3 Mem0 conflict-resolution pode ser ABSENTE (não-bug)

- **Question afetada:** Q3 (techniques: conflict-resolution comparison)
- **Halt-loop checkpoint sugerido:** "Se Fase A grep `conflict|contradict|override|supersede|merge|resolve` em `mem0/memory/main.py` retornar 0 hits após 3 retry variants, marcar 'Mem0 has no explicit conflict-handling site — this is our differentiation pitch in v0.7' como FINDING POSITIVO (gap identificado), NÃO BLOCKED. Blueprint Recommendations § Q3 deve citar a ausência como evidência da oportunidade."

### EC-6: Q5 Rule 9 verdict per lib — sem cap, budget explode

- **Question afetada:** Q5 (deps corner)
- **Halt-loop checkpoint sugerido:** "Cap Q5 em max 5 libs investigadas por projeto (10 total Mem0+Letta). Para cada lib além do top-5, verdict default `DEFER (revisit at /to-plan v0-7-distillation-pipeline)` com rationale 'discovery budget cap; full Rule 9 evaluation moves to plan-confidence cycle'. Critério top-5: libs mencionadas em pyproject.toml E importadas em pelo menos 1 site de `memory/` ou `services/`."

## DOCUMENT

### EC-7: Snapshot infra é MANUAL para v0-7 (discover-web-v0-1 não shipped)

- **Risco aceito:** ADR D4 do plano cita "every URL → snapshot at `discoveries/snapshots/{slug}/{sha256}.md`" como hard contract. Verificação: `.claude/skills/discover-confidence/scripts/` NÃO contém `_canonicalize_url_match`/`_extract_snapshot_body`/`_compute_snapshot_sha256`/`_check_urls_live` — discover-web-v0-1 plan EXISTS em `plans/` mas NÃO está em `plans/completed/`. Logo, snapshot writing é MANUAL durante /discover-execute (precedente: `discoveries/snapshots/{v0-3,v0-4a,v0-4b,voyager-skill-library}/` foram escritos manualmente por seus /execute respectivos). Documentar em D4: "snapshot helpers em discover-confidence ainda não shipped — /execute escreve sha256 + file write inline, mirrando o precedente das 4 discoveries anteriores. Quando discover-web-v0-1 fechar, próximas discoveries usarão helpers programáticos."

### EC-8: Letta v1-v4 pode incluir test/deprecated versões

- **Risco aceito:** Plano assume v1-v4 = "evidence of iteration on this exact problem". Possível: v2 é WIP rejeitado; v3 é teste descartado; só v1 e v4 são produção. Documentar: Q2 deve antes grep `from .sleeptime_multi_agent_v` em todo `letta/` para identificar quais versões TÊM consumer ativo. Se v2/v3 não têm importador, marcar como "abandoned experiments" e focar análise em v1 → v4 transition. Risco aceito porque o filter é trivial durante /execute (1 grep).

### EC-9: arXiv URLs — sempre abs page, nunca PDF

- **Risco aceito:** Q7 cita Generative Agents (Park 2023) etc. arXiv tem 2 surfaces por paper: `arxiv.org/abs/{id}` (HTML landing, estável, metadados + citações) e `arxiv.org/pdf/{id}.pdf` (binary, instável — versões v1/v2/v3 revisadas). Documentar: snapshot SEMPRE da abs page; se algorithm steps precisam de mais detalhe, fallback secundário a `ar5iv.labs.arxiv.org/{id}` (HTML rendering, já allowlisted). Nunca snapshot do .pdf binário (impossível extrair texto programaticamente sem ferramenta extra).

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 (Mem0 pipeline) | 1 | 0 | 1 (EC-4) | 0 |
| Q2 (Letta sleep-time) | 2 | 1 (EC-3) | 0 | 1 (EC-8) |
| Q3 (conflict-resolution) | 1 | 0 | 1 (EC-5) | 0 |
| Q4 (tests) | 1 | 1 (EC-1) | 0 | 0 |
| Q5 (deps) | 1 | 0 | 1 (EC-6) | 0 |
| Q6 (tools) | 0 | 0 | 0 | 0 |
| Q7 (academic prior_art) | 1 | 0 | 0 | 1 (EC-9) |
| Q8 (vendor prior_art) | 1 | 1 (EC-2) | 0 | 0 |
| Cross-cutting (snapshot infra) | 1 | 0 | 0 | 1 (EC-7) |
| **Total** | **9** | **3** | **3** | **3** |

**Veredicto:** DISCOVERY PLAN PRECISA DE AJUSTE — bump v1.0 → v1.1 absorvendo 3 MUST FIX (EC-1 Letta tests path; EC-2 allowlist pre-flight; EC-3 Fase A method para Q2). 3 SHOULD TEST viram halt-loop checkpoints no plano (EC-4/5/6). 3 DOCUMENT viram ADR notes ou se anexam a ADRs existentes (EC-7 → D4 expanded; EC-8 → Q2 pre-step; EC-9 → D4 snapshot guidance).

Após absorção: re-rodar `/discover-confidence v0-7-episodic-semantic-distillation` para validar v1.1 score. Antes de `/discover-execute`: commit allowlist additions (EC-2 fix).

### Honest acknowledgment

- Time budget 8h é apertado para 8 questions (média 1h/question; Q1+Q2 são deep — provavelmente 1.5-2h cada). Se /discover-execute hit budget cap, espera-se que Q6 (tools, simpler) seja o primeiro BLOCKED — risco aceito porque tools tem menor sinal-de-moat.
- Plan não declara DEFER-CORNER markers (D5: prior_art mandatory). Se Q7 OR Q8 BLOCKED por allowlist OR web budget, /discover-confidence aplica cap 70 SHIPPABLE_WITH_CAVEATS — aceitável para um first-pass discovery.
- LangMem não-clonado: out-of-scope por absence (documentado no In-Scope table). Se usuário quiser LangMem, clonar primeiro e bumpar plan para v1.2.
