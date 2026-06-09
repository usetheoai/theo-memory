# Discover Edge Case Review — v0-8-vendor-cells-mem0-zep-letta

Data: 2026-06-07
Discovery plan analisado: .claude/knowledge-base/discoveries/plans/v0-8-vendor-cells-mem0-zep-letta-plan.md
Research questions analisadas: 6
Edge cases encontrados: 7 (MUST FIX: 1, SHOULD TEST: 4, DOCUMENT: 2)

## MUST FIX

### EC-1: Q5 cite caminho que NÃO EXISTE — `letta/server/rest_api/routers/v1/memory.py`

- **Question afetada:** Q5 (Letta TS SDK existence / REST shape)
- **Família:** Reference path
- **Cenário:** Plano Q5 método 2 diz `Read .claude/knowledge-base/references/letta/letta/server/rest_api/routers/v1/agents.py` (✓ existe) PLUS `memory.py if exists` (✗ não existe). Letta não tem `memory.py` — sua memória archival está em `archives.py` + sua block-memory está em `blocks.py`. Investigador do halt-loop vai bater no `memory.py` (não encontra), `if exists` hedge salva de fail-loud mas deixa a question com gap de cobertura sem rationale.
- **Impacto:** Q5 retorna blueprint incompleto — falta documentação dos endpoints reais de memory que Letta expõe. Próximo `/to-plan v0-9-vendor-client-impls` constrói `LettaOfficialClient` contra REST endpoints não-enumerados, requer outra rodada de discovery.
- **Fix sugerido:** Substituir `memory.py if exists` por `archives.py + blocks.py` (caminhos reais verified hoje). One-line method update no Q5.

## SHOULD TEST

### EC-2: Q3 não desambigua entry point — mem0-ts tem 3 sub-pacotes (oss + client + community)

- **Question afetada:** Q3 (mem0-ts API surface)
- **Halt-loop checkpoint sugerido:** Adicionar como PRIMEIRO passo de Q3: `Read .claude/knowledge-base/references/mem0/mem0-ts/package.json` para identificar o canonical entry (provavelmente `oss` ou `client`) BEFORE deep-reading `index.ts`. Sem isso, halt-loop pode acidentalmente analisar `community/` quando o impl path é `oss/` (vendor-fronting).

### EC-3: Q6 tools-corner cobre só Mem0 — Letta tem `.github/workflows/` cloned mas não está no método

- **Question afetada:** Q6 (CI gating for vendor SaaS)
- **Halt-loop checkpoint sugerido:** Estender método Q6 step 1 para também ler `letta/.github/workflows/*.yml` (verified hoje — Letta tem `core-integration-tests.yml`, `alembic-validation.yml`, etc.). Dual-source faz o corner Tools real ao invés de Mem0-only. Zep continua não-cobrido (não cloned) — acceptable; document no EC-7 DOCUMENT.

### EC-4: Q2 não cross-checa version drift entre Mem0's Python `zep_cloud` snapshot vs current `@getzep/zep-cloud` npm

- **Question afetada:** Q2 (Mem0's Zep adapter pattern)
- **Halt-loop checkpoint sugerido:** Adicionar step 4 em Q2: `Read mem0/evaluation/src/zep/requirements.txt` (ou `pyproject.toml`) para capturar a versão `zep_cloud` que Mem0 fixou; cross-reference com `npm view @getzep/zep-cloud version`. Se major version differ (e.g., Python 2.x vs TS 3.x), o Python→TS translation precisa de validação extra — flag no blueprint § Recommendations.

### EC-5: Q1 + Q5 vulneráveis a npm registry rate-limit (Inquebrável Rule 8 fail-fast precisa fallback)

- **Question afetada:** Q1, Q5
- **Halt-loop checkpoint sugerido:** Adicionar critério de stop por question: se `npm view <pkg>` retorna non-200 ou stderr não-vazio em 3 tries (default backoff), marca a question como `partial-blocked` no progress JSON com record do que foi tentado. NÃO falhe o halt-loop inteiro; deixe o blueprint surfar honestly que packageX status couldn't be confirmed via registry today.

## DOCUMENT

### EC-6: Q3 time budget 1.5h pode estourar se mem0-ts tem muitas camadas de abstração

- **Risco aceito:** Per ADR D1 stop-condition já documentado: question marcada BLOCKED após 1.5h. mem0-ts has multi-package layout (per EC-2 verified). Acceptable trade-off — partial answer about ONE entry point (oss) é melhor que nenhuma answer. Document no plan ADR D1 comments que Q3 ESPECÍFICA tem risco elevado de hit do budget.

### EC-7: Zep tools-corner permanece não-cobrido (Zep não cloned)

- **Risco aceito:** Zep não está em `.claude/knowledge-base/references/` — explicit per ADR D3 (npm view allowlist é o substituto). Q6 portanto só cobre Mem0 + Letta (com EC-3 absorbido). Zep CI patterns assume-se similar (vendor SaaS gating via env vars) sem verificação. Document como caveat no blueprint § Recommendations: "Zep CI pattern não verified independently; recomendação assume convergência com Mem0/Letta patterns".

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 (EC-5) | 0 |
| Q2 | 1 | 0 | 1 (EC-4) | 0 |
| Q3 | 2 | 0 | 1 (EC-2) | 1 (EC-6) |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 2 | 1 (EC-1) | 1 (EC-5 — shared with Q1) | 0 |
| Q6 | 2 | 0 | 1 (EC-3) | 1 (EC-7) |

**Veredicto:** DISCOVERY PLAN PRECISA DE AJUSTE (1 MUST FIX — path incorreto que vai virar gap silencioso)

**Sugestão de absorção pro plan v1.1:**
- Atualizar Q5 método 2 trocando `memory.py if exists` por `archives.py + blocks.py` (caminhos reais)
- Adicionar EC-2 (mem0-ts package.json#exports first), EC-3 (Letta workflows tambem), EC-4 (zep_cloud version cross-check), EC-5 (npm view retry policy) inline nos métodos das questions correspondentes
- Adicionar 2 caveat-notes nas ADRs (D1 Q3-tight, D3 Zep-not-verified) absorvendo EC-6 + EC-7

Após absorção, `/discover-execute` pode rodar com baixo risco de gaps silenciosos.
