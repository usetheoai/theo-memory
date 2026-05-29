# Discover Edge Case Review — v0-4a-reflection-pipeline

Data: 2026-05-25
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/v0-4a-reflection-pipeline-plan.md`
Research questions analisadas: 8
Edge cases encontrados: 13 (MUST FIX: 3, SHOULD TEST: 7, DOCUMENT: 3)

---

## MUST FIX

### EC-1: `.claude/knowledge-base/references/mem0/mem0/memory/main.py` tem 3222 linhas — excede default Read limit (2000)

- **Question afetada:** Q6
- **Família:** Method
- **Cenário:** O plano Q6 diz "head 400 lines then grep -n" e adia o resto. Mas Read sem offset/limit lê só as primeiras 2000 linhas; o `_update_memory` pode estar na linha 2500+ (Mem0 organiza Memory class no topo + helpers/proxies abaixo). Sem strategy explícita de offset, halt-loop pode ler o arquivo "todo" achando que viu tudo, e perder consolidation logic adjacente.
- **Impacto:** Q6's negative-space conclusion ("Mem0 has no `reflect()`") fica honest, mas a positive-space side ("how does `_update_memory` actually work") pode ser parcial — blueprint relataria consolidação write-time com base em 60% do arquivo, dando falsa completude.
- **Fix sugerido:** Trocar "head 400 lines then grep" por: `wc -l` → `grep -n "def _update_memory\|def update\|class Memory:" main.py` → `Read main.py offset=<grep-line-1> limit=300` para cada hit, com no máximo 3 Reads sequenciais. Documenta strategy no Fase A de Q6.

### EC-2: `summarizer.py` 894 linhas — "head 200" cobre só 22% do arquivo

- **Question afetada:** Q4
- **Família:** Method
- **Cenário:** Plano Q4 Fase A diz `Read .claude/knowledge-base/references/letta/letta/services/summarizer/summarizer.py` (head 200 lines — likely the orchestrator)`. Em 894 linhas, head 200 captura imports + class signatures + maybe um init, mas o algoritmo concreto (probabilidade alta de estar em métodos privados ~linha 300+) fica fora. Halt-loop conclui "algoritmo é X" baseado em scaffolding apenas.
- **Impacto:** Q4's table column "algorithm summary in 2-3 sentences" produz síntese baseada em assinaturas de método, NÃO no corpo do algoritmo. Recomendação downstream de "qual summarizer mapeia melhor para `reflect()`" fica especulativa.
- **Fix sugerido:** Trocar "head 200" por: Read full file (894 < 2000 default — entra inteiro em UM Read). Mesmo `compact.py` (20kb ~ 600 lines) entra full. Único arquivo que precisa offset strategy é `summarizer.py` IF for ainda maior em iterações futuras — mas hoje 894 é OK. Atualizar a linha do Fase A: "Read full file (894 LoC)".

### EC-3: Q2 lista 5 candidates Node mas Fase A pré-aloca apenas 3 WebFetch

- **Question afetada:** Q2
- **Família:** Scope / Coverage
- **Cenário:** Plano Q2 question text declara candidates `bullmq`, `node-cron`, `croner`, `agenda`, `bree`, plus in-process `setTimeout`. Fase A method declara WebFetch para 3 (`bullmq`, `node-cron`, `croner`). Halt-loop executor faz 3 fetches, gera 3 snapshots, escreve Rule 9 verdict — mas Q2 acceptance diz "≥ 2 candidates compared". 3 satisfaz; mas o question text criou expectativa de 5+1=6 evaluations. Discrepância entre intent e execution plan.
- **Impacto:** Blueprint reportará Rule 9 verdict honest sobre 3 candidates; humano lerá e pensará "cadê agenda e bree?". Ou pior, halt-loop tenta cobrir todos 5 sem orçamento alocado e estoura time-budget.
- **Fix sugerido:** Question text: substituir lista de 5 por 3 (`bullmq`, `node-cron`, `croner`) ou explicitar "+ informational mention of `agenda`/`bree` without WebFetch (deferred to F-followup if any reviewer disputes)". Não inflar Fase A.

---

## SHOULD TEST

### EC-4: Q1 tests podem usar time-travel/mocking idioms não-mapeáveis 1:1 para JS/TS

- **Question afetada:** Q1
- **Halt-loop checkpoint sugerido:** Quando lendo `integration_test_sleeptime_agent.py` e `test_static_buffer_summarize.py`, transcrever VERBATIM o idiom de mocking/time-control usado (provavelmente `freezegun`, `pytest-asyncio` event-loop helper, OR monkeypatch). NÃO tentar traduzir para vitest/jest na fase de execute; deixar tradução para o blueprint synthesis section. Citar o idiom como "Letta uses X (citation:N)" — o /to-plan downstream decide se vitest fake-timers cobre ou se precisamos sinon.

### EC-5: Q3 boolean "embedded/subprocess/container" pode não caber se Letta ships como library only

- **Question afetada:** Q3
- **Halt-loop checkpoint sugerido:** Permitir um 4º valor "library-only (consumer hosts the worker process)" na decision table. Se `find` retorna zero Docker/Compose/Makefile artifacts E `helpers.py` exporta apenas classes/functions (nenhum `if __name__ == '__main__'`), o veredicto é "library-only" — documente como negative-space finding, NÃO force escolha entre as 3 categorias originais.

### EC-6: Q4 e Q5 sobrepõem-se — `sleeptime_multi_agent_v4.py` invoca summarizers

- **Question afetada:** Q4, Q5
- **Halt-loop checkpoint sugerido:** Halt-loop driver impõe ordering: Q4 (summarizer algoritmos) ANTES de Q5 (sleep-time agents). Razão: Q5 vai citar `summarizer.SummarizerX` que Q4 já documentou. Se Q5 rodar antes, ela inventa context sobre o summarizer OU re-lê arquivos que Q4 cobriria. Adicionar à pre-flight: `progress.question_order = [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8]`.

### EC-7: Q5 cross-reference para out-of-scope `letta_agent*.py` / `base_agent*.py`

- **Question afetada:** Q5
- **Halt-loop checkpoint sugerido:** Se `sleeptime_multi_agent_v4.py` ou `voice_sleeptime_agent.py` importa de `letta.agents.letta_agent_v3` / `base_agent_v2` etc. (todos out-of-scope), NÃO seguir o link. Anotar no blueprint: "trigger fires via `<class>.<method>` from out-of-scope agent module — abstracted as `BaseAgent.run_step`-equivalent in TheMemory mapping; concrete impl out-of-scope per plan In-Scope/Out-of-Scope". Defesa contra scope creep.

### EC-8: Q6 grep `def _update_memory` pode bater múltiplos contextos (Memory class + proxy + clients)

- **Question afetada:** Q6
- **Halt-loop checkpoint sugerido:** Anchor grep ao contexto de classe. Primeiro: `grep -n "^class " .claude/knowledge-base/references/mem0/mem0/memory/main.py` para obter line numbers das classes. Segundo: `grep -n "def _update_memory\|def update\|def _add" .claude/knowledge-base/references/mem0/mem0/memory/main.py` cross-refed com class boundaries. Q6 documenta apenas o `_update_memory` dentro de `class Memory:` (a classe primary); proxies/clients são adjacent and not Q6's target.

### EC-9: Q7 arXiv PDF Unicode brokenness pode garblar a fórmula `importance × recency × relevance`

- **Question afetada:** Q7
- **Halt-loop checkpoint sugerido:** Se WebFetch'd PDF text contém tokens garbled (regex match em formula area: `\\u[0-9a-f]{4}` repetidos OR caracteres não-imprimíveis OR matemática que vira `\x00`-like), marcar Q7 como `partial` no progress JSON. Blueprint cita a fórmula da forma ENCONTRADA (mesmo que parcial) + caveat explícito "PDF text extraction may have lost mathematical typesetting; consult paper § 4.2 directly for canonical formula". NÃO inventar fórmula limpa baseada em training-data recall.

### EC-10: Q8 WebSearch pode não bater nenhum dos 2 URL patterns declarados

- **Question afetada:** Q8
- **Halt-loop checkpoint sugerido:** Se FIRST 3 search results não bater `<title>` contém "BackgroundMemoryManager" NEM URL contém `/langgraph/reference/memory/`, escalar para fallback: WebFetch `github.com/langchain-ai/langmem/blob/main/README.md` (allowlist `github.com` já cobre per `discover-web-allowlist.txt` line 19). README oficial conta como design-comparison source válida (open-source READMEs são tipicamente canonical para a API publicada).

### EC-11: Q6 Mem0 grep "no reflect" precisa rodar OUTRA vez no halt-loop, não confiar no grep pré-plan

- **Question afetada:** Q6
- **Halt-loop checkpoint sugerido:** O plano cita "grep -rln pre-validated returns ZERO hits" no Context. Mas o grep rodou hoje (2026-05-25) contra o clone --depth 1 snapshot. Halt-loop deve re-executar `grep -rln "def reflect\|importance_score\|consolidat\|class.*Reflect\|generate_summary" .claude/knowledge-base/references/mem0 --include="*.py"` antes de fechar Q6 e confirmar STILL zero — defesa contra qualquer drift entre o plan-write moment e o execute moment (improvable porque o clone é read-only, mas a re-check é trivial).

---

## DOCUMENT

### EC-12: Q2 vive em `deps` corner; hard gate `rule9_verdict_missing` não auto-dispara

- **Risco aceito:** Per `cycle-discover.md v1.1` hard gate #7, a regra de Rule 9 verdict dispara APENAS quando uma question está classificada em `prior_art` corner. Q2 está em `deps` (Letta deps inspection + Node ecosystem evaluation híbrido). O cap em 49 não dispara automaticamente se Q2 esquecer o verdict — mas Q2's próprio halt-loop checkpoint EXIGE o verdict explícito. Enforcement neste plano é manual via Q2 acceptance criterion ("Rule 9 verdict block populated"), não auto via hard gate. Documentado para honestidade: deps-corner Rule 9 enforcement é responsabilidade do executor, não do confidence checker. Se `/discover-confidence` vier a cobrir deps-corner Rule 9 no futuro, retire este DOCUMENT.

### EC-13: Time budget realista para Q4 (7 arquivos + 894-LoC summarizer) pode estourar 1h

- **Risco aceito:** Q4 lista 7 reads (5 summarizer modules + thresholds + summarizer_config) — o maior single read é `summarizer.py` 894 LoC. Tempo estimado de leitura+síntese: ~70-90 min, contra o per-question allocation implicito de 4h Letta / 5 questions Letta = 48 min/Q. Aceito porque per-project stop condition ("budget exhausted → BLOCKED") já cobre o overflow honestamente. Halt-loop driver não vai pre-shrink scope de Q4; vai DEIXAR Q4 consumir mais e marcar Q5 BLOCKED se o restante não couber. Trade-off explicit: Q4 quality > Q5 coverage breadth. Se Q5 ficar BLOCKED, blueprint surface o gap; humano decide se re-roda.

### EC-14: ADRs D4 + D5 declaram schema-touching invariants no discovery plan

- **Risco aceito:** Discovery plans tipicamente declaram ADRs sobre COMO investigar (D1 budget, D2 langmem-via-web, D6 infra). v0-4a plan também inclui D3 (scoring strategy default), D4 (`derived_from` mandatory), D5 (LLM-importance cache contract) — esses são contract-shaping decisions que tocam DB schema, error types, DIP shape. Tecnicamente esses pertencem mais ao `/to-plan v0-4a` downstream. Aceito porque: o blueprint do discovery vai coletar EVIDÊNCIA de Letta/Mem0 sob esses lentes (e.g., Q4 column "provenance field yes/no/cite line" só faz sentido se já decidimos que `derived_from` IMPORTA). ADRs no discovery plan FRAME o lens de investigação; a decisão FINAL de schema fica no `/to-plan`. Se /to-plan re-abrir D3/D4/D5, é dele o direito.

---

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 (tests letta) | 1 | 0 | 1 (EC-4) | 0 |
| Q2 (deps letta+npm) | 2 | 1 (EC-3) | 0 | 1 (EC-12) |
| Q3 (tools letta) | 1 | 0 | 1 (EC-5) | 0 |
| Q4 (techniques letta summarizers) | 3 | 1 (EC-2) | 1 (EC-6) | 1 (EC-13) |
| Q5 (techniques letta sleep-time) | 2 | 0 | 2 (EC-6, EC-7) | 0 |
| Q6 (techniques mem0) | 3 | 1 (EC-1) | 2 (EC-8, EC-11) | 0 |
| Q7 (prior_art arXiv) | 1 | 0 | 1 (EC-9) | 0 |
| Q8 (prior_art langchain) | 1 | 0 | 1 (EC-10) | 0 |
| Cross-cutting (D4+D5 placement) | 1 | 0 | 0 | 1 (EC-14) |

**Veredicto:** DISCOVERY PLAN PRECISA DE AJUSTE

3 MUST FIX são todos de **execution feasibility** (read strategy para arquivos grandes + candidate list consistency) — não tocam ADRs, escopo, ou shape do blueprint. São tweaks aos Fase A methods de Q2, Q4, Q6 + 1 referência cross-Q (Q4 ordering antes de Q5). 7 SHOULD TEST viram halt-loop checkpoints adicionais. 3 DOCUMENT viram ADR notes ou rationale rows.

Sugiro bumpar plano v1.0 → v1.1 com:
1. Q2 Fase A: lock em 3 candidates Node WebFetch (`bullmq`, `node-cron`, `croner`); demais ficam em followup informativo.
2. Q4 Fase A: "head 200" → "Read full file (894 LoC)" para `summarizer.py`; demais summarizers já entram full naturalmente (compact 20kb / self 13kb / sliding 10kb — todos <2000 lines).
3. Q6 Fase A: substituir "head 400 lines then grep" por offset strategy explícita (`wc -l → grep -n class+def → Read offset/limit por hit, max 3 Reads`).
4. Adicionar 7 halt-loop checkpoints novos (EC-4 a EC-11 except EC-6 already covered between Q4/Q5).
5. Adicionar 3 DOCUMENT notes na seção apropriada (D2/D3 ADR notes ou Followups table) — sem mudar o número de ADRs ou questions.

Após v1.1 absorption, plano fica pronto para `/discover-execute v0-4a-reflection-pipeline`.

---

## Anti-patterns explicitamente NÃO cometidos

- NÃO sugeri clonar LangMem (D2 já documentou web-only — respeitado)
- NÃO propus Question Q9 ou Q10 (budget cap respeitado)
- NÃO especulei sobre futuras versões de Letta/Mem0
- NÃO sugeri "verificar cada citação palavra-por-palavra" — confio no plano; flag só onde claim é verificável e potencialmente errado (EC-1, EC-2, EC-3 são todos baseados em `wc -l` mensurável)
- NÃO propus retry/fallback/caching no halt-loop além do que já existe — apenas 1 fallback (EC-10 GitHub README) onde a alternativa primária pode falhar deterministicamente
