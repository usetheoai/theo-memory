# Edge Case Review — adapters-stub-embedder-llm-cycle-1

Data: 2026-06-01
Tasks analisadas: 6 (T0.1 + T1.1 + T1.2 + T2.1 + T3.1 + T4.1)
Edge cases encontrados: 11 (MUST FIX: 1, SHOULD TEST: 6, DOCUMENT: 4)

## MUST FIX

### EC-1: L2 norm zero — divisão por zero produz NaN-vector

- **Task afetada:** T1.1
- **Família:** Format / State
- **Cenário:** Se `embed(t)` computa o vetor 1536-dim e ANTES de normalizar todos os componentes são 0 (ou somam zero magnitude), `l2Normalize(v)` faz `v[i] / ||v||` com `||v|| === 0` → produz `NaN` em todos os 1536 slots. Mesmo que probabilidade matemática seja ~2^-128 (MD5 first 8 bytes all-zero + LCG never emits 0 with prime modulus + non-zero seed), defensive code é 1 linha.
- **Impacto:** NaN-vector inserido em pgvector causa `ERROR: NaN not allowed in vector` na coluna `vector(1536)` — write pipeline crash. Pior: se INSERT swallows NaN silenciosamente, recall semântico fica corrompido.
- **Fix sugerido:** No `l2Normalize`, antes de dividir: `if (norm < 1e-30) { return new Array(1536).fill(0); }` (fallback safe zero-vector + log warn-once). Adicionar como sub-step do T1.1 (≤ 3 linhas). Test correspondente: chamar com seed que ouve teórico-zero AND assert nenhum NaN no output.

---

## SHOULD TEST

### EC-2: Empty string input no embedder

- **Task afetada:** T1.1
- **Teste sugerido:** `test_embed_empty_string_returns_unit_vector_no_nan` — `embed("")` deve retornar 1536-dim unit vector sem NaN. MD5 do empty string é `d41d8cd98f00b204e9800998ecf8427e` (constante conhecida); seed não-zero; LCG funciona. Apenas verifica que a code path para input vazio não crash.

### EC-3: Empty messages array no LLM stub

- **Task afetada:** T1.2
- **Teste sugerido:** `test_generateChat_empty_messages_returns_valid_LLMResponse` — `generateChat([])` deve retornar `{ content: "stub-response:<hex>", role: "assistant" }` (mesmo tag determinístico). `generateResponse([], {type:'json'})` deve retornar `{ facts: [] }` sem crash. Cobre o boundary `concatUserContent([]) === ""`.

### EC-4: Sentence extraction com 0 sentenças válidas

- **Task afetada:** T1.2
- **Teste sugerido:** `test_generateResponse_user_content_with_no_sentence_terminators` — mensagem user com content `"hi there no period"` (sem `.!?`). Asserção: `{ facts: [{ text: "hi there no period" }] }` (1 fact = todo o content) OU `{ facts: [] }` — escolher contract semantics + locked test. Eliminate ambiguidade.

### EC-5: Subpath exports + npm pack — tarball realmente inclui os novos paths

- **Task afetada:** T2.1
- **Teste sugerido:** `tests/integration/publish-readiness.test.ts` (existente per `architecture.md § 10.1`) — extender para também grep `npm pack --dry-run` por `src/embedders/stub.ts` + `src/llms/stub.ts` + `src/embedders/index.ts` + `src/llms/index.ts`. Garante que `files` array em package.json não exclui acidentalmente.

### EC-6: Root index.ts NÃO re-exporta deterministic classes (ADR D4 enforcement)

- **Task afetada:** T2.1
- **Teste sugerido:** `test_root_index_does_not_export_deterministic_stubs` em `src/__tests__/index.test.ts` — `import * as root from "../index.js"; expect(root.DeterministicStubEmbedder).toBeUndefined(); expect(root.DeterministicStubLLM).toBeUndefined();`. Belt-and-suspenders para o ADR D4. Cumpre disciplina opt-in para os 52 adapters futuros.

### EC-7: tsconfig.contract.json widening surfaces existing dormant defects (transitive expansion gotcha)

- **Task afetada:** T0.1
- **Teste sugerido:** ANTES do GREEN, rodar `npm test` e capturar o baseline exato (`544 passed | 2 skipped`). DEPOIS do widening (config-only change, sem novos arquivos `.ts`), re-rodar e assert que o baseline é IDÊNTICO. Se transitive expansion (`testing.md § Typecheck scope gotcha`) revelar defect dormente, capturado aqui antes de qualquer GREEN code.

---

## DOCUMENT

### EC-8: Stub LLM extraction shape pode divergir do contrato real de `src/core/extraction/`

- **Risco aceito:** Plan T1.2 § Deep Dives diz "verifying extraction contract... by reading src/core/extraction/*.ts during RED test authorship." Se o shape ali for `{ memory: [...] }` (Mem0-like) em vez de `{ facts: [...] }`, RED test captura. Documentado; aceitar como known-unknown que TDD resolve.

### EC-9: NaN vector se MD5 hash colide com all-zeros (improvável)

- **Risco aceito:** Mesmo após EC-1 MUST FIX (guard com zero-vector fallback), documentar que o evento estimated `< 2^-64 per input` quase nunca dispara. Não é over-engineering adicionar log warn-once quando dispara — útil para debug. Documentar em JSDoc do `l2Normalize` helper.

### EC-10: Demo singleton boot — env vars NÃO mutáveis em runtime (Next.js HMR)

- **Risco aceito:** `process.env.THEOMEM_USE_STUB_ADAPTERS` é lido apenas no boot do singleton via `globalThis._themory_demo_singleton` (pattern existente). Mudar env mid-session requer `npm run dev` restart. Já é a convenção da demo; documentar no README "Optional env" callout junto com a row do var.

### EC-11: Combinação `THEOMEM_USE_STUB_ADAPTERS=1` + `THEOMEM_EVICTION_DEMO=1`

- **Risco aceito:** Hotfix `b2909ff` desabilita `resolveEviction` independentemente de `THEOMEM_EVICTION_DEMO`. Com stubs + eviction wiring "ON via env var" mas DISABLED na prática, comportamento é stub adapter + no eviction → demo funciona, F-T4.1-2 NÃO reproduz (eviction não dispara). Documentar que F-T4.1-2 debug cycle (próximo) precisa REMOVER o hotfix antes de testar a race com stubs. Out-of-scope para Cycle 1.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 0 | 1 | 0 |
| T1.1 | 2 | 1 | 1 | 0 |
| T1.2 | 2 | 0 | 2 | 0 |
| T2.1 | 2 | 0 | 2 | 0 |
| T3.1 | 2 | 0 | 0 | 2 |
| T4.1 | 0 | 0 | 0 | 0 |
| Cross-cutting | 2 | 0 | 0 | 2 |
| **Total** | **11** | **1** | **6** | **4** |

**Veredicto:** PLANO PRECISA DE AJUSTE — 1 MUST FIX (EC-1 NaN-vector guard em `l2Normalize`). Absorver como sub-step de T1.1 com 1 linha de código + 1 test. Plano v1.0 → v1.1 após absorção; re-rodar `/plan-confidence` para validar.
