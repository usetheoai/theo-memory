# Edge Case Review — principles-alignment-hardening

Data: 2026-06-04
Tasks analisadas: 7 (T0.1, T1.1, T2.1, T3.1, T4.1, T4.2, T5.1, T6.1)
Edge cases encontrados: 10 (MUST FIX: 2, SHOULD TEST: 5, DOCUMENT: 3)

**Veredicto: PLANO PRECISA DE AJUSTE** — 2 MUST FIX bloqueiam shipping limpo se não absorvidos. Um deles (EC-1) é um **bug pré-existente do v0.1** que este plano SURFACE explicitamente — surfacing without fixing seria violação Inquebrável Rule 3.

## Fronteiras mapeadas por task

| Task | Tipo | Fronteira primária | Estado mutável |
|---|---|---|---|
| T0.1 | Schema migration | Postgres DDL | `memories` table ganha coluna |
| T1.1 | Code + integration test | Postgres INSERT/UPDATE branch + OTel | Row INSERTed OR confirmation_count incrementado |
| T2.1 | DTO widening | TS public contract | Interface `MemoryItem` ganha 2 fields opcionais |
| T3.1 | Code emit + test | OTel span emission | Side-channel observability |
| T4.1 | Code emit + test | OTel span emission | Side-channel observability |
| T4.2 | Pure code + test | In-process candidate rerank | Result set ordering |
| T5.1 | Integration test | Postgres + OTel + pipeline composition | Audit trail |
| T6.1 | Meta-gates | Repo state | Tree state + reports |

---

## MUST FIX

### EC-1: Scope leak via shared `memories.hash` UNIQUE — pré-existente v0.1 bug que T1.1 PIORA

- **Task afetada:** T1.1
- **Família:** State / Boundary / Privacy
- **Cenário:** O schema atual em `src/local/schema.ts:122` declara `uniqueIndex('memories_hash_unique_idx').on(table.hash)` — UNIQUE GLOBAL no hash. Se `user:alice` lembra "Eu gosto de café" → row criada. Se `user:bob` depois lembra a MESMA string → mesmo hash → o INSERT atual REJEITA silenciosamente (defeito v0.1 já existente; consumer não vê problema porque não há sinal). Com T1.1 do plano (`ON CONFLICT (hash) DO UPDATE SET confirmation_count = confirmation_count + 1 RETURNING id, ...`), bob recebe ALICE'S memoryId + Alice's confirmation_count bumpado. Bob acha que tem memória dele; na verdade está vendo memória de Alice. **Cross-scope data leak via dedup**.
- **Impacto:** (a) Privacy leak — bob.recall("café") agora retorna o row de alice (mesmo se recall filtra por scope, o id retornado por remember está no escopo errado); (b) confirmation_count semanticamente errado (bumpado por write fora do escopo); (c) MemoryItem.rejectedAsDuplicate=true para bob é mentira — bob NÃO viu antes; alice viu. Inquebrável Rule 3 violado.
- **Fix sugerido:** **Plano T0.1** muda migration de "ADD COLUMN confirmation_count" para "(a) ADD COLUMN confirmation_count + (b) DROP CONSTRAINT memories_hash_unique_idx + (c) CREATE UNIQUE INDEX memories_hash_scope_unique_idx ON memories (hash, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,''))". **Plano T1.1** `ON CONFLICT (hash, user_id, session_id, agent_id) DO UPDATE`. Backfill: pre-cycle rows mantêm seus IDs; novo UNIQUE composite aceita duplicates cross-scope (semanticamente correto). Adicionar ADR D5 explicitando a quebra do v0.1 UNIQUE global como FIX (não regressão).

### EC-2: Tests pinning `MEMORY_EVENTS` array exhaustivamente quebram em cascata sem listar arquivos

- **Task afetada:** T1.1 + T3.1 + T4.1
- **Família:** Test / Format
- **Cenário:** O array `MEMORY_EVENTS` em `src/core/memory-event.ts:16-30` é `as const` — usado em TypeScript exhaustive switch checks. Múltiplos arquivos em `src/core/__tests__/`, `src/local/__tests__/`, e `tests/integration/` provavelmente fazem `expect(MEMORY_EVENTS).toEqual([...13 strings...])` ou `expect(MEMORY_EVENTS.length).toBe(13)`. Plano T1.1+T3.1+T4.1 adicionam 3 literais (`extraction_zero_facts`, `dedup_collision_confirmed`, `recall_threshold_filtered`) → cada teste pinned quebra. Plano só diz "Tests that pin the event list need a 1-line update" mas não lista arquivos NEM adiciona ao "Files to edit" das tasks.
- **Impacto:** /implement halt-loop fail at GREEN phase com test failures from arquivos não listados em "Files to edit"; cycle-implement.md Stop Condition #4 (plan defect — Files to edit unreachable / non-exhaustive). 3 tasks (T1.1, T3.1, T4.1) precisam revalidar.
- **Fix sugerido:** Adicionar grep gate a Phase 0 (preparation step antes de T0.1): `grep -rln "MEMORY_EVENTS" src/ tests/ | xargs grep -l "toBe(13)\|length.*13\|toEqual.*extraction_started"` — output goes to plan T0.1 "Files to edit" preemptively. Sub-step T0.0: enumerate todos os call sites que pinnam o array; expandir "Files to edit" das tasks T1/T3/T4 para incluir cada um.

---

## SHOULD TEST

### EC-3: MMR `lambda` outside [0, 1] sem validation

- **Task afetada:** T4.2
- **Teste sugerido:** `test_mmrRerank_throws_InvalidScope_on_lambda_outside_unit_interval` — chame `mmrRerank(candidates, lambda=1.5, ...)`; assert throws typed error (semantics: cosine sim ∈ [-1, 1]; combined with lambda > 1 produces non-monotonic ordering). Boundary validate em `src/core/options.ts` zod schema OR em `runRetrievalPipeline` antes de chamar `mmrRerank`. Per architecture.md § 8 (validate at boundaries).

### EC-4: Pre-cycle row backfill semântica — DEFAULT 1 silencia histórico real

- **Task afetada:** T0.1
- **Teste sugerido:** `test_migration_0011_backfills_existing_rows_to_confirmation_count_1` — seed memories com 3 rows pre-migration (via SQL direto); apply migration; assert all 3 têm `confirmation_count = 1`. Documenta no commit body que rows pre-cycle perdem qualquer histórico real de confirmação (essas confirmações simplesmente não foram tracked — DEFAULT 1 é o piso honesto, não fabrica histórico). Inquebrável Rule 3 disclosure: contagem real começa a partir do commit de T0.1.

### EC-5: `emitEvent` quando `tracer` é `undefined` (config.tracer omitted)

- **Task afetada:** T1.1 + T3.1 + T4.1
- **Teste sugerido:** `test_dedup_collision_confirmed_no_op_when_tracer_undefined` — instancie pipeline SEM `tracer` field; trigger dedup-collision; assert (a) operação completa sem throw; (b) nenhum span criado; (c) memoryId retornado correto. Confirma que existing `emitEvent` infra handles tracer-absent gracefully (já testado em outros eventos mas regredir é fácil).

### EC-6: pgvector-store `get` + `list` paths NÃO populam `confirmation_count` no MemoryItem retornado

- **Task afetada:** T2.1
- **Teste sugerido:** `test_pgvector_store_get_returns_memory_item_with_confirmation_count` + `test_pgvector_store_list_returns_items_with_confirmation_count` — write memory; bump confirmation via 2nd remember; chame `.get(id)` E `.list(filters)`; assert returned MemoryItem tem `confirmationCount = 2`. Plan T2.1 foca em `insert` RETURNING projection mas omite read paths — se `SELECT *` está implícito, OK, mas se há projeção explícita em get/list, vai precisar update.

### EC-7: Existing tests com `toEqual({ id, text, ... })` quebram por causa de novas optional fields

- **Task afetada:** T2.1
- **Teste sugerido:** `grep -rln "toEqual.*MemoryItem\|toEqual.*{.*text.*hash.*scope" src/ tests/ | xargs sed -n '/toEqual/,+5p'` (manual audit pré-implementação). Vitest's `toEqual` ignora undefined fields, então optional widening É backward-compat — MAS tests que fazem `expect(result).toMatchObject({...})` com `Object.keys(result).length === N` quebram. Garantir: nenhum teste existente conta keys em MemoryItem; se houver, adicionar como "Files to edit" da task T2.1.

---

## DOCUMENT

### EC-8: Coverage gate (`≥ 90% on src/core/extraction/pipeline.ts + retrieval/pipeline.ts + retrieval/mmr.ts`) não verificável

- **Risco aceito:** `package.json` não tem script `test:coverage` (gap pré-existente, documentado em audits anteriores). Plan T6.1 DoD entry "Coverage on 3 files ≥ 90%" pode não ser enforce-ável at /implement validation gate. Documentar no T6.1: "Coverage gate é manual via `npx vitest run --coverage --include=src/core/extraction/**.ts src/core/retrieval/**.ts` IF the coverage script ships during this cycle; SKIP-WITH-DISCLOSURE otherwise per dogfood-golden-rule.md precedent."

### EC-9: `≥ 40% redundancy reduction` em T4.2 é fixture-dependent

- **Risco aceito:** O threshold de 40% é literatura-aproximado (MMR lambda=0.7 sobre high-collinearity sets típicos). Se as 10 near-paraphrases escolhidas como fixture forem TOO collinear (e.g., só word-order swaps), MMR retira mais; se forem MAIS distintas (synonyms with low overlap), MMR retira menos. Plano T5.1 DoD diz "≥ 40%"; se a primeira run der 35%, opções: (a) retunar fixtures e documentar honestamente (Inquebrável Rule 3 — não esconder), (b) baixar threshold para o observado e documentar por quê. NÃO acceptable: padding fixtures até bater 40% sem disclosure.

### EC-10: Commit ORDER discipline manual

- **Risco aceito:** Plano declara em Dependency Graph que T0 → T1 → T2 → T3+T4 paralelo → T5 → T6. Cycle-implement.md já tem anti-pattern #11 (NEVER ask user for permission between phases) mas commit ORDER violations só são detectadas por cross-validation reviewer post-hoc em T6.1 `/review` run. Mesmo padrão do fixes-cycle-1 EC-1 (commit ORDER NON-NEGOTIABLE) — documentar em Dependency Graph com `git log --oneline` sentinel check.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 2 | EC-1 (compartilhado com T1.1) | EC-4 | — |
| T1.1 | 3 | EC-1 + EC-2 | EC-5 | — |
| T2.1 | 2 | — | EC-6 + EC-7 | — |
| T3.1 | 1 | EC-2 (compartilhado) | EC-5 (compartilhado) | — |
| T4.1 | 1 | EC-2 (compartilhado) | EC-5 (compartilhado) | — |
| T4.2 | 2 | — | EC-3 | EC-9 |
| T5.1 | 1 | — | — | EC-9 (compartilhado) |
| T6.1 | 2 | — | — | EC-8 + EC-10 |

**Veredicto: PLANO PRECISA DE AJUSTE.** Bump v1.0 → v1.1 absorbindo:

- **EC-1 (MUST FIX)**: ADR D5 novo + plan T0.1 expande para incluir DROP + RECREATE UNIQUE com scope columns. Sem isso, T1.1 ATIVAMENTE causa cross-scope data leak — bloquante.
- **EC-2 (MUST FIX)**: Phase 0 sub-step (T0.0?) grep audit dos call sites + expansão das "Files to edit" das tasks T1/T3/T4.
- **EC-3/4/5/6/7 (SHOULD TEST)** absorvidos inline nos TDD blocks das tasks afetadas.
- **EC-8/9/10 (DOCUMENT)** inline nos respectivos DoD/Acceptance/Dependency Graph.

Re-roda `/plan-confidence principles-alignment-hardening` após absorção.

**Nota especial sobre EC-1:** este é um bug v0.1 PRE-EXISTENTE que o plano explicitamente surface através do confirmation_count signal. Fix in-cycle é a posição correta per Inquebrável Rule 3 — surface-with-fix > surface-without-fix > hide. Alternativa "ship sem fix + documentar como Known Limitation" NÃO é honesta porque o consumer agora vê `MemoryItem.rejectedAsDuplicate=true` para writes que NÃO eram dele (bob recebendo flag por write da alice = mentira tipada). MUST FIX é o caminho.
