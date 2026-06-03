# Edge Case Review — v0-8-independent-benchmark-reproduction

**Data:** 2026-06-02
**Plano analisado:** `.claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md` (v1.0)
**Tasks analisadas:** 11 (T0.1, T1.1, T1.2, T2.1, T3.1, T4.1, T5.1, T6.1, T6.2, T6.3, T7.1, T7.2, T8.1, T8.2)
**Edge cases encontrados:** 14 (MUST FIX: 6, SHOULD TEST: 6, DOCUMENT: 2)

## MUST FIX

### EC-1: LLM-judge response não-JSON quebra parser sem fallback

- **Task afetada:** T1.2 (LLM-judge orchestrator)
- **Família:** Format
- **Cenário:** GPT-4o ou Claude-sonnet ocasionalmente retornam texto fora do JSON schema esperado (`{"label": "CORRECT", "reasoning": "..."}`), p.ex. wrapping em markdown code fences, prefixo "Sure! Here's the JSON:", ou texto antes/depois do objeto. Mem0 mitigava via `mem0.memory.utils.extract_json` (per blueprint Q2 evidence). Plano v0.8 não menciona parser robusto.
- **Impacto:** `JSON.parse(rawResponse)` throws → judge call falha → panel aggregation silenciosamente perde 1 voto OU runner crash inteiro. Em LongMemEval × 500 questões × 3 judges = 1500 parses; mesmo 0.1% taxa de falha = 1-2 perdas por run.
- **Fix sugerido:** Em T1.2 Files to edit adicionar `src/benchmarks/llm-judge/json-extractor.ts` — extrai primeiro `{...}` válido da resposta via regex `/\{[^{}]*"label"[^{}]*\}/`; se 0 matches, registra `partial: { rawResponse, parseError }` e retorna `null` (panel aggregator trata como "judge abstain"). Test em RED: `test('extractJudgeJson handles markdown-wrapped response')`.

### EC-2: All-judges-fail (network/quota out) crasha runner sem politica explícita

- **Task afetada:** T1.2 + T4.1 (runner contract com panel)
- **Família:** State
- **Cenário:** Durante uma run de 500 questões, ocorre quota exhaustion OU network outage AMBOS para OpenAI E Anthropic (e.g., AWS US-East-1 down). Panel retorna 0 labels para várias questões consecutivas. Plano não declara o que runner faz: aborta run inteira? continua e marca essas questões como `judge_failure`?
- **Impacto:** runner crash mid-iteration → resultado parcial não-salvo (perde 200+ questões já avaliadas). v0.8 reproducibility fica comprometida.
- **Fix sugerido:** Em T4.1 acceptance criteria adicionar "if `judgePanel.judge()` returns null/empty for 3 consecutive questions, runner pauses 60s and retries; if still failing after 1 retry, runner persists partial results to disk and emits non-zero exit code with `partial_judge_failure: N` field". Em T1.2 Deep Dives adicionar `LlmJudgePanel.judge()` return type union `JudgeOutcome | null`.

### EC-3: pricing-table.json missing model retorna $0 silenciosamente

- **Task afetada:** T4.1 (cost-tracker)
- **Família:** Format
- **Cenário:** Adapter usa modelo não declarado em `pricing-table.json` (e.g., `gpt-4-turbo-preview` em vez de `gpt-4o-mini`; ou vendor SDK retorna model name com versão sufixada `gpt-4o-2024-08-06`). Cost-tracker lookup retorna `undefined` → multiplicação por undefined → `NaN` OR silent zero.
- **Impacto:** matrix publishes `cost/session = $0.00` for that adapter — false reporting in roadmap row 10 deliverable; defeats the v0.8 "honest benchmark" goal.
- **Fix sugerido:** Em T4.1 Tasks adicionar "cost-tracker throws `PricingTableMiss(modelName)` typed error when model absent; runner catches + persists cost = NaN with `pricing_table_miss: true` flag per question". Em T8.1 acceptance adicionar "docs/benchmarks/v0.8.md MUST flag any pricing_table_miss occurrences with 'cost N/A — see notes'".

### EC-4: Vitest default 5s timeout incompatível com benchmark runs (~5-30 min)

- **Task afetada:** T5.1, T7.1, T7.2 (benchmark e2e tests)
- **Família:** Timing
- **Cenário:** Vitest default `testTimeout` é 5000ms. LongMemEval has 500 questions × ~2-5s per question (LLM-judge + adapter call) = 30-50 min wall-clock. Test will fail immediately with `Test timed out in 5000ms`.
- **Impacto:** T5.1 / T7.1 / T7.2 tasks ALL fail validation gate even if implementation is correct. Plan goal test never passes.
- **Fix sugerido:** Em T5.1 Files to edit adicionar `vitest.benchmark.config.ts` (NEW) com `testTimeout: 60 * 60 * 1000` (60 min); script em `package.json` `"test:benchmark"` invoca essa config. Em T8.2 acceptance ajustar para "matrix-publication.test.ts roda via vitest.e2e.config.ts standard (rápido, file I/O only)". Adicionar paragraph em Phase 5 Deep Dives explicando timeout discipline.

### EC-5: TheMemory adapter usa só conversationId como user_id — perde multi-speaker contexts

- **Task afetada:** T3.1 (TheMemory adapter)
- **Família:** State / Boundary
- **Cenário:** Per blueprint Q1 finding, Mem0's `MemorySearch.answer_question(speaker_1_user_id, speaker_2_user_id, question, ...)` passa DOIS user_ids — porque conversas têm DOIS interlocutores e cada um tem perspectiva diferente. LongMemEval `longmemeval_oracle.json` schema tem field `speaker` per turn; LoCoMo tem `speaker_a` + `speaker_b`. Plan T3.1 sketch uses só `corpus.conversationId` → `memory.user(userId).remember(...)` → ambos os speakers misturados sob mesmo userId.
- **Impacto:** TheMemory's three-tier scope (User / Session / Agent) é semanticamente errado pra benchmarks multi-speaker; recall@10 reportado vai ser artificialmente inflado OR confuso. Pior: scores publicados em docs/benchmarks/v0.8.md serão dishonest se metodologia não-reflete fixture structure.
- **Fix sugerido:** Em T3.1 Deep Dives sketch trocar `userId = corpus.conversationId` para `speakerId = item.metadata.speaker || 'unknown'; const scopedUserId = \`${corpus.conversationId}::${speakerId}\``. Em BenchmarkCorpusItem.metadata adicionar `speaker?: string` field. Em T0.1 type design adicionar mention. Em T3.1 acceptance criteria adicionar "test('TheMemory adapter respects speaker boundary in corpus.items[i].metadata.speaker')".

### EC-6: wget ausente em macOS dev machines + Google Drive fetch quebra com curl básico

- **Task afetada:** T2.1 (fixture downloader bash)
- **Família:** Input / Resource
- **Cenário:** macOS NÃO ship com `wget` por default (apenas `curl`). Plan T2.1 mostra `wget https://huggingface.co/...` mas user em mac sem brew install wget verá `wget: command not found`. Pior — LoCoMo fallback path em plano é "Mem0's Google Drive mirror" e Google Drive direct-download URLs require complex handshake (cookies + confirm token) que `curl -O` simples NÃO consegue.
- **Impacto:** Phase 2 deliverable não funciona para grande parte dos developers (mac users + qualquer um sem brew wget). Reproducibility runbook em docs/benchmarks/v0.8.md fica platform-dependent.
- **Fix sugerido:** Em T2.1 Files to edit trocar `benchmarks/download-fixtures.sh` por TypeScript script `benchmarks/scripts/download-fixtures.ts` que usa `fetch` nativo do Node 20+ (handles redirects automaticamente). Para LoCoMo Google Drive: NÃO fazer fallback automático — emite mensagem "LoCoMo Google Drive download requires browser; visit {URL} manually then place in benchmarks/data/locomo/". Acceptance: "Script runs on macOS + Linux + Windows (via WSL) without requiring wget".

## SHOULD TEST

### EC-7: BLEU lib `natural.BleuScore` em strings vazias

- **Task afetada:** T1.1 (metric primitives)
- **Teste sugerido:** `test('calculateBleuScore handles empty prediction')` — assert returns 0.0 OR throws InvalidInput; `test('calculateBleuScore handles empty reference')` — same; `test('calculateBleuScore handles whitespace-only')` — same; `test('calculateBleuScore handles single-char inputs')` — corner case where n-gram weights >1 are undefined.

### EC-8: Fixture downloader idempotency / resume-from-partial

- **Task afetada:** T2.1
- **Teste sugerido:** `test('download-fixtures script is idempotent — running twice does not re-download already-present files')`. Implementation hint: check file exists + size matches expected before downloading.

### EC-9: Adapter throws mid-iteration — runner partial-results persistence

- **Task afetada:** T4.1
- **Teste sugerido:** `test('runner persists per-question results incrementally — if adapter.search throws on question 250, runner has saved 0..249 to disk')`. Anti-pattern: holding all 500 results in memory + writing single JSON at end → crash loses everything.

### EC-10: Inter-judge agreement com N=1 judge (kappa undefined)

- **Task afetada:** T1.2
- **Teste sugerido:** `test('InterJudgeAgreement returns null + warning when only 1 judge configured')`. Plan default is 2 judges, but config could specify 1. Don't divide-by-zero.

### EC-11: Token computation when `tokensUsed.prompt` is 0 OR negative

- **Task afetada:** T3.1, T6.1-T6.3, T4.1 cost-tracker
- **Teste sugerido:** `test('cost-tracker handles tokensUsed = {prompt: 0, completion: 0} → returns 0.00 cost, NOT NaN')`. Some adapters (e.g., Mem0 if config disabled usage tracking) may report 0.

### EC-12: docs/benchmarks/v0.8.md hand-edit drift breaks matrix-publication test

- **Task afetada:** T8.2
- **Teste sugerido:** `test('matrix-publication parses markdown table robustly across whitespace + cell alignment variations')`. Author hand-fixes a typo in the table; the parser shouldn't break on extra spaces in cells. Or: lock the table to be SCRIPT-GENERATED from result JSONs.

## DOCUMENT

### EC-13: Pricing-table.json staleness as vendor prices change

- **Risco aceito:** Vendor pricing changes weekly/monthly; v0.8 publication is a snapshot. Plan T8.1 already mentions maintenance section. Add note in T4.1 docstring that pricing-table.json carries `fetched_at: YYYY-MM-DD` field + 30-day sunset reminder.

### EC-14: vendor API key absent → adapter integration tests skip cleanly

- **Risco aceito:** Plan T6.1-T6.3 already says "gated on env vars". The skip-clean pattern is established (per `tests/integration/distillation/skill-isolation.test.ts:44` using `describe.skipIf`). Acceptable as-is.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | 0 | 1 (EC-7) | 0 |
| T1.2 | 3 | 2 (EC-1, EC-2) | 1 (EC-10) | 0 |
| T2.1 | 2 | 1 (EC-6) | 1 (EC-8) | 0 |
| T3.1 | 2 | 1 (EC-5) | 1 (EC-11 shared) | 0 |
| T4.1 | 4 | 2 (EC-3, EC-2-shared) | 2 (EC-9, EC-11) | 1 (EC-13) |
| T5.1 | 1 | 1 (EC-4) | 0 | 0 |
| T6.1-T6.3 | 1 | 0 | 0 | 1 (EC-14) |
| T7.1, T7.2 | 1 | 1 (EC-4-shared) | 0 | 0 |
| T8.1 | 0 | 0 | 0 | 0 |
| T8.2 | 1 | 0 | 1 (EC-12) | 0 |
| **Total (deduped)** | **14** | **6** | **6** | **2** |

## Veredicto

**PLANO PRECISA DE AJUSTE** — 6 MUST FIX devem ser absorvidos no plan v1.1 antes de `/plan-confidence`:

1. **EC-1** (LLM-judge JSON parse) — adicionar `json-extractor.ts` em T1.2
2. **EC-2** (all-judges-fail) — declarar policy em T4.1 acceptance + T1.2 return type union
3. **EC-3** (pricing-table miss) — `PricingTableMiss` typed error em T4.1
4. **EC-4** (vitest timeout) — `vitest.benchmark.config.ts` NEW + `test:benchmark` script
5. **EC-5** (multi-speaker scope) — `speaker` field em BenchmarkCorpusItem.metadata + scoped userId em T3.1
6. **EC-6** (wget portability) — substituir bash script por TypeScript com fetch nativo em T2.1

Os 6 MUST FIX são todos solidos: cada um tem 1-frase fix + caso documentado de FA. EC-5 em particular é crítico — sem ele, scores publicados em docs/benchmarks/v0.8.md ficariam metodologicamente incorretos.

As 6 SHOULD TEST adições aos campos TDD são curtas (1 linha cada). As 2 DOCUMENT são notas inline.

**Próximo passo (cycle-plan):** bumpar plan v1.0 → v1.1 incorporando os 6 MUST FIX + 6 SHOULD TEST → invocar `/deps-audit v0-8-independent-benchmark-reproduction` (cycle-plan v1.1 mandatório antes de /plan-confidence) → `/plan-confidence v0-8-...`.
