# Edge Case Review — adapters-stub-embedder-llm-cycle-1-fixes

Data: 2026-06-01
Tasks analisadas: 10 (T0.1, T0.2, T0.3, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1)
Edge cases encontrados: 11 (MUST FIX: 1, SHOULD TEST: 4, DOCUMENT: 6)

## MUST FIX

### EC-1: Marker format mismatch — em-dash `—` vs colon `:` separator faz `check_wiring.py` falhar

- **Task afetada:** T0.1
- **Família:** Format
- **Cenário:** O plano (ADR D1 § "Recommended action") propõe markers com `—` (em-dash) entre `<symbol>` e `<reason>`:
  ```
  <!-- ADR-DEFER-WIRING-B: DeterministicStubEmbedder — pillar (b) deferred to F-T4.1-2 ... -->
  ```
  Mas `.claude/skills/implement/scripts/check_wiring.py:165` exige a regex:
  ```python
  rf"<!--\s*ADR-DEFER-WIRING-B:\s*{re.escape(symbol)}\s*:\s*[^>]+?-->"
  ```
  O separador entre `{symbol}` e `reason` é **`:` literal**, não em-dash. Markers com `—` NÃO casam → script retorna verdict `HALT` → CRITICAL F-wire-1 NÃO é resolvido pela T0.1 → entire fix-up cycle stuck.
- **Impacto:** T0.1 "GREEN" check (`check_wiring.py --symbol DeterministicStubEmbedder` PASS) FALHA silenciosamente. Plan declara success mas o gate ainda fire. Halt-loop iteraria sem progresso.
- **Fix sugerido:** Trocar em-dash por colon em todas as 3 occurrences do marker no plano (ADR D1 + T0.1 Files to edit + T0.1 Acceptance Criteria):
  ```
  <!-- ADR-DEFER-WIRING-B: DeterministicStubEmbedder: pillar (b) deferred to F-T4.1-2 debug cycle which will land tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts -->
  ```
  Plan v1.0 → v1.1 absorvendo este EC; trivial 3-char swap em 3 lugares.

---

## SHOULD TEST

### EC-2: Pipeline-shape input com multi-linha + role-prefix + sentence-terminators combinados

- **Task afetada:** T1.1
- **Teste sugerido:** `test_generateResponse_strips_role_prefix_from_pipeline_format_input` — construir messages = `[{role:'user', content:'user: I am Paulo.\nassistant: Nice.\nuser: I work at TheoCloud. My language is TS.'}]`, chamar `generateResponse({type:'json'})`. Assertar: (a) `json.memory` não vazio; (b) nenhum item de `json.memory` tem `text` começando com `/^(user|assistant|system):/i`; (c) pelo menos 1 item tem `text === 'I am Paulo'` (sentence-split funcionou após strip). Isso valida que strip + sentence-split compõem corretamente, NÃO apenas que strip isolado funciona.

### EC-3: T2.3 regex deve aplicar TAMBÉM ao `generateResponse({type:'text'})` (linhas 119-130)

- **Task afetada:** T2.3
- **Teste sugerido:** O plano cita "lines 40, 47" — ambas no bloco `generateChat`. Mas existe um terceiro caminho `generateResponse({type:'text'})` em `stub.test.ts:119-130` que assertaTODO `expect(text.text).toBe(chat.content)`. Após T2.3, adicionar assertion `expect(text.text).toMatch(/^stub-response:[0-9a-f]{4}$/)` ali também — garante contract uniformity em todas as superfícies que retornam `stub-response:<hex>`.

### EC-4: T0.1 deve DRY-RUN `check_wiring.py` no RED phase, não esperar T4.1 validation

- **Task afetada:** T0.1
- **Teste sugerido:** O plano descreve "RED: grep returns 0 + script returns HALT". Mas se EC-1 (em-dash vs colon) escapar revisão, o `grep` literal `'ADR-DEFER-WIRING-B: DeterministicStubEmbedder'` ainda retornaria 1 (grep não checa o separador colon após o symbol), mascarando o defeito até T4.1. Sub-test: depois de adicionar os markers no GREEN phase, IMMEDIATELY rodar `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder --deferral-path .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` e assertar exit code 0 + stdout contém `"status": "DEFER"`. Isso é o teste real do contract, não o grep aproximado.

### EC-5: T0.3 CHANGELOG placement order — múltiplos `### Added` blocks em `[Unreleased]`

- **Task afetada:** T0.3
- **Teste sugerido:** Inspecionar `CHANGELOG.md` linhas 1-50 antes de implementar: existem AT LEAST 3 blocos `### Added` interleaved com `### Changed` dentro de `[Unreleased]` (estilo cumulativo do Keep a Changelog onde cada commit append). Plan diz "topmost" mas isso é ambíguo. Sub-test: assertar entry inserido como NOVO `### Added` block IMEDIATAMENTE após `## [Unreleased]` header (não dentro de um Added existente, não no topo absoluto do arquivo). Plano deve documentar a convenção: "insert new `### Added` block as first child of `[Unreleased]`, preserving existing blocks in chronological order downward".

---

## DOCUMENT

### EC-6: T1.2 edita o SOURCE PLAN v1.1 → v1.2 — "plan drift" risk per `cycle-review.md § Hard gates #2`

- **Risco aceito:** A regra `cycle-review.md § Hard gates #2` define plan drift: "if plan was edited AFTER /implement started: FLAG as BLOCKER". T1.2 edita o `adapters-stub-embedder-llm-cycle-1-plan.md` (source plan) APÓS o /implement do source cycle ter terminado. Qualquer re-run do `/review adapters-stub-embedder-llm-cycle-1` (não deste fix-up cycle) capturaria plan drift via `git log -p` no plan file. Mitigation declarada no ADR D3 + plan EC-B accepted: "honesty correction documented in CHANGELOG; v1.2 frontmatter notes the trigger". Defensible mas é um precedente que pode ser invocado erradamente em futuros cycles. Anotar explicitamente no commit de T1.2: `docs(plan)(adapters-cycle-1-fixes): source plan v1.1→v1.2 — HONESTY correction only, NOT scope drift (T1.2 / F-arch-3)`.

### EC-7: T0.1 amend validation report — audit-trail edit precedent

- **Risco aceito:** `.claude/knowledge-base/reviews/{slug}-implement-validate-*.md` é audit-trail; `audit-trail-rotation.md` define que esses files são "moved to `_archive/` after 30 days post PR-merge" — sem cláusula de "edit in place". Amend L46 cria precedente para editar reports retrospectivamente. Defensible neste caso (rationale fabricada precisa ser removida per Inquebrável Rule 3) mas merece nota explícita no commit + `audit-trail-rotation.md` follow-up para definir a política. Não bloqueia este cycle.

### EC-8: T3.1 F-arch-4 `v[i]!` substitution — `.at(i) ?? 0` silently masks out-of-bounds

- **Risco aceito:** O plano oferece duas opções: `v.at(i) ?? 0` OU manter `v[i]!` com comentário. Optar pela substituição `.at(i) ?? 0` MUTA semantics: out-of-bounds `i` retornaria `0` silently, mascarando bugs futuros. A loop em `l2Normalize` (line 72-74) é `for (let i = 0; i < v.length; i++)` — `i` é bounded por construção. Manter `v[i]!` com comentário explicativo (`// noUncheckedIndexedAccess: i bounded by loop`) é fail-fast (assertion throws) e self-documenting. Sugestão: travar opção (b) "comentário explicativo" no ADR — não deixar a escolha aberta em T3.1.

### EC-9: T1.1 strip-prefix pode falso-positivar em texto legítimo "user:" mid-content

- **Risco aceito:** Se um consumer escrever `messages = [{role:'user', content:'I once chatted with someone who said: user: I quit. End quote.'}]`, o `/^(?:user|assistant|system):\s+/gm` com flag `m` matcha QUALQUER linha começando com `user:` — incluindo aquela citação. Strip removeria `user: ` da citação. Probabilidade: baixa (quoting chat logs literalmente raro). Mitigation: JSDoc nota "best-effort strip; legitimate prose containing 'user:'/'assistant:'/'system:' at line-start will be affected. Stub is `@experimental — debug only`." No production OpenAI adapter, esta heurística não é aplicada.

### EC-10: T2.1 cumulative test runtime impact — 52-adapter portfolio scaling

- **Risco aceito:** Cada novo adapter cycle adiciona 1 `it()` block em `publish-readiness.test.ts` com 1 `npm pack --dry-run --json` execution (~3s). Para os 52 adapters do roadmap, isso é ~150s adicionais no test:integration suite. Defensible (test:integration roda fora do hot loop) mas anotar no roadmap follow-up para extrair `npm pack` output via `beforeAll` shared-state quando o teste crescer. Por enquanto YAGNI.

### EC-11: T4.1 expected test count assertion approximate

- **Risco aceito:** Plan T4.1 diz "test count 570 + (3 new) = 573 PASS". Mas T1.1 adiciona 1 (pipeline-shape test), T2.1 adiciona 1 (publish-readiness it() block), T2.2 adiciona "1 cross-run determinism" — não claro se é nova `it()` ou apenas extend logic da existente (linha 58-64 do stub.test.ts), T2.3 modifica existentes (no count delta), T3.1 sem test changes. Conta correta é provavelmente 573 mas pode ser 574 se T2.2 ficar como nova `it()` block. Ajustar empíricamente em T4.1; não bloquear gate em strict count.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 2 | 1 | 1 | 0 |
| T0.2 | 0 | 0 | 0 | 0 |
| T0.3 | 1 | 0 | 1 | 0 |
| T1.1 | 2 | 0 | 1 | 1 |
| T1.2 | 1 | 0 | 0 | 1 |
| T2.1 | 1 | 0 | 0 | 1 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 1 | 0 | 1 | 0 |
| T3.1 | 1 | 0 | 0 | 1 |
| T4.1 | 1 | 0 | 0 | 1 |
| Cross-cutting (audit-trail policy + plan drift) | 2 | 0 | 0 | 2 |
| **Total** | **11** | **1** | **4** | **6** |

**Veredicto:** PLANO PRECISA DE AJUSTE — 1 MUST FIX (EC-1 marker format mismatch — em-dash vs colon faz `check_wiring.py` regex falhar). Absorber como plan v1.0 → v1.1: trocar 3 occurrences de `—` (em-dash) por `:` (colon) em ADR D1 + T0.1 Files to edit + T0.1 Acceptance Criteria. Adicionalmente, considerar absorver EC-4 (`check_wiring.py` dry-run dentro de T0.1 RED/GREEN phase) como SHOULD TEST mandatório — é o único teste real do contract; greps aproximam mas não validam o regex completo. Após v1.1: re-rodar `/plan-confidence`.
