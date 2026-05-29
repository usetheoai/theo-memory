# Discover Edge Case Review — v0-4b-forgetting-pipeline

Data: 2026-05-26
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/v0-4b-forgetting-pipeline-plan.md`
Research questions analisadas: 8
Edge cases encontrados: 7 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: Q3/Q4 `passage_manager.py` é 1103 LoC — NÃO ≤ 600 como plano assumiu

- **Question afetada:** Q3, Q4
- **Família:** Method
- **Cenário:** Plan diz "Read passage_manager.py FULL (verify ≤ 600 LoC; if larger use offset strategy)". File size REAL é **1103 LoC** — quase 2× a expectativa. Read default (2000 lines) ainda cobre, mas single-pass de 1103 LoC em halt-loop é caro + risk de scope creep para áreas não-relevantes (file has 9 delete functions across lines 767-923 + insert/embed code).
- **Impacto:** Halt-loop spends 30-40min lendo cabeçalho de file em vez de focar nas linhas relevantes.
- **Fix sugerido:** Trocar "FULL (verify ≤ 600)" por "offset strategy: `grep -n 'def delete_\|def evict\|capacity\|TTL\|decay' passage_manager.py` first → `Read offset=<delete-section-start> limit=400` for the bounded delete section (lines ~767-1100)".

### EC-2: Q3 `agent_manager.py` é 3599 LoC — "head 150 lines" cobre só 4%

- **Question afetada:** Q3
- **Família:** Method
- **Cenário:** File is 3599 LoC. Plan says "Read ... agent_manager.py for archival hooks" sem strategy. "Head 150" da v0.4a precedent cobriria 4.2% do file — irrelevante.
- **Impacto:** Q3 archival lifecycle answer fica especulativa porque a porção lida é random.
- **Fix sugerido:** Use `grep -n "archival\|passage\|evict\|delete_memory\|capacity" agent_manager.py` first → `Read offset=<hit> limit=200` for ≤ 3 most relevant hits.

### EC-3: Q2 candidate list ambígua — plan sugere "lru-cache, node-cache, quick-lru OR keyv"

- **Question afetada:** Q2
- **Família:** Scope
- **Cenário:** Mirror direto de v0.4a EC-3. Question text propõe 3 candidates mas com "OR" ambíguo. Halt-loop executor pode escolher quaisquer 3 → reproducibility comprometida.
- **Impacto:** Rule 9 verdict pode variar entre runs se candidates não locked.
- **Fix sugerido:** Lock em 3 specific candidates: `lru-cache` (most popular Node LRU), `quick-lru` (smaller alternative), `keyv` (TTL-friendly multi-backend). `node-cache` informational only via F-followup.

---

## SHOULD TEST

### EC-4: Q1 test file name says "insert", may have ZERO eviction assertions

- **Question afetada:** Q1
- **Halt-loop checkpoint sugerido:** Read `test_insert_archival_memory.py` (185 LoC ✓). If grep `eviction|delete|evict|capacity|threshold` returns ZERO hits, mark Q1 `partial` with reason "test file is INSERT-only stress; archival has no eviction tests at all". This negative-space finding IS the answer for Q1 + reinforces EC-8 cross-cutting observation.

### EC-5: Q6 LangMem WebSearch may not match URL pattern — fallback to github README

- **Question afetada:** Q6
- **Halt-loop checkpoint sugerido:** Same as v0.4a EC-10 pattern. URL lock checkpoint: if FIRST 3 WebSearch results don't match `<title>` contém "forgetting" OR URL contém `/langgraph/reference/memory/`, fallback to `github.com/langchain-ai/langmem/blob/main/README.md`. Allowlist `github.com` covers.

### EC-6: Q7 Ebbinghaus canonical source — `en.wikipedia.org` not in allowlist

- **Question afetada:** Q7
- **Halt-loop checkpoint sugerido:** Try arxiv.org first (search "Ebbinghaus forgetting curve modern reformulation"). If ZERO arxiv results (likely; 1885 paper predates digital archive), add `en.wikipedia.org` to `.claude/rules/discover-web-allowlist.txt` with inline rationale "Ebbinghaus 1885 forgetting curve canonical source for v0-4b discovery (no arxiv mirror; Wikipedia is reference summary with citations)". Plan already flags this via F-allowlist-add-wikipedia followup.

---

## DOCUMENT

### EC-7: OPEN PROBLEM #1 confirmação ahead-of-halt-loop — both Letta + Mem0 are DELETE-only

- **Risco aceito:** Pre-flight grep of `passage_manager.py:767-923` confirma 9 `def delete_*` functions but ZERO `def evict|capacity|TTL|decay`. Letta's archival is DELETE-only (caller-driven), mirroring Mem0's pattern from v0.4a Q6. CLAUDE.md Item 6's framing "**OPEN PROBLEM #1 — no competitor solved this**" is **CONFIRMED before halt-loop runs**. This is excellent positioning evidence for v0.4b — TheMemory's triadic-scored automated forgetting IS innovation across BOTH Letta + Mem0 (probably LangMem too, pending Q6 verification). Document as cross-cutting observation in blueprint; reinforces D3 (triadic signal scope lock) + D4 (long-tail guardrail) decisions.

---

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 (tests letta) | 1 | 0 | 1 (EC-4) | 0 |
| Q2 (deps + npm) | 1 | 1 (EC-3) | 0 | 0 |
| Q3 (tools letta) | 2 | 2 (EC-1, EC-2) | 0 | 0 |
| Q4 (techniques letta passage) | 1 | 1 (EC-1 shared) | 0 | 0 |
| Q5 (techniques mem0) | 0 | 0 | 0 | 0 |
| Q6 (techniques langmem web) | 1 | 0 | 1 (EC-5) | 0 |
| Q7 (prior_art Ebbinghaus) | 1 | 0 | 1 (EC-6) | 0 |
| Q8 (prior_art cache lit) | 0 | 0 | 0 | 0 |
| Cross-cutting (OPEN PROBLEM confirmation) | 1 | 0 | 0 | 1 (EC-7) |
| **Total** | **7** | **3** | **3** | **1** |

**Veredicto:** DISCOVERY PLAN PRECISA DE AJUSTE

3 MUST FIX são todos sobre **execution feasibility** (file size strategies + candidate list lock). Não tocam ADRs, escopo, ou shape do blueprint. Sugiro bump v1.0 → v1.1 com:

1. **Q3/Q4 method update** (EC-1): passage_manager.py 1103 LoC → grep-anchored offset strategy targeting delete section
2. **Q3 method update** (EC-2): agent_manager.py 3599 LoC → grep-anchored offset strategy
3. **Q2 candidate lock** (EC-3): exactly 3 npm WebFetches (`lru-cache`, `quick-lru`, `keyv`); `node-cache` → F-followup
4. **3 halt-loop checkpoints** absorbed (EC-4 negative-space test, EC-5 langmem fallback, EC-6 wikipedia allowlist)
5. **EC-7 cross-cutting observation** added to plan's Context section — "OPEN PROBLEM #1 status pre-confirmed by pre-flight grep"

Após v1.1 absorption, plano pronto para `/discover-execute v0-4b-forgetting-pipeline`.

---

## Anti-patterns explicitamente NÃO cometidos

- NÃO sugeri novo project clone (langmem stays web-only per D2)
- NÃO especulei sobre versões futuras de letta/mem0
- NÃO inflei budget (6h é razoável)
- NÃO propus retry+caching em halt-loop
- NÃO adicionei Q9 ou Q10 (budget cap honored)
