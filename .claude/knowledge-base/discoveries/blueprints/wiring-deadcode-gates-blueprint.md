# Blueprint: Wiring + Dead-Code Quality Gates for TheoMemory (multi-language)

> **Version 1.0** — sintetiza pesquisa SOTA (academia + ferramentas mainstream + padrões CI OSS) sobre como detectar **código implementado mas não integrado** e **símbolos/APIs fabricados por LLM** em codebases multi-linguagem. Informa o design de uma skill `/code-quality` plugável, sibling de `/deps-audit`, que roda entre `/implement` e `/review` no `cycle-implement`.

**Slug:** `wiring-deadcode-gates`
**Source plan:** N/A — este blueprint foi produzido por **deep research direto via WebSearch + WebFetch**, fora do `/discover-execute` formal. Não passou por `/discover-plan` nem `/discover-edge-cases`. Tratar como **input qualificado para `/to-plan`**, NÃO como output do cycle-discover.
**Owner:** paulohenriquevn
**Generated:** 2026-05-22 via deep research manual
**Confidence verdict:** N/A — sem `/discover-confidence` rodado. Honestidade extrema (Inquebrável Rule 3): este blueprint não atende ao `discover-blueprint-golden-rule.md`. Citações usam URLs web (não `referencia/` paths) e não há snapshots persistidos (gap downstream do `cycle-discover` v1.1).

## Context

O ecossistema `.claude/` já cobre alguns gates de qualidade ([`cycle-plan.md`](../../../rules/cycle-plan.md), [`cycle-implement.md`](../../../rules/cycle-implement.md), [`cycle-review.md`](../../../rules/cycle-review.md)):

- **`plan-confidence`** detecta Coverage Matrix incompleta, ADR sem alternativas, bug-fix sem TDD (M2).
- **`discover-confidence`** detecta fabricated `referencia/` paths (Path.exists()).
- **`deps-audit`** detecta CVEs + Rule 9 violations em deps.
- **`implement/check_wiring.py`** detecta wiring triad por task (caller estático + integration test + runtime metric).
- **`review`** spawna 5-7 agents semânticos pré-merge.

**MAS** há gaps críticos não cobertos:

1. **Símbolos fabricados por LLM (Knowledge Conflicting Hallucinations)** — APIs, parâmetros, nomes de pacotes que parecem corretos mas não existem. Documentado como "M3 future" em [`plan-confidence-golden-rule.md`](../../../rules/plan-confidence-golden-rule.md) mas não implementado.
2. **Dead code estrutural** — função/classe/módulo definido mas nunca importado em produção. Hoje só detectado por revisão humana.
3. **Test quality real** — coverage delta é insuficiente; tests podem executar 100% do código sem assertar nada (mutation score documentado em 46% em codebases com 84% coverage).
4. **Wiring cross-package** — `check_wiring.py` valida wiring por task; não detecta "símbolo exportado mas zero importers cross-package".

TheoMemory será implementado em **4 linguagens** (TS para `@usetheo/memory`, Python para SDKs/scripts, Rust para core performance-critical, Go para server/runtime). Cada linguagem tem stack próprio de detectores; um gate único precisa ser language-agnostic via adapter pattern.

## Objective

Este blueprint permite o leitor decidir:

1. **Quais ferramentas adotar** por linguagem (knip vs ts-prune; vulture vs skylos; cargo udeps; deadcode/golangcix).
2. **Quais detectores são HARD CAPS vs SOFT GATES** no `cycle-implement`.
3. **Qual é a arquitetura plugável** que permite adicionar/remover linguagens via config.
4. **Qual é o trade-off CI cost vs detection power** aceitável.

---

## Coverage Corner 1 — Integration Tests (como ferramentas industriais validam wiring real)

### TypeScript ecosystem

**Knip** usa **mark-and-sweep algorithm** sobre o grafo de imports. Conhece pluginis nativos para Jest, Vitest, Storybook, ESLint, Webpack, etc., então não falsa-positiva código de teste por "não ser importado por produção".

- **Pattern industrial** (LobeHub guide): `code-analysis.yml` em CI roda matrix com 8 checks paralelos (incl. knip); `knip-cleanup.yml` semanal abre PR automático com remoções. ([Effective TypeScript on Knip](https://effectivetypescript.com/2023/07/29/knip/))
- **Padrão de adoção**: começa com `knip --no-exit-code` (lenient reporting), evolui para `knip` (failing CI) ao longo de 1-2 sprints conforme codebase é limpo. ([Knip docs](https://knip.dev/explanations/comparison-and-migration))
- **Blind spots documentados**: dynamic imports, flag-controlled paths, runtime behavior. Escape hatches via `knip.config.ts` (entry + ignore patterns).

### Python ecosystem

**Vulture** usa AST simples + confidence scoring (60-100%). **Skylos** (alternativa 2026) usa AST contextual completo.

- **Benchmark Mar/2026** sobre 9 repos top Python (Flask, FastAPI, Django, etc.): Vulture reportou 644 FPs total / recall ~83%; Skylos 220 FPs / recall 98.1%. ([Skylos benchmark](https://skylos.dev) / [DEV Community scan analysis](https://dev.to/duriantaco/python-dead-code-i-scanned-flask-fastapi-and-7-other-popular-repos-heres-what-i-found-5c1c))
- **Mitigação Vulture**: `--min-confidence 80` (corte recomendado para FPs aceitáveis) + whitelist file para frameworks dinâmicos (Flask routes, Django models, pytest fixtures).
- **Padrão CI**: vulture em pre-commit + skylos como gate de PR (mais lento mas mais preciso).

### Rust ecosystem

**cargo udeps** (https://github.com/est31/cargo-udeps) detecta dependências declaradas em `Cargo.toml` mas nunca usadas. **cargo-machete** alternativa mais rápida. Para dead code **dentro** do código, `rustc` com `-W dead_code` já cobre nativamente (warning padrão); compilação falha em workspaces estritos com `#![deny(dead_code)]`.

### Go ecosystem

**deadcode** (`golang.org/x/tools/cmd/deadcode`, oficial do Go team) usa reachability analysis a partir do `main` package. Mais confiável que `unused` (staticcheck) porque entende interfaces e reflection limitada.

---

## Coverage Corner 2 — Dependencies (ferramentas candidatas + Rule 9 evaluation)

Para cada detector candidato, avaliação Rule 9 ("Não Reinvente a Roda"):

| Tool | Linguagem | Versão | Função | Alternativas rejeitadas | Verdict |
|---|---|---|---|---|---|
| **knip** | TS/JS | `^5.x` | dead exports/files/deps em monorepo | ts-prune (DEPRECATED 2024), unimported (less features), depcheck (só deps, não exports) | **ADOPT** |
| **stryker** | TS/JS | `^8.x` | mutation testing | Nenhuma alternativa madura em TS | **ADOPT (soft gate)** |
| **skylos** | Python | `^0.x` | dead code AST contextual | vulture (faster, lower recall); deadcode (newer, less battle-tested) | **DEFER** — esperar 1.0.0 estável; vulture v0.1 |
| **vulture** | Python | `^2.14` | dead code AST simples + confidence | Skylos (não 1.0), deadcode (jovem) | **ADOPT** com `--min-confidence 80` |
| **mutmut** | Python | `^2.5` | mutation testing | mutpy (abandonado), cosmic-ray (slow) | **ADOPT (soft gate)** |
| **cargo-udeps** | Rust | `^0.1.x` | unused deps em Cargo.toml | cargo-machete (faster, less features) | **ADOPT** |
| **cargo-mutants** | Rust | `^25.x` | mutation testing | mutagen (abandonado) | **ADOPT (soft gate)** |
| **deadcode** | Go | `golang.org/x/tools` head | reachability analysis | staticcheck unused (less reliable for interfaces) | **ADOPT** |
| **go-mutesting** | Go | `^1.x` | mutation testing | gremlins (newer, alternative) | **DEFER** — avaliar gremlins primeiro |
| **ruff** | Python | `^0.x` | linting + unused imports | flake8 (slower), pylint (slower) | **ADOPT (já em uso provável)** |
| **tree-sitter** | language-agnostic | latest | AST parsing for symbol fabrication check | Per-language ASTs (mais código a manter) | **ADOPT** — base do detector D2 |

---

## Coverage Corner 3 — Tools (como CI integra esses detectores)

### Padrão validado em OSS (Nx, Backstage proxies)

**Composite GitHub Action** centraliza setup (pnpm/Node/Python/Rust toolchain/cache) e encolhe workflows ~65%. Workflows declaram apenas o que MUDA: matriz de checks, paths filters, affected-only.

```yaml
# .github/workflows/code-quality.yml (esboço)
jobs:
  code-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: ./.github/actions/setup-monorepo  # composite action
      - run: python3 .claude/skills/code-quality/scripts/run_code_quality.py \
            --languages-rule .claude/rules/code-quality-languages.txt \
            --thresholds-rule .claude/rules/code-quality-thresholds.txt \
            --allowlist .claude/rules/code-quality-allowlist.txt \
            --output .claude/knowledge-base/audits/code-quality-${{ github.sha }}.md
```

### Matrix paralelo (LobeHub Skills guide)

A `code-analysis.yml` industrial roda 8 checks paralelos: type check, lint, markdown lint, YAML lint, format, **knip**, spell check, type coverage. Plus `knip-cleanup.yml` semanal que abre PR automático. ([LobeHub monorepo guide](https://lobehub.com/skills/jimmypaolini-monorepo-github-actions))

### Required-checks aggregator

```yaml
required:
  needs: [lint, typecheck, test, code-quality, security]
  if: always()
  steps:
    - run: |
        if [[ "${{ contains(needs.*.result, 'failure') }}" == "true" ]]; then
          exit 1
        fi
```

Branch protection rule referencia `required` como context obrigatório. ([Graphite Quality Gates guide](https://graphite.com/guides/enforce-code-quality-gates-github-actions))

### Coverage threshold action (drop-in)

```yaml
- uses: tluijken/code-coverage-threshold@v1
  with: { coverage-file: coverage/tests.lcov, minimum-coverage: 90 }
```

### Mutation testing CI integration (Stryker)

Per-PR scoped (diff-based) leva **1-5min**. Full run nightly 30-60min. Config define thresholds (`high: 80, low: 60, break: 50`). ([Stryker docs](https://stryker-mutator.io/docs/) / [Microsoft Learn Stryker.NET](https://learn.microsoft.com/en-us/dotnet/core/testing/mutation-testing))

---

## Coverage Corner 4 — Techniques (algoritmos e SOTA acadêmica)

### Technique 1 — Mark-and-sweep para dead code

**O que é**: marca todos os symbols alcançáveis a partir dos entry points (main, exports públicos, fixtures de teste declarados). Tudo que não foi marcado = candidate to dead. Adotado por knip, deadcode (Go), cargo-machete.

**Limitação**: dynamic imports e reflection escapam. Mitigação: plugins per-framework (knip plugins) ou whitelist explicit (vulture).

### Technique 2 — AST + Knowledge Base introspection (KCH detection)

**Paper**: ["Detecting and Correcting Hallucinations in LLM-Generated Code via Deterministic AST Analysis"](https://arxiv.org/abs/2601.19106) (arXiv:2601.19106, 2026)

**Mecânica**:
1. Parse código gerado em AST.
2. Para cada call/attribute/import no AST, valida contra **Knowledge Base dinâmica** construída via library introspection (`inspect.signature` para Python, `npm view` + TypeScript LSP para TS, `cargo metadata` para Rust).
3. KCH é detectado quando símbolo no AST não existe na KB.

**Performance reportada**: dataset 200 snippets Python, **100% precision, 87.6% recall (F1 0.934), auto-correção 77%**.

**Adaptação para TheoMemory**: implementável via tree-sitter (AST language-agnostic) + plugins por linguagem que consultam manifests + runtime introspection.

### Technique 3 — Mutation testing (Stryker / mutmut / cargo-mutants)

**Métrica**: % de mutações killed pelo test suite. Mutação = mudança sintática pequena no código (operadores, constantes, condições).

**Thresholds aceitos** (2026 consensus): >80% excelente, 60-80% bom, <60% gap. Caso documentado: **84% coverage / 46% mutation score** mostra que coverage não é sinal de qualidade. ([Pullnotifier 2026 guide](https://pullnotifier.com/tools/code-coverage))

**Escopo recomendado**: paths críticos declarados no plano (não codebase inteiro). Custo per-PR 1-5min scoped, 30-60min full nightly.

### Technique 4 — RANSAC clustering com tests gerados (CodeT)

**Paper**: ["CodeT: Code Generation with Generated Tests"](https://arxiv.org/abs/2207.10397) (arXiv:2207.10397, MSFT 2022)

**Mecânica**:
1. LLM gera N soluções candidatas + M test cases.
2. Executa cada solução contra cada teste.
3. Forma clusters via RANSAC: solução A e B no mesmo cluster se passam o mesmo conjunto de testes.
4. Score = |cluster| × |tests passed|. Top cluster wins.

**Trade-off**: alto custo de tokens (LLM gera N × M artifacts). **REJEITADO** para TheoMemory porque TDD-first já é mandatado por Inquebrável Rule 5 — humanos escrevem o teste primeiro, não o LLM.

### Technique 5 — Dependency Constrained Decoding (MARIN)

**Paper**: ["Towards Mitigating API Hallucination in Code Generated by LLMs with Hierarchical Dependency Aware"](https://arxiv.org/pdf/2505.05057) (FSE Companion '25)

**Mecânica**: restringe token generation a símbolos válidos do projeto. **REJEITADO** porque requer modificar decoding do modelo (não aplicável quando consumimos Claude API).

### Technique 6 — Slopsquatting attack vector

**Empirical**: Spracklen et al. 2025 — **19.7% das recomendações de pacote em LLM são fabricadas**; **58% repetem entre queries**, criando attack vector explorável. GPT-4 Turbo: 4% hallucination rate; CodeLlama 7B: 26%. ([diffray.ai analysis](https://diffray.ai/blog/llm-hallucinations-code-review/))

**Implicação para TheoMemory**: D2 (symbol fabrication) **DEVE** checar nomes de pacotes contra registries (npm, PyPI, crates.io, Go proxy) antes de permitir `import`/`require`/`use`/`import` em código novo.

---

## Cross-cutting Comparison

| Dimensão | TypeScript | Python | Rust | Go |
|---|---|---|---|---|
| Dead code tool | knip | vulture (--min-confidence 80) | cargo udeps + rustc -W dead_code | golang.org/x/tools/cmd/deadcode |
| Mutation tool | stryker | mutmut | cargo-mutants | go-mutesting (DEFER, avaliar gremlins) |
| Symbol fab check | tree-sitter + npm view + tsc | tree-sitter + inspect + pip show | tree-sitter + cargo metadata | tree-sitter + go list |
| CI cost per-PR | <2min (knip) + 1-5min (stryker scoped) | <30s (vulture) + 1-3min (mutmut scoped) | <1min (cargo udeps) + 2-5min (cargo-mutants) | <30s (deadcode) + N/A se DEFER |
| Maturidade | High (knip) / High (stryker) | High (vulture) / High (mutmut) | High (cargo udeps) / Medium (cargo-mutants) | High (deadcode) / Low (mutation) |

---

## ADRs

### D1 — Skill `/code-quality` é language-agnostic via adapter pattern

**Decision**: criar a skill com `scripts/detectors/{language}.py` (um módulo por linguagem). Entrypoint `run_code_quality.py` lê `.claude/rules/code-quality-languages.txt` (config declarativa) + auto-detecta presença de manifests + invoca detectores habilitados.

**Rationale**: TheoMemory adotará 4 linguagens (TS + Python + Rust + Go). Skill monolítica explode em complexidade; per-language separate skills explodem em quantidade de skills + audit overhead. Adapter pattern é o equilíbrio — mesma estrutura que `/deps-audit` usa hoje (Coverage Corner 2 e 3 mostram que esse é o padrão industrial).

**Alternatives considered**:
1. **Skill monolítica** — todas linguagens hardcoded no mesmo script. Rejeitado: viola SRP (Inquebrável § 13.1).
2. **N skills separadas** (`/code-quality-ts`, `/code-quality-py`, etc.) — rejeitado: explosão de skills + duplica reporting + 4x audit trail.
3. **Auto-detect padrão sem config** — rejeitado pelo usuário: prefere `.claude/rules/code-quality-languages.txt` para audit explícito (sibling de `discover-web-allowlist.txt` que é commit-tracked).

**Consequences**:
- Cada linguagem é plugável: adicionar Java/C#/Ruby no futuro = novo `scripts/detectors/java.py`.
- Config `.claude/rules/code-quality-languages.txt` precisa ser commit-tracked + ter audit (mesma mecânica do allowlist).
- Skill testa adaptadores em paralelo via fixtures (uma fixture mínima por linguagem).

### D2 — Hard caps são D1 (dead code) e D2 (symbol fabrication); D3 (cross-package wiring) e D4 (mutation) são soft caps

**Decision**:

| Detector | Tipo de gate | Stable identifier |
|---|---|---|
| **D1 — Dead code não-allowlisted** | HARD CAP (INVALID, score 49) | `dead_code_unallowlisted_{language}` |
| **D2 — Symbol fabricado (pacote/API inexistente)** | HARD CAP (INVALID, score 49) | `symbol_fabrication_{language}` |
| **D3 — Cross-package wiring (exported sem importer prod)** | SOFT CAP (cap 70) | `soft_cap_orphan_export_{language}` |
| **D4 — Mutation score abaixo de 60% em path crítico** | SOFT CAP (cap 70) | `soft_cap_mutation_score_low_{language}` |
| **D4 — Mutation score 60-79% em path crítico** | SOFT FLOOR (cap 89) | `soft_floor_mutation_score_medium_{language}` |

**Rationale**:
- **D1 hard cap**: dead code não-allowlisted é evidência objetiva de scope creep ou código gerado mas não wirado. Não pode ser "advanced with caveats" — ou é justificado via allowlist, ou é deletado.
- **D2 hard cap**: símbolo fabricado é literalmente código quebrado em runtime. Não negociável. Spracklen et al. 2025 documenta que 4-26% dos pacotes em código LLM são fabricados — defesa em profundidade é mandatória.
- **D3 soft cap**: export sem importer é suspeito mas pode ser API pública aguardando consumer downstream (legítimo em libs). Surface para revisão humana, não bloqueia.
- **D4 soft cap**: mutation score é caro e ruidoso. Tratar como signal de qualidade de teste, não de correção. Threshold 60% / 80% segue consenso 2026 (Stryker docs).

**Alternatives considered**:
1. **Tudo hard cap** — rejeitado: mutation testing pode flake; bloquearia PRs por razões fora do controle do autor.
2. **Tudo soft cap** — rejeitado: D2 (symbol fab) é literalmente código quebrado; sem hard cap, nenhum benefício real.
3. **D1 como soft cap inicialmente, hard cap depois** (modelo de adoção lenient → strict do knip) — viável MAS adiciona estado de "modo" à skill; preferimos hard cap + allowlist generoso no início.

**Consequences**:
- `code-quality-allowlist.txt` será grande no início (legacy code que ainda não foi limpo). Sunset dates obrigatórios (mesma mecânica do `deps-audit-allowlist.txt`).
- Soft caps precisam de `## Critical paths` declarado no plano implementado para sabermos onde rodar mutation testing.

### D3 — `plan-confidence` consome o verdict de `/code-quality` (extensão do contrato)

**Decision**: Quando `/code-quality` retorna verdict ≤ FAIL_*, `/plan-confidence` capa no banda correspondente. Stable identifiers ficam em `hard_caps_triggered`.

**Rationale**: Mesmo padrão do `/deps-audit` v1.1 ([cycle-plan.md § Downstream changes](../../../rules/cycle-plan.md)). Mantém o single point of truth para verdict do plano.

**Alternatives considered**:
1. **`/code-quality` standalone, sem feedback em plan-confidence** — rejeitado: skills isoladas = sem enforcement upstream.
2. **`/code-quality` parte do `/implement`** — rejeitado: implement já roda check_wiring por task; agregar inflate o halt-loop. Melhor rodar `/code-quality` POST-implement, PRE-review.

**Consequences**:
- `cycle-plan.md` e `cycle-implement.md` precisam ser atualizados (mesmo follow-up que `/deps-audit` v1.1).
- `plan-confidence-golden-rule.md` precisa adicionar stable identifiers de `/code-quality` (LOCKED FILE — requer ADR).

### D4 — `/code-quality` roda entre `/implement` e `/review`, não dentro do halt-loop de `/implement`

**Decision**: Posição no cycle-implement é POS-implement, PRE-review (sibling de `/deps-audit` mas no lado do código).

**Rationale**:
- Halt-loop de `/implement` já é caro (100-300k tokens por feature). Adicionar mutation testing per-iteration explode custos.
- Dead code emerge POR INTERAÇÃO de tasks (task A cria função X, task B remove o único caller — dead code só é visível depois das duas).
- Skill rodada uma vez no fim agrega visão do diff completo.

**Alternatives considered**:
1. **Rodar dentro do halt-loop per task** — rejeitado: explosão de custos + ruído.
2. **Rodar pre-implement como parte do plan** — rejeitado: não há código ainda para validar.
3. **Rodar apenas dentro de `/review`** — rejeitado: review é semântico/humano-like; gates determinísticos pertencem a fase própria.

**Consequences**:
- `cycle-implement.md` ganha fase final "code-quality gate" antes do handoff para review.
- `cycle-review.md` confia que `/code-quality` rodou (não re-executa).
- Skill precisa receber slug + ler `plans/{slug}-plan.md` para descobrir `## Critical paths`.

### D5 — Symbol fabrication check usa tree-sitter + registry lookup (não LLM-as-judge)

**Decision**: D2 (symbol fab) é DETERMINÍSTICO. Pipeline:
1. Parse novo código no diff via tree-sitter (language-agnostic).
2. Extrai imports/calls/attributes.
3. Para cada import declarado: valida contra registry (npm view / pip show / cargo metadata / go list).
4. Para cada call/attribute em libs known: valida assinatura via runtime introspection (Python `inspect`) ou type-info (TS Compiler API).
5. Flagging conservador: se introspection não confirma, marcar como WARNING (não BLOCKED).

**Rationale**: arXiv:2601.19106 demonstra 100% precision via AST + KB introspection. LLM-as-judge tem custo + variance. Determinístico é mais barato + mais auditável.

**Alternatives considered**:
1. **LLM-as-judge** — rejeitado: custo + não-determinismo.
2. **Self-Verify via test execution** (CodeT-like) — rejeitado: TDD-first já cobre.
3. **Skipping symbol fab em v0.1** — tentador (mais simples), mas Spracklen et al. 2025 mostra que 4-26% dos pacotes são fabricados, então skip é dívida técnica imediata.

**Consequences**:
- Skill precisa de tree-sitter como dependência + adapter pattern por linguagem.
- Detectores online (cache de resultados de registry lookup obrigatório, ou CI fica caríssimo).
- Test fixtures precisam incluir exemplos de symbol fabricado por linguagem.

---

## Recommendations for TheoMemory

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Criar skill `/code-quality` em `.claude/skills/code-quality/` com estrutura `scripts/detectors/{language}.py` | D1, [`cycle-plan.md`](../../../rules/cycle-plan.md) § 9 (não reinvente) | **HIGH** |
| 2 | Criar `.claude/rules/code-quality-languages.txt` (config declarativa de quais ecossistemas habilitar) | D1 | **HIGH** |
| 3 | Criar `.claude/rules/code-quality-golden-rule.md` (sibling de `deps-audit-golden-rule.md`, com stable identifiers de D2) | D2, D3 | **HIGH** |
| 4 | Criar `.claude/rules/code-quality-thresholds.txt` (rubric weights + soft cap floors) | D2 | **HIGH** |
| 5 | Criar `.claude/rules/code-quality-allowlist.txt` (mesma mecânica do `deps-audit-allowlist.txt` — sunset obrigatório) | D2 | **HIGH** |
| 6 | Adaptar arXiv:2601.19106 (AST + KB introspection) para tree-sitter + registry lookup. Implementar D2 detector em fases: v0.1 só nome de pacote (mais barato, alto valor); v0.2 expand para call signatures | D5 | **HIGH** |
| 7 | Implementar D1 (dead code) wrappers: knip (TS), vulture (Python), cargo udeps (Rust), deadcode (Go). Skill executa o tool + parseia output + agrega findings | D1 | **HIGH** |
| 8 | Implementar D3 (cross-package wiring) via ast-grep cross-package search (já temos `/ast-grep` skill) | [`cycle-implement.md`](../../../rules/cycle-implement.md) § wiring triad | **MEDIUM** |
| 9 | Implementar D4 (mutation testing) wrappers: stryker (TS), mutmut (Python), cargo-mutants (Rust). Rodar APENAS em `## Critical paths` declarados no plano. Defer Go (avaliar gremlins vs go-mutesting na v0.2) | Coverage Corner 4 mutation | **MEDIUM** |
| 10 | Atualizar `cycle-implement.md` v1.x para incluir fase `/code-quality` entre o halt-loop e o handoff para `/review` (mesma mecânica do `/deps-audit` v1.1 em `cycle-plan.md`) | D3, D4 | **HIGH** |
| 11 | Atualizar `plan-confidence-golden-rule.md` (LOCKED) para consumir stable identifiers de `/code-quality` via ADR explícito | D3 | **HIGH** (LOCKED file — requer strategic review) |
| 12 | Documentar trade-off CI cost: estimar custo por linguagem ativa em `token-budget.md` (analogamente ao `/deps-audit` estimate) | Coverage Corner 3 | **MEDIUM** |
| 13 | Templates de allowlist por categoria: dead code legacy, symbol não introspectável (frameworks), mutation flakes | D2 | **MEDIUM** |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| Q: Skylos atinge 1.0.0 antes de v0.2? | Skylos ainda 0.x em 2026; depende do upstream | Re-avaliar em 3 meses; defer skylos para v0.2 |
| Q: Quais são os `## Critical paths` em código que ainda não existe (src/ vazio)? | Plano D4 depende de paths declarados; pre-code não tem | Skill D4 começa NO-OP quando plan não declara critical paths; emite WARNING |
| Q: tree-sitter parsers para Rust/Go são production-ready em 2026? | Não validado nesta pesquisa | Validar antes de v0.1 ship; fallback para AST nativo por linguagem |
| Q: Custo de registry lookup em CI (npm view / pip show) escala? | Não medido | Implementar cache local + cache no GitHub Actions step |
| Q: D5 cobre macro expansions em Rust? Cobre generics resolvidos? | Não — limitação fundamental de static analysis | Documentar como blind spot conhecido; aceitar trade-off |

## Halt-loop progress (audit trail)

- Iterations used: **N/A** — produzido fora do `/discover-execute` halt-loop oficial.
- Questions answered: **8 search queries** via WebSearch (knip vs ts-prune, vulture FP, arxiv hallucination, CodeT, GitHub Actions quality gates, mutation testing, fabricated API, Backstage CI).
- Questions blocked: **5** (listadas acima).
- Citations verified: **9 URLs cited inline; nenhum snapshot persistido** (gap conhecido).
- Promise emitted at iteration: **N/A**.

## Related

- Discovery plan: **N/A** — não houve `/discover-plan` formal.
- Confidence report: **N/A** — sem `/discover-confidence` rodado (não atenderia ao golden rule).
- Linked TheoMemory rules: [`architecture.md`](../../../rules/architecture.md), [`testing.md`](../../../rules/testing.md), [`cycle-plan.md`](../../../rules/cycle-plan.md), [`cycle-implement.md`](../../../rules/cycle-implement.md), [`cycle-review.md`](../../../rules/cycle-review.md), [`deps-audit-golden-rule.md`](../../../rules/deps-audit-golden-rule.md) (template para code-quality-golden-rule), [`plan-confidence-golden-rule.md`](../../../rules/plan-confidence-golden-rule.md).
- Sibling cycles: [`/deps-audit`](../../../skills/deps-audit/SKILL.md) (modelo arquitetural mais próximo).
- Project rules consumed: [`/home/paulo/.claude/CLAUDE.md`](file:///home/paulo/.claude/CLAUDE.md) § 9 (Não Reinvente a Roda — drives Rule 9 evaluation em D2).

## Sources (web research)

Pesquisas conduzidas 2026-05-22 via WebSearch + WebFetch.

### Frente A — Dead code tools

- [Effective TypeScript: Use knip to detect dead code](https://effectivetypescript.com/2023/07/29/knip/)
- [Knip — Comparison & Migration](https://knip.dev/explanations/comparison-and-migration)
- [DEV Community: Knip Ultimate Dead Code Detector](https://dev.to/ajmal_hasan/knip-the-ultimate-dead-code-detector-for-javascript-typescript-projects-3463)
- [Skylos — Python dead code detection benchmark](https://skylos.dev)
- [DEV Community: Python Dead Code Scan of Flask, FastAPI, etc.](https://dev.to/duriantaco/python-dead-code-i-scanned-flask-fastapi-and-7-other-popular-repos-heres-what-i-found-5c1c)
- [Vulture on PyPI](https://pypi.org/project/vulture/)

### Frente B — Prior art acadêmico (LLM code trust)

- [CodeT: Code Generation with Generated Tests (arXiv:2207.10397)](https://arxiv.org/abs/2207.10397)
- [CodeHalu: Investigating Code Hallucinations in LLMs via Execution-based Verification (arXiv:2405.00253)](https://arxiv.org/abs/2405.00253)
- [Detecting and Correcting Hallucinations in LLM-Generated Code via Deterministic AST Analysis (arXiv:2601.19106)](https://arxiv.org/abs/2601.19106)
- [MARIN: Towards Mitigating API Hallucination in Code Generated by LLMs with Hierarchical Dependency Aware (arXiv:2505.05057)](https://arxiv.org/pdf/2505.05057)
- [Can LLMs Detect Their Own Hallucinations? (arXiv:2511.11087)](https://arxiv.org/pdf/2511.11087)
- [diffray.ai: LLM Hallucinations in AI Code Review](https://diffray.ai/blog/llm-hallucinations-code-review/)
- [Awesome Hallucination Detection (GitHub)](https://github.com/EdinburghNLP/awesome-hallucination-detection)

### Frente C — CI patterns industriais

- [LobeHub: Monorepo GitHub Actions Skill (Nx + knip + matrix)](https://lobehub.com/skills/jimmypaolini-monorepo-github-actions)
- [Graphite: Enforce Code Quality Gates in GitHub Actions](https://graphite.com/guides/enforce-code-quality-gates-github-actions)
- [DEV Community: SonarQube + GitHub Actions Workflow](https://dev.to/rahulxsingh/sonarqube-github-actions-automated-code-analysis-workflow-4c8p)
- [OneUptime: Coverage Gate Workflow](https://oneuptime.com/blog/post/2026-01-27-code-coverage-reports-github-actions/view)
- [Code Coverage Threshold Action (Marketplace)](https://github.com/marketplace/actions/code-coverage-threshold)

### Frente D — Mutation testing + integration coverage

- [Stryker Mutator (official)](https://stryker-mutator.io/)
- [Stryker docs: What is mutation testing](https://stryker-mutator.io/docs/)
- [Microsoft Learn: Stryker.NET mutation testing](https://learn.microsoft.com/en-us/dotnet/core/testing/mutation-testing)
- [Pullnotifier 2026: Code Coverage Complete Guide](https://pullnotifier.com/tools/code-coverage)
- [Harness: Code Coverage in CI](https://www.harness.io/blog/code-coverage-measure-improve-and-scale-quality-in-ci)
- [Diffblue: Code Coverage and Test Coverage explained](https://www.diffblue.com/resources/code-coverage-and-test-coverage-explained/)
