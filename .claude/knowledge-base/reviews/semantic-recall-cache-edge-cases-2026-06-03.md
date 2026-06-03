# Discover Edge Case Review — semantic-recall-cache

**Data:** 2026-06-03
**Discovery plan analisado:** `.claude/knowledge-base/discoveries/plans/semantic-recall-cache-plan.md` v1.0
**Research questions analisadas:** 8 (Q1 + Q2 tests; Q3 deps; Q4 + Q5 techniques; Q6 + Q7 + Q8 prior_art)
**Edge cases encontrados:** 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

**Veredicto:** **DISCOVERY PLAN PRECISA DE AJUSTE** — 2 MUST FIX precisam absorção antes de `/discover-execute` (ambos sobre URL/identifier rot em prior_art); 3 SHOULD TEST são halt-loop checkpoints; 2 DOCUMENT são caveats ADR-style.

## Pre-validation summary (caught nothing)

Empirical check 2026-06-03 — paths citados no plano confirmados via `ls`:
- ✅ `.claude/knowledge-base/references/mem0/embedchain/tests/` (com `conftest.py` + `chunkers/`)
- ✅ `.claude/knowledge-base/references/mem0/embedchain/pyproject.toml`
- ✅ `.claude/knowledge-base/references/mem0/embedchain/embedchain/cache.py`
- ✅ `.claude/knowledge-base/references/mem0/embedchain/embedchain/config/cache_config.py`
- ✅ `.claude/knowledge-base/references/letta/tests/test_openai_prompt_cache_request_fields.py`
- ✅ `.claude/knowledge-base/references/letta/letta/services/` (existe para cross-grep Q5)

Discovery plan PASS no hard cap `fabricated_citation` para as referências locais. Risco está nos vendor URLs (Q7) + arXiv ID (Q6).

## MUST FIX

### EC-1: Q6 arXiv ID `2310.07831` não foi verificado como sendo o paper GPTCache canônico

- **Question afetada:** Q6
- **Família:** Citation (web — pre-validation)
- **Cenário:** Plano cita `https://arxiv.org/abs/2310.07831` como "GPTCache paper". Durante `/discover-execute`, WebFetch direto desse URL pode retornar:
  - Paper diferente (arxiv ID errado) → snapshot inútil + iteração desperdiçada
  - 404 (improvável mas possível se o paper foi retraído)
  - Cite-by-name colision com outro paper de mesmo nome
- **Impacto:** Q6 ganha snapshot do paper errado, blueprint cita threshold/invalidation falsamente atribuído a "GPTCache" quando é outro paper.
- **Fix sugerido (≤1 frase):** Q6 Fase A method deve INICIAR com `WebSearch query="GPTCache semantic cache LLM paper arxiv"` para resolver o canonical arXiv ID PRIMEIRO; só então WebFetch + snapshot.

### EC-2: Q7 URLs vendor docs hardcoded podem ter sofrido reorg (rot)

- **Question afetada:** Q7
- **Família:** Citation (web — URL stability)
- **Cenário:** Plano cita 2 URLs hardcoded:
  - `python.langchain.com/docs/integrations/llms/llm_caching`
  - `docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/`
  
  LangChain reorganiza docs frequentemente (v0.1 → v0.3 já quebrou muito link); LlamaIndex Sphinx structure também muda. WebFetch direto desses URLs pode 404 ou redirect para página irrelevante.
- **Impacto:** Q7 fica BLOCKED por "url-unfetchable" e o LangChain `RedisSemanticCache` (a citação MAIS canônica do ecossistema Python) some do blueprint — corner prior_art perde 1 das 3 perguntas.
- **Fix sugerido (≤1 frase):** Q7 Fase A method deve EXIGIR `WebSearch query="LangChain RedisSemanticCache" + "LlamaIndex IngestionPipelineCache"` para resolver os URLs canonical correntes ANTES de tentar WebFetch dos hardcoded.

## SHOULD TEST

### EC-3: Q4 pode resolver-se via Q6 (dependency interpretation)

- **Question afetada:** Q4 + Q6
- **Halt-loop checkpoint sugerido:** Quando `/discover-execute` lê `embedchain/cache.py` (Q4 Fase B), se o arquivo IMPORTA de `gptcache` (e não implementa threshold/invalidation próprios), Q4 deve ser marcado `DEPENDS-ON-Q6` e o halt-loop deve processar Q6 ANTES de finalizar Q4. Sem isso, Q4 fica vazio ("vê Q6 para threshold real") sem garantia de que Q6 já rodou. Adicionar checkpoint sob § Halt-loop checkpoints: *"Per-question dependency resolution — se a leitura de Q4 surface uma dependência em Q6 (embedchain importa gptcache), processar Q6 antes de Q4 final"*.

### EC-4: Q8 budget allocation entre 4 vendors não especificado

- **Question afetada:** Q8
- **Halt-loop checkpoint sugerido:** ADR D1 declara Web budget = 15 min / 35k tokens TOTAL para Q6 + Q7 + Q8. Q8 sozinho tem 4 vendor docs (Pinecone + Weaviate + Qdrant + Redis VSS) — sem sub-budget, halt-loop pode gastar todo Web budget em Q8 deixando Q6+Q7 BLOCKED. Adicionar checkpoint: *"Q8 sub-budget cap: ≤ 4 min / 8k tokens TOTAL (≈ 1 min + 2k tokens por vendor); after cap, mark remaining vendors as BLOCKED with reason 'q8-sub-budget-exhausted'"*.

### EC-5: Blueprint precisa de seção explícita "CLAUDE.md claim verdict"

- **Question afetada:** Q1 + Q3 + Q4 (combinadas)
- **Halt-loop checkpoint sugerido:** O claim CLAUDE.md "Mem0/Letta/LangMem do NOT document semantic-recall caching at this layer" é a motivação do discovery. O blueprint precisa de **ONE explicit verdict** (`VERIFIED` | `REFUTED` | `INCONCLUSIVE`) baseado em Q1 + Q3 + Q4 combinados. Sem checkpoint, blueprint pode mencionar embedchain em 3 lugares diferentes sem nunca afirmar se mem0=embedchain ou não, deixando dúvida no consumer de `/to-plan`. Adicionar sob § Halt-loop checkpoints (Global): *"Before BLUEPRINT_COMPLETE, blueprint MUST contain section '## CLAUDE.md claim verdict' with one of {VERIFIED | REFUTED | INCONCLUSIVE} + 1-paragraph rationale citando Q1 + Q3 + Q4 verbatim quotes"*.

## DOCUMENT

### EC-6: Q5 provavelmente retorna "does not transfer" (OpenAI prompt cache ≠ recall cache)

- **Risco aceito:** OpenAI's prompt cache (`prompt_cache_key` / automatic prefix-match) é input-side fixed-prefix caching, NÃO semantic similarity. Q5's pergunta "pattern transfers to recall caching?" tem alta probabilidade de resposta NEGATIVA. Isso é OK e ainda gera evidence útil ("don't blindly copy OpenAI's pattern"). Documentar como ADR amendment OR aceitar inline no D2 ADR: *"Q5 expected outcome: negative-evidence cross-pollination ('pattern does not transfer because OpenAI's cache is input-prefix not semantic'). Negative evidence is also evidence — blueprint cites it explicitly per Inquebrável Rule 3 honesty discipline."*

### EC-7: Q3 pode precisar grep em `[project.optional-dependencies]` extras

- **Risco aceito:** `embedchain/pyproject.toml` pode declarar cache deps em `[project.optional-dependencies]` (e.g., `gptcache` only with `pip install embedchain[gptcache]`) ao invés de `[project.dependencies]` core. Plan's Fase A method (`Grep -E "cache|redis|gptcache|faiss"`) cobre por padrão de texto MAS pode confundir "core dep" com "extras dep" no Rule 9 verdict. Documentar como nuance: *"Q3 Fase B synthesis MUST distinguish [project.dependencies] (always installed) vs [project.optional-dependencies] (gated by extras flag) — affects Rule 9 verdict (ADOPT/REJECT) because optional-dependency adoption has lower risk than core-dependency."*

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 (embedchain tests) | 0 | 0 | 0 | 0 |
| Q2 (letta prompt cache test) | 0 | 0 | 0 | 0 |
| Q3 (embedchain deps) | 1 | 0 | 0 | 1 (EC-7) |
| Q4 (embedchain technique) | 1 | 0 | 1 (EC-3) | 0 |
| Q5 (letta cross-pollination) | 1 | 0 | 0 | 1 (EC-6) |
| Q6 (GPTCache prior_art) | 1 | 1 (EC-1) | 0 | 0 |
| Q7 (LangChain/LlamaIndex prior_art) | 1 | 1 (EC-2) | 0 | 0 |
| Q8 (vendor docs prior_art) | 2 | 0 | 2 (EC-4, EC-5) | 0 |
| **Total** | **7** | **2** | **3** | **2** |

## Veredicto: DISCOVERY PLAN PRECISA DE AJUSTE

2 MUST FIX são absorpções mecânicas (mudança no método de Fase A para WebSearch-first em Q6 + Q7) — não estruturais.

Após v1.0 → v1.1:

1. **Q6 método amendment**: prefixar Fase A com WebSearch para resolver canonical arXiv ID antes de WebFetch
2. **Q7 método amendment**: prefixar Fase A com WebSearch para resolver canonical vendor docs URL antes de WebFetch
3. **§ Halt-loop checkpoints** ganha 3 novos checkpoints: Q4↔Q6 dependency resolution; Q8 sub-budget; CLAUDE.md verdict section
4. **§ ADRs D2 amendment** OR new ADR D6 documenting Q5 expected-negative + Q3 optional-deps nuance

Após absorpção, plano vai para `/discover-confidence` para score estrutural (target ≥ 70 SHIPPABLE_WITH_CAVEATS).

## Próxima ação

Aplicar 7 absorpções inline no plano (~50 LoC patch) → bumpar v1.0 → v1.1 → invocar `/discover-confidence semantic-recall-cache`.

Path: `.claude/knowledge-base/reviews/semantic-recall-cache-edge-cases-2026-06-03.md`
