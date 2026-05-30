# Edge Case Review — voyager-skill-library-fixes-v0-6-1

Data: 2026-05-30
Plan: `.claude/knowledge-base/plans/voyager-skill-library-fixes-v0-6-1-plan.md` v1.0
Tasks analisadas: 14 (T0.1, T0.2, T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T3.3, T4.1, T5.1, T5.2, T5.3, T6.1)
Edge cases encontrados: 11 (**MUST FIX: 2**, SHOULD TEST: 6, DOCUMENT: 3)

---

## MUST FIX

### EC-1: `decodeSkillPayload` rejeita derived skills depois que T0.2 zera `codeLanguage`

- **Task afetada:** T0.2 + T3.3 (interação)
- **Família:** State / Format
- **Cenário:** Pós-T0.2, derived skills são gravadas com `code_language = NULL` no banco. O decoder atual (`rowToSkill` em consolidate.ts:240 e `payloadToSkill` em scoped-skill-memory.ts:48 — após T3.3 ambos viram `decodeSkillPayload`) tem este guard:
  ```ts
  if (codeLanguageRaw !== 'typescript' && codeLanguageRaw !== 'javascript') {
    return null;
  }
  ```
  Quando lê-se de volta uma derived skill (`code_language: null`), o decoder retorna `null` → o row é silenciosamente filtrado. Consequências em cascata:
  - **Recall** (`scoped.recall(query)`) retorna 0 derived skills (depois de elas terem sido criadas com sucesso pelo consolidate). GOAL TEST quebra na assertion `recalled.length === 1`.
  - **Orient phase do consolidate subsequente** (re-run) não vê as derived skills da iteração anterior → re-consolida os mesmos sources de novo → UNIQUE violation no hashFact (T1.1) OU duplica derived skills se T1.1 não cobrir.
- **Impacto:** Quebra THE GOAL TEST (Sub-goal Phase 6 falha). Quebra recall de derived skills em todo consumer. Re-run de consolidate fica inconsistente.
- **Fix sugerido:** Em T3.3, `decodeSkillPayload` deve aceitar `codeLanguage = null` quando `kind === 'skill'` — `codeLanguageRaw == null OR codeLanguageRaw === 'typescript' OR codeLanguageRaw === 'javascript'` é o critério válido. Mesmo tratamento para `code = null`. Adicionar 2 testes ao `payload.test.ts`: (a) skill com code+codeLanguage não-nulos decodifica OK; (b) skill com code=null E codeLanguage=null decodifica OK (não retorna null).

### EC-2: `scoped.forget(skillIdFromOutroRepo)` succeeds — cross-scope deletion vulnerability

- **Task afetada:** T4.1
- **Família:** Permission / State
- **Cenário:** `memory.skills('repo-A').forget(skillIdThatBelongsToRepoB)` chama `LocalMemory.forget(skillIdThatBelongsToRepoB)` (após T4.1). `LocalMemory.forget` é scope-agnostic by design (memoryId é globalmente único — ADR-0004). Logo a deleção de uma skill de outro repo SUCEDE silenciosamente. Pre-existente em v0.6 (vectorStore.delete também sem scope check), mas T4.1 não fecha o gap.
- **Impacto:** Quebra a invariant de isolamento de scope que `scoped-skill-memory.test.ts` declara explicitamente em "isolates skills across distinct repoId values" (que cobre recall mas não forget). Consumer malicioso/distraído faz `memory.skills('any-repo').forget(anyKnownId)` e apaga skill de outro repo + grava history event errado.
- **Fix sugerido:** Em T4.1, antes do delegate, fetch da row + check `payload.agent_id === this.scope.repoId` E `payload.kind === 'skill'`; se não, throw `InvalidScope('skill belongs to a different repoId')`. ≤5 linhas. Adicionar teste: `memory.skills('A').forget(skillFromB.id)` rejeita; o row de B continua presente.

---

## SHOULD TEST

### EC-3: Recall retorna mix de `code: string` + `code: null` — narrowing test

- **Task afetada:** T0.2
- **Teste sugerido:** `test_recall_returns_mixed_code_nullability` em `tests/integration/skills/consolidate-two-skills.test.ts` — após consolidate, faz `recall({includeSuperseded: true})` e assert: encontra 3 rows (2 sources com `code: string`, 1 derived com `code: null`). Type narrowing: `for (const s of recalled) { if (s.code !== null) s.code.length else /* derived */ }` compila sem erro.

### EC-4: 2 clusters distintos produzem texto merged idêntico — UNIQUE conflict no segundo insert

- **Task afetada:** T1.1
- **Teste sugerido:** `test_consolidate_handles_cross_cluster_hash_collision` em `consolidate.test.ts` — seed 4 skills em 2 clusters; LLM stub retorna o mesmo texto merged para ambos. Assert: result.derivedSkills.length === 1 (segundo cluster pulado via catch+log). Sources do segundo cluster NÃO ficam superseded (pillar de atomicity preservada).

### EC-5: `embedBatch` falha → fallback per-row embed

- **Task afetada:** T2.1
- **Teste sugerido:** `test_orient_embed_batch_failure_falls_back_to_per_row` em `consolidate.test.ts` — embedder stub onde `embedBatch` throws "batch endpoint down"; `embed` resolves normalmente. Assert: result.derivedSkills.length > 0 (fallback funcionou). Espelha o padrão de `runExtractionPipeline` em v0.1 (per-row fallback).

### EC-6: `validateProvenance` throws no `drafts[2]` — comportamento do loop?

- **Task afetada:** T2.2
- **Teste sugerido:** `test_consolidate_propagates_provenance_error_mid_loop` em `consolidate.test.ts` — LLM stub retorna 3 drafts; draft[1] tem `derived_from` com id inválido. Assert: throw propaga (não continua). Lock the contract: provenance error é fail-fast, NÃO graceful-skip (alinha com EC-2 do v0.4a plan + Inquebrável Rule 8 fail-cedo).

### EC-7: `PgvectorStore.insertDerivedSkillAtomic` delega corretamente após T3.1

- **Task afetada:** T3.1
- **Teste sugerido:** `test_pgvector_store_delegates_skill_methods_to_extracted_class` em `pgvector-skill-store.test.ts` ou em conformance-extra — `vi.spyOn(skillStore, 'insertDerivedSkillAtomic')` + invoca `pgvectorStore.insertDerivedSkillAtomic(args, sources)` + assert spy called once with same args. Garante que a composition não fez wiring errado.

### EC-8: `decodeSkillPayload` lida com `kind='skill'` mas `description` ausente

- **Task afetada:** T3.3
- **Teste sugerido:** `test_decode_skill_payload_handles_missing_description` em `payload.test.ts` — payload `{kind:'skill', code:'x', code_language:'typescript'}` (sem description) decodifica com `description: ''`. Lock: comportamento graceful, não null. EC-1 acima já cobre `code_language` null; este cobre `description` faltando.

---

## DOCUMENT

### EC-9: ADR D2 do plano cita "v0.7 ships structured-draft LLM extraction" mas v0.7 (per CLAUDE.md roadmap) é "Episodic→Semantic distillation"

- **Task afetada:** Plan-level (ADR D2)
- **Risco aceito:** Plano ADR D2 assume v0.7 como milestone para shipping structured `{code, description}` LLM draft. Mas CLAUDE.md roadmap Item 9 (v0.7) é "Episodic→Semantic distillation pipeline" — não LLM-draft structuring per se. Pode haver alinhamento (v0.7 toca a extraction chain, então faz sentido bundlar) MAS o plano deve declarar explicitamente: "v0.7 OR a dedicated v0.6.2 — decision deferred". KISS para v0.6.1: a accepted-risk fica documentada; consumer sabe que `code === null` em derived skills até futuro release. Sem fix de código necessário.

### EC-10: v0.4a `LocalScopedMemory.reflect()` chain continua usando hash `derived-${Date.now()}...` mesmo depois de T1.1 fixar consolidate

- **Task afetada:** T1.1
- **Risco aceito:** T1.1 só toca consolidate.ts (v0.6 path). v0.4a `LocalScopedMemory.reflect()` em `src/local/index.ts:299` continua usando o hash não-determinístico. Simetria quebrada, mas v0.4a `reflect()` não está no scope deste plano (não foi find do /review v0.6). Documenta como follow-up em `voyager-skill-library-followups.md`: "v0.4a reflect chain should also use hashFact for derived memories; v0.6.1 escopa apenas o caminho de skills". DOCUMENT.

### EC-11: T3.1 acceptance band — sem fallback se `pgvector-skill-store.ts` overshoot 300 LoC

- **Task afetada:** T3.1
- **Risco aceito:** Plano declara `pgvector-skill-store.ts ≤ 300 LoC` como Acceptance Criterion. Sem fallback declarado se overshoot (e.g., JSDoc verboso empurra para 320). Recomenda: aceitar banda `≤ 350 LoC` (still well under 500 architecture.md budget) sem novo split; se cruzar 400, abrir sub-task. ≤1 frase no plano: "Soft target 300; hard cap 500 per architecture.md § Module hygiene."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| T1.1 | 2 | 0 | 1 (EC-4) | 1 (EC-10) |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 1 (EC-5) | 0 |
| T2.2 | 1 | 0 | 1 (EC-6) | 0 |
| T3.1 | 2 | 0 | 1 (EC-7) | 1 (EC-11) |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 1 | 0 | 1 (EC-8) | 0 |
| T4.1 | 1 | 1 (EC-2) | 0 | 0 |
| T5.x | 0 | 0 | 0 | 0 |
| T6.1 | 0 | 0 | 0 | 0 |
| Plan-level | 1 | 0 | 0 | 1 (EC-9) |
| **TOTAL** | **11** | **2** | **6** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE**

Dois MUST FIX (EC-1 e EC-2) precisam ser absorvidos como sub-items nas tasks T0.2/T3.3 e T4.1 respectivamente antes de invocar `/plan-confidence`:

- **EC-1** (decoder rejeita derived skills com codeLanguage=null): é a cascade direta de T0.2. Se não fix, GOAL TEST quebra na Phase 6. Fix é ≤5 LoC no `decodeSkillPayload` + 2 testes.
- **EC-2** (cross-scope forget): real security/correctness gap. Pre-existia em v0.6 mas T4.1 era a oportunidade natural de fechar. Fix é ≤5 LoC no `forget()` + 1 teste.

Os 6 SHOULD TEST são adições de tests específicos nas tasks existentes — ajustar as sections "TDD" das tasks afetadas para incluir os cases explícitos. Os 3 DOCUMENT podem virar notas no plano OU entries em `voyager-skill-library-followups.md`.

**Next steps (chain inquebrável):**
1. Human revisa este report e absorve os 2 MUST FIX no `voyager-skill-library-fixes-v0-6-1-plan.md` → bump para v1.1.
2. Invoke `/deps-audit voyager-skill-library-fixes-v0-6-1` (plano não introduz deps novas — verdict esperado: PASS).
3. Invoke `/plan-confidence voyager-skill-library-fixes-v0-6-1`.
4. Se < SHIPPABLE_WITH_CAVEATS → `/plan-improve`.
5. `/implement voyager-skill-library-fixes-v0-6-1`.
