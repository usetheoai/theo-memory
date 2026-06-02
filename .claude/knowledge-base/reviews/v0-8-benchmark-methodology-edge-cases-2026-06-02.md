# Discover Edge Case Review — v0-8-benchmark-methodology

**Data:** 2026-06-02
**Discovery plan analisado:** `.claude/knowledge-base/discoveries/plans/v0-8-benchmark-methodology-plan.md` (v1.0)
**Research questions analisadas:** 8 (Q1-Q8, em 5 corners)
**ADRs analisadas:** 5 (D1-D5)
**Edge cases encontrados:** 9 (MUST FIX: 2, SHOULD TEST: 5, DOCUMENT: 2)

## MUST FIX

### EC-1: Q3 não tem caminho WebFetch para detectar licença de fixtures hospedados externamente

- **Question afetada:** Q3 (fixtures location/license)
- **Família:** Method
- **Cenário:** durante `/discover-execute`, Q3 descobre via `grep -rn "load_dataset"` que Mem0 baixa LongMemEval/LoCoMo de Hugging Face em runtime (via `datasets.load_dataset('xulin-org/LongMemEval')` ou similar). O plano lista Fase B como "Read evals.py + run_experiments.py + README.md" — esses arquivos sabem QUE baixam, mas não a LICENÇA. A licença vive no dataset card de Hugging Face (web), não no clone Mem0.
- **Impacto:** o blueprint preenche "fixture license: unknown" mesmo quando huggingface.co está allowlisted. v0.8 implementation depois descobre que a licença era MIT-permissiva (ou CC-BY-NC ou similar) só na hora de commitar fixtures — risco de license violation real.
- **Fix sugerido:** adicionar à Fase B de Q3 "if fixtures download at runtime, WebFetch the HF dataset card for license (huggingface.co allowlisted per ADR D3)".

### EC-2: Q8 lista 8 candidates no prose mas halt-loop só exige 2 verdicts — escopo ambíguo + risco de budget burnout

- **Question afetada:** Q8 (Rule 9 verdict on benchmark-runner libs)
- **Família:** Scope
- **Cenário:** o prose de Q8 cita 8 candidates ("BEIR, RAGAS, ARES, RAGElo, LangChain LangSmith Evaluations, NVIDIA NeMo Eval, DeepEval, lightning-eval"). Fase B diz "For each candidate lib: WebFetch GitHub README + WebFetch PyPI" → 16+ WebFetches. Web budget é 2h total. 16 WebFetches × 5 min cada = ~80 min só de Q8, sem deixar budget para Q6/Q7 (que também precisam fetches). O halt-loop checkpoint exige só "≥ 2 verdicts" — descompasso entre escopo prometido e mínimo aceitável.
- **Impacto:** durante /discover-execute, o agente OU (a) tenta os 8 e queima budget burning Q6/Q7 BLOCKED, OU (b) pega 2 aleatoriamente e perde os mais relevantes, OU (c) decide arbitrariamente e fabrica priorização.
- **Fix sugerido:** alterar Q8 para "**investigate up to 5 candidates** in priority order: 1=RAGAS, 2=LangSmith Evaluations, 3=DeepEval, 4=BEIR, 5=ARES. At least 2 must reach explicit ADOPT/REJECT/DEFER verdict; stop at 5 OR when web budget reaches 30 min remaining (reserve for Q6/Q7)."

## SHOULD TEST

### EC-3: Pré-condição de allowlist não tem checkpoint explícito no halt-loop

- **Question afetada:** todas com URL (Q6/Q7/Q8)
- **Halt-loop checkpoint sugerido:** adicionar "**Pre-loop checkpoint** — Before iteration 1, verify all 9 domains from ADR D3 exist in `.claude/rules/discover-web-allowlist.txt` (`huggingface.co`, `aclanthology.org`, `paperswithcode.com`, `mem0.ai`, `www.getzep.com`, `letta.com`, `docs.langchain.com`, `python.langchain.com`, `developer.nvidia.com`). If any missing, HALT with reason 'allowlist not updated per ADR D3' before any WebFetch."
- **Razão:** evita cascata de "domain_not_in_allowlist" em todas Q6/Q7/Q8 (cap automático a 49) caso o humano esqueça de aplicar D3. Fail-fast no setup, não no terceiro fetch.

### EC-4: Q1 não tem fallback caso Mem0 evaluation adapters não compartilhem interface comum

- **Question afetada:** Q1 (Mem0 benchmark runner architecture)
- **Halt-loop checkpoint sugerido:** adicionar "Q1 expected answer shape: identify the abstraction boundary. **If no shared interface exists** (each adapter is a standalone script), capture the duck-type contract (function signatures expected across adapters: `add()`, `search()`, possibly `evaluate()`) — record explicitly as 'no formal interface; duck-type contract' rather than fabricating a class hierarchy."
- **Razão:** Mem0 é Python — duck typing é comum. Forçar uma "interface" inexistente seria fabricação.

### EC-5: Q4 pode perder deps de `[project.optional-dependencies]` extras

- **Question afetada:** Q4 (evaluation/ deps)
- **Halt-loop checkpoint sugerido:** adicionar "Q4 cross-check — verify every `import` in `evaluation/*.py` maps to a dep declared in `pyproject.toml` main OR `[project.optional-dependencies]` extras. Flag any orphan import (declared nowhere) as 'undocumented external dep — Rule 9 risk for our v0.8 reproduction'."
- **Razão:** Mem0 evaluation/ é provavelmente um optional extra (`pip install mem0[evaluation]`). Ignorar extras subestima a Rule 9 footprint.

### EC-6: Q6 e Q7 podem encontrar fixtures HuggingFace gated (auth-required)

- **Question afetada:** Q6 (LongMemEval), Q7 (LoCoMo + DMR)
- **Halt-loop checkpoint sugerido:** adicionar "When WebFetch on a HF dataset URL returns 403/401 or contains 'requires authentication' / 'gated dataset', mark dataset as **'gated — requires HF token + license acceptance'** in the blueprint with snapshot of the response page. Do NOT fabricate fixture availability."
- **Razão:** LongMemEval em particular pode ter sido movido para gated em 2025+. Better honest "gated, manual download required" than fake "freely available".

### EC-7: Q7 combina LoCoMo + DMR — risco do blueprint colapsar em 1 linha em vez de 2

- **Question afetada:** Q7 (LoCoMo + DMR prior_art)
- **Halt-loop checkpoint sugerido:** adicionar "Q7 answer shape MUST produce ≥ 1 row per benchmark (1 row for LoCoMo + 1 row for DMR). If the answer collapses to a single 'they're similar' row, re-iterate Q7 to split."
- **Razão:** colapsar é mais fácil que separar. A análise pragmática quer 2 verdicts independentes ("LoCoMo mais reproduzível", "DMR menos reproduzível", etc.), não um colapso fácil.

## DOCUMENT

### EC-8: Q5 wall-clock pode não estar documentado em README/Makefile

- **Risco aceito:** Mem0 evaluation/ é provavelmente artisanal — vendor não documenta "1 benchmark run takes 8h on AWS p4d.24xlarge" porque rodam internamente. O blueprint deve aceitar "wall-clock not documented; we'll measure during our v0.8 implementation" como resposta válida, NÃO como blocker. Risco aceito porque medir wall-clock nós mesmos é parte natural do trabalho de v0.8 anyway (vamos rodar TheMemory + Mem0 + Zep + Letta no mesmo hardware).

### EC-9: Q6 LongMemEval pode ter múltiplas versões arXiv (v1, v2, v3)

- **Risco aceito:** papers comuns têm 2-3 versões arXiv. O blueprint deve **citar a LATEST** (verificável via WebFetch da página `arxiv.org/abs/{ID}` que mostra "v3" no header) e mencionar versões anteriores APENAS se métricas reportadas mudaram entre versões. Não é blocker; é discipline de citation.

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 (EC-4) | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 1 | 1 (EC-1) | 0 | 0 |
| Q4 | 1 | 0 | 1 (EC-5) | 0 |
| Q5 | 1 | 0 | 0 | 1 (EC-8) |
| Q6 | 2 | 0 | 1 (EC-6 — shared w/ Q7) | 1 (EC-9) |
| Q7 | 2 | 0 | 2 (EC-6 shared + EC-7) | 0 |
| Q8 | 1 | 1 (EC-2) | 0 | 0 |
| All-Q (cross-cut) | 1 | 0 | 1 (EC-3 — allowlist precondition) | 0 |
| **Total** | **9** | **2** | **5** | **2** |

## Veredicto

**DISCOVERY PLAN PRECISA DE AJUSTE** — 2 MUST FIX devem ser absorvidos no plano v1.1 antes de `/discover-execute`:

1. **EC-1** (Q3 license-via-WebFetch path) — 1 linha em Q3 Fase B
2. **EC-2** (Q8 candidate cap + priority order) — 2 linhas em Q8 (cap em 5 + ordem de prioridade)

As 5 SHOULD TEST adições à seção "Halt-loop Checkpoints" são curtas (1 linha cada) e elevam significativamente a robustez do halt-loop. As 2 DOCUMENT podem virar uma nota inline em Q5 e Q6 OU stay nesta review como audit trail.

**Próximo passo:** bumpar `v0-8-benchmark-methodology-plan.md` de v1.0 → v1.1 incorporando EC-1 + EC-2 + as 5 SHOULD TEST checkpoints, depois invocar `/discover-execute v0-8-benchmark-methodology`. O plano v1.1 também não pode ser executado sem o humano aplicar as 9 entradas da ADR D3 em `.claude/rules/discover-web-allowlist.txt` (precondition documented; EC-3 enforce via pre-loop checkpoint).
