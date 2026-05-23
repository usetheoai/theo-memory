# Discover Edge Case Review — v0-1-local-runtime

Data: 2026-05-22
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/v0-1-local-runtime-plan.md` v1.0
Research questions analisadas: 7 (Q1-Q7)
Edge cases encontrados: 8 (MUST FIX: 2, SHOULD TEST: 4, DOCUMENT: 2)

> **Filosofia aplicada.** O plano declara escopo + métodos + budgets coerentes. Riscos identificados não são teóricos — são consequências mensuráveis do estado dos clones (167 migrações Alembic em Letta, 26 test files em mem0-ts, 489-line `add` em Mem0, etc.). Cada finding propõe um ajuste em ≤1 frase de mudança no plano, sem inventar novas fases.

## MUST FIX

### EC-1: Letta tem 167 migrações Alembic — "ler 2-3 representativas" sem critério de amostragem deixa halt-loop ambíguo

- **Question afetada:** Q5
- **Família:** Method / Scope
- **Cenário:** O plano diz "Read 2-3 representative Alembic migrations" mas `referencia/letta/alembic/versions/` contém **167 arquivos** (verificado via `ls | wc -l`). Sem critério, o halt-loop pode (a) ler arbitrariamente as 3 primeiras alfabeticamente — irrelevantes para o memory schema, (b) tentar ler todas — explode budget, OU (c) ficar indeciso sobre quais 3 escolher.
- **Impacto:** Q5 entrega blueprint vazio OR halt-loop esgota budget de Letta antes de chegar em Q6/Q7.
- **Fix sugerido:** Adicionar à coluna Fase A de Q5 o critério de amostragem: "First Grep `passages\|memories\|archival_memory\|vector` over `versions/*.py` para encontrar as N migrações que tocam o memory schema; depois selecionar as 3 mais relevantes: a primeira que cria a tabela memory + a mais recente que a altera + uma intermediária."

### EC-2: Mem0-ts tem 26 test files — Q4 "3-5 representative" sem critério de amostragem reproduz o mesmo problema de EC-1

- **Question afetada:** Q4
- **Família:** Method / Scope
- **Cenário:** `referencia/mem0/mem0-ts/src/oss/tests/` contém 26 `.test.ts` files (verificado via `find`). Q4 diz "3-5 representative test files" sem dizer COMO escolher. Halt-loop pode arbitrariamente pegar `azure-embedder.test.ts` (irrelevante) ou as 5 primeiras alfabéticas.
- **Impacto:** Q4 entrega caracterização do test pattern baseada em fixtures não-representativas (ex.: testa LLM adapters, não a pipeline write→search).
- **Fix sugerido:** Adicionar à coluna Fase A de Q4 o critério: "First Grep `add\|search\|extraction` sobre os 26 test files para identificar quais exercitam a pipeline write/search (vs adapter unit tests); depois selecionar 3-5 desses como representativos da integration pattern."

## SHOULD TEST

### EC-3: `memory/index.ts` re-read amplification across Q1/Q2/Q3 — halt-loop pode re-Read o mesmo file 3×

- **Question afetada:** Q1, Q2, Q3
- **Halt-loop checkpoint sugerido:** Adicionar à seção "Halt-loop Checkpoints" do plano:
  > "Per-file Read cache: if `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts` (1708 LoC) was Read in a prior question's Fase B, subsequent questions on the same file MUST cite via line range from the prior Read rather than re-Reading the full file. Halt-loop tracks file-read state per discovery run."

### EC-4: Q1 `async add` é 489 lines (507-996) — pode exceder context budget num único Read

- **Question afetada:** Q1
- **Halt-loop checkpoint sugerido:** Adicionar uma nota em Q1's Fase B: "Se o Read de `memory/index.ts:507-996` exceder o context budget restante na iteração, dividir em 3 chunks (507-670, 670-833, 833-996) — um chunk por phase-pair da 6-phase pipeline."

### EC-5: Letta deps são static em pyproject.toml MAS `uv.lock` tem resolved versions — Q6 deve ler AMBOS

- **Question afetada:** Q6
- **Halt-loop checkpoint sugerido:** Refinar Q6's Fase B: "Read BOTH `referencia/letta/pyproject.toml` (declared ranges, e.g. `pgvector>=0.3.0,<0.5`) AND `referencia/letta/uv.lock` (resolved versions, e.g. `pgvector==0.3.4`). The resolved versions are what TheMemory's deps-audit reference for v0.1 plan."

### EC-6: 6h budget total pode ser agressivo dado o tamanho de mem0-ts/memory/index.ts (1708 LoC)

- **Question afetada:** ADR D1 (time budget) + Q1+Q2+Q3 (todas tocam memory/index.ts)
- **Halt-loop checkpoint sugerido:** Adicionar à "Halt-loop Checkpoints" uma nota explícita:
  > "Soft warning checkpoint: if budget restante < 30% AND > 50% das questions ainda blocked/pending, surface honest 'budget at risk' warning antes de emitir promise. The plan's D1 stop conditions cover the hard exhaustion case; this checkpoint surfaces the risk earlier so user can decide bump budget or accept partial blueprint."

  Não bumpa o budget no plano — D1 já tem stop conditions honestas. Apenas adiciona o sinal antecipado.

## DOCUMENT

### EC-7: "6-phase write" / "9-step search" framing vem de ADR-0001 — execute deve reportar o que o código TEM, não forçar a narrativa

- **Risco aceito:** ADR-0001 declara 6 phases + 9 steps como o shape locked. Mas o código real em `memory/index.ts` pode (a) implementar 5 ou 7 phases distintas devido a evolução do Mem0 desde a redação do ADR, OU (b) fundir/separar steps que o ADR conta como 1 ou 2. O blueprint DEVE descrever a realidade do código + citar a divergência se houver, NÃO forçar a contagem 6/9 do ADR.
  Não requer mudança no plano — D2 já diz "Read end-to-end". Apenas confirma explicitamente que o execute reportará realidade, não narrativa.

### EC-8: Q3 tem 3 sub-tópicos (hash dedup + UUID→int + lemmatization) — risco de scope bloat por question já mitigado por D1

- **Risco aceito:** Q3 cobre 3 mecanismos distintos. Risco teórico: a question consome 3× o budget de uma question média. Mitigado pelo per-question Fase A stop condition em D1 (3 retries → BLOCKED). Se um dos 3 sub-tópicos esgotar Fase A, o execute pode marcar Q3 PARTIAL ao invés de full BLOCKED. O plano não precisa de mudança — D1 cobre.
  Documentar para que o execute saiba que PARTIAL é um outcome válido (não failure) para questions multi-sub-topic.

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 (6-phase write) | 2 | 0 | 2 (EC-3, EC-4) | 0 |
| Q2 (9-step search) | 1 | 0 | 1 (EC-3 shared) | 0 |
| Q3 (dedup/uuid/lemma) | 2 | 0 | 1 (EC-3 shared) | 1 (EC-8) |
| Q4 (Mem0 tests) | 1 | 1 (EC-2) | 0 | 0 |
| Q5 (Letta schema + tests) | 1 | 1 (EC-1) | 0 | 0 |
| Q6 (deps) | 1 | 0 | 1 (EC-5) | 0 |
| Q7 (tools / local-dev) | 0 | 0 | 0 | 0 |
| Cross-cutting (D1 budget + ADR framing) | 2 | 0 | 1 (EC-6) | 1 (EC-7) |

**Veredito:** DISCOVERY PLAN PRECISA DE AJUSTE

**Bloqueadores:** 2 MUST FIX (EC-1 + EC-2) — ambos sobre sampling criteria de fixtures que SCALABLEMENTE são grandes (167 migrações Letta, 26 test files Mem0). Sem critério, halt-loop tem ambiguidade que ou esgota budget tentando ler tudo ou produz blueprint baseado em fixtures arbitrárias.

**Recomendação:** absorver EC-1 + EC-2 em revisão v1.0 → v1.1 do plano (~5min de edits). EC-3 a EC-6 entram como halt-loop checkpoint enhancements. EC-7 e EC-8 ficam como notas inline (não requerem mudança estrutural).
