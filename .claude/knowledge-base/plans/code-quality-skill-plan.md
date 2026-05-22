# Plan: Code-Quality Skill — multi-language wiring + dead-code + symbol-fabrication gate

> **Version 1.3** — Implementar a skill `/code-quality` em `.claude/skills/code-quality/` conforme blueprint `wiring-deadcode-gates-blueprint.md`. Skill audita TypeScript, Python, Rust e Go quanto a dead code, símbolos fabricados, wiring cross-package órfão e qualidade de testes (mutation), bloqueando PRs com achados não-allowlisted. Arquitetura adapter pattern (um módulo Python por linguagem). Sibling arquitetural de `/deps-audit`. Roda entre o halt-loop de `/implement` e o handoff para `/review` no `cycle-implement`. **Read-only** por design: nunca edita código.

### Changelog do plano

| Versão | Data | Mudança | Origem |
|---|---|---|---|
| v1.0 | 2026-05-22 | Plano inicial via `/to-plan`. 20 tasks, 7 fases + Final. | Blueprint `wiring-deadcode-gates-blueprint.md` |
| v1.1 | 2026-05-22 | 11 MUST FIX absorvidos de `/edge-case-plan`. Nova task T6.5 (EC-29 Opção A — estende `plan-confidence/run_structural.py` para consumir verdict de `/code-quality`). Coverage Matrix expande 20 → 28 entradas. Subtasks de validação + skip lists + atomic writes + safe parsing distribuídas em T0.1/T0.4/T2.2-2.5/T4.1/T5.1. | [`code-quality-skill-edge-cases-2026-05-22.md`](../reviews/code-quality-skill-edge-cases-2026-05-22.md) |
| v1.2 | 2026-05-22 | 6 findings de `/deps-audit` absorvidos: F1 (stryker → @stryker-mutator/core ^9.6), F2 (deadcode @latest → @v0.45.0), F3 (tree-sitter ^0.23 → ^0.25), F4 (mutmut ^2.5 → ^3.5 + nota CLI revalidation), F5 (knip ^5.x → ^6.14 + nota schema revalidation), F6 (osv-scanner adicionado a PORTABLE prereqs). T1.2 + T4.1 + T4.2 ganham acceptance criteria de revalidação contra versões atualizadas. | [`code-quality-skill-deps-audit-2026-05-22.md`](../audits/code-quality-skill-deps-audit-2026-05-22.md) |

## Goal

> "Ship a `/code-quality` skill that audits TheoMemory's TypeScript, Python, Rust, and Go code for dead symbols, fabricated APIs, cross-package orphans, and weak test quality so that no PR merges with non-allowlisted findings, measured by `pytest .claude/skills/code-quality/tests` passing 100% on fixture suites covering positive (defect present) and negative (clean) cases for D1+D2 detectors across all 4 languages."

## Context

**What exists today:**

- `.claude/skills/deps-audit/` — sibling arquitetural; mesma forma multi-ecosystem + golden rule + allowlist com sunset. Padrão a replicar.
- `.claude/skills/implement/scripts/check_wiring.py` — wiring triad (caller estático + integration test + runtime metric) POR TASK durante `/implement`. Não detecta wiring cross-package.
- `.claude/skills/discover-confidence/scripts/check_reference_citations.py` — valida `referencia/` paths via `Path.exists()`. Não cobre símbolos fabricados em código de produção.
- `.claude/rules/plan-confidence-golden-rule.md` linha "Fabricated citation → score ≤ 49 — M3 (future) — SAFE adapted to `ripgrep + tree-sitter + read_file`". Documentado como gap conhecido; este plano fecha esse gap para código de produção.

**What's broken or missing (evidence-backed):**

- **Símbolos fabricados em código LLM**: Spracklen et al. 2025 — GPT-4 Turbo hallucina pacotes 4% do tempo; CodeLlama 7B 26%. 19.7% das recomendações de pacote em LLM são fabricadas; 58% repetem entre queries (slopsquatting attack vector). Fonte: [arXiv:2601.19106](https://arxiv.org/abs/2601.19106) reporta AST + KB introspection com 100% precision, 87.6% recall em KCHs (Knowledge Conflicting Hallucinations).
- **Dead code estrutural**: zero detecção hoje. Knip + Vulture + cargo-udeps + deadcode são ferramentas maduras com adopção industrial (Knip em Nx monorepos; ts-prune deprecado 2024; Vulture FP mitigado via `--min-confidence 80`).
- **Test quality real**: coverage delta é insuficiente. Caso documentado: 84% coverage / 46% mutation score. Sem Stryker/mutmut no ecossistema; testes podem executar 100% do código sem assertar nada.
- **Cross-package wiring**: `check_wiring.py` valida apenas POR TASK; não captura "symbol exported mas zero importers cross-package".

**Source artifact:** `.claude/knowledge-base/discoveries/blueprints/wiring-deadcode-gates-blueprint.md` (2026-05-22) — deep research direto via WebSearch+WebFetch (fora do `/discover-execute` formal; marcado honestamente como tal).

**Affected directories (no `/architecture-docs` skill instalado):**

- `.claude/skills/` — gain um novo subdir `code-quality/` (NEW)
- `.claude/rules/` — gain 4 NEW arquivos (golden rule + languages + thresholds + allowlist) + modify 2 (cycle-implement.md, token-budget.md) + 1 LOCKED file requires ADR (plan-confidence-golden-rule.md)
- `.claude/knowledge-base/audits/` — NEW directory para output
- `.claude/HOW-TO-USE.md` — modify para mencionar `/code-quality`

**Architectural boundary:** O `architecture.md` rege `src/**/*.ts` (TheoMemory propriamente dito). Este plano vive em `.claude/skills/` (ferramental Python). Convenções aplicáveis: Python snake_case (per existing skills); pyproject.toml + pytest (per `plan-confidence/`); SKILL.md frontmatter (per `deps-audit/`); arquivo ≤ 500 LoC (per template default).

## Objective

- [ ] Foundation: golden rule + 3 config files (languages, thresholds, allowlist) + skill skeleton + CHANGELOG.md + `_shared.py` utilities (safe_parse_json, write_atomic, DEFAULT_SKIP_DIRS, make_relative, sanitize_symbol) shipped
- [ ] D1 dead code: 4 wrappers (vulture, knip, cargo-udeps, deadcode) functional with fixture tests (positive + negative per language)
- [ ] D2 symbol fabrication: tree-sitter scaffolding + 4 per-lang adapters with registry lookup + module-local-import skip rules (relative/crate/self-module) + monorepo subpath skip + atomic cache + fixtures + tests
- [ ] D3 cross-package wiring: ast-grep-based detector + fixtures + tests
- [ ] D4 mutation testing: mutmut + stryker wrappers + critical-paths schema validation (Rust + Go DEFER to v0.2 via explicit ADR) + fixtures + tests
- [ ] Orchestrator + reporting: entrypoint with strict slug resolution, --no-network/--no-audit-write flags, top-level crash safety, verdict aggregation per golden rule cap table, JSON + markdown report at `.claude/knowledge-base/audits/{slug}-code-quality-{date}.md`
- [ ] Cycle integration: `cycle-implement.md` v1.x adds `/code-quality` phase; `plan-confidence-golden-rule.md` extension via ADR; **[v1.1 NEW]** `plan-confidence/run_structural.py` extended with runtime invocation of `/code-quality` (Inquebrável Rule 3 honored — integration is REAL); `token-budget.md` includes estimate; HOW-TO-USE.md mentions skill

## ADRs

### D1 — Skill é language-agnostic via adapter pattern (`scripts/detectors/{language}.py`)

**Decision:** Skill em Python com entrypoint `scripts/run_code_quality.py` + adaptadores plugáveis em `scripts/detectors/{python,typescript,rust,go}.py`. Cada adaptador implementa interface comum (`detect_dead_code`, `detect_symbol_fab`, etc.). Entrypoint lê `.claude/rules/code-quality-languages.txt` (config declarativa) + auto-detecta presença de manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`) + invoca detectores apenas para linguagens habilitadas E presentes.

**Rationale:** TheoMemory adota 4 linguagens; skill monolítica viola SRP (`/home/paulo/.claude/CLAUDE.md § 13.1`). N skills separadas explode em audit overhead (4 audit trails / 4 reports / 4 cycle hooks). Adapter pattern segue o padrão validado de `/deps-audit` (que faz exatamente isso para CVEs). Inquebrável § 9 (Não Reinvente): o padrão deps-audit é o "blueprint vivo" do ecossistema.

**Alternatives considered:**
- **Skill monolítica** (todos detectores hardcoded no mesmo script) — rejeitada: viola SRP (Inquebrável § 13.1); cada mudança em detector Rust afetaria diff de Python.
- **N skills separadas** (`/code-quality-ts`, `/code-quality-py`, etc.) — rejeitada: explosão de skills (4× audit + reporting + cycle hooks); usuário teria que invocar 4 vezes.
- **Auto-detect puro sem config declarativa** — rejeitada explicitamente pelo usuário durante /to-plan: prefere `code-quality-languages.txt` commit-tracked para audit explícito de mudanças de escopo (sibling de `discover-web-allowlist.txt`).
- **Plugin system via entry-points (Python setuptools)** — rejeitada: over-engineering para v0.1; YAGNI. Adapter direto via `scripts/detectors/{lang}.py` resolve com simplicidade.

**Consequences:**
- Adicionar Java/C#/Ruby no futuro = novo módulo `scripts/detectors/java.py` + 1 entry em `code-quality-languages.txt`.
- Cada detector pode evoluir independentemente sem quebrar siblings.
- Testes em paralelo via fixtures per-language.
- Config explícito em `code-quality-languages.txt` (commit-tracked) habilita audit trail para mudanças de escopo.

### D2 — Hard caps são D1 (dead code não-allowlisted) e D2 (symbol fabricado); D3 e D4 são soft caps

**Decision:**

| Detector | Gate | Stable identifier |
|---|---|---|
| **D1 — Dead code não-allowlisted** | HARD CAP (verdict INVALID, score 49) | `dead_code_unallowlisted_{language}` |
| **D2 — Symbol fabricado (pacote/API inexistente)** | HARD CAP (verdict INVALID, score 49) | `symbol_fabrication_{language}` |
| **D3 — Cross-package wiring (export sem importer prod)** | SOFT CAP (cap 70) | `soft_cap_orphan_export_{language}` |
| **D4 — Mutation score < 60% em path crítico** | SOFT CAP (cap 70) | `soft_cap_mutation_score_low_{language}` |
| **D4 — Mutation score 60-79% em path crítico** | SOFT FLOOR (cap 89) | `soft_floor_mutation_score_medium_{language}` |
| **Auditor unavailable em linguagem habilitada** | SOFT CAP (cap 70) | `auditor_unavailable_{tool}` |

**Rationale:**
- D1 hard cap: dead code não-allowlisted é evidência objetiva de scope creep ou código LLM-generated mas não wirado.
- D2 hard cap: símbolo fabricado é código quebrado em runtime. Spracklen et al. 2025 documenta 4-26% pacotes fabricados — defesa em profundidade é mandatória.
- D3 soft cap: export sem importer pode ser API pública legítima (libs). Surface humano.
- D4 soft cap: mutation é caro e ruidoso; tratar como signal de qualidade de teste, não correção. Thresholds seguem consenso 2026 (Stryker docs: >80% ótimo, 60-80% bom, <60% gap).

**Alternatives considered:**
- **Tudo HARD CAP** — rejeitada: mutation testing pode flake; bloquearia PRs por razões fora do controle do autor (test order dependency, network timeout em testes de integração). Penaliza falsamente.
- **Tudo SOFT CAP** — rejeitada: símbolo fabricado (D2) É literalmente código quebrado em runtime; sem hard cap, o gate perde valor inquebrável. Spracklen et al. 2025 quantifica o problema.
- **Lenient → strict transition (modelo knip de adoção)** — começar tudo como soft, virar hard depois — rejeitada: adiciona "modo" à skill, complica config; preferimos hard cap com allowlist generoso no início (mesma trade-off do `/deps-audit`).
- **Thresholds graduais por linguagem** (Python mais strict que Go por maturidade) — rejeitada para v0.1: YAGNI; tabela uniforme + per-language allowlist resolve sem complicar verdict aggregator.

**Consequences:**
- `code-quality-allowlist.txt` precisa de sunset obrigatório (mesma mecânica que `deps-audit-allowlist.txt`).
- Soft caps D4 precisam que o plano implementado declare `## Critical paths` para sabermos onde rodar mutation. Plans pre-code (sem code ainda) skipam D4 com soft warning.

### D3 — `plan-confidence` consome o verdict de `/code-quality` (extensão de contrato)

**Decision:** Quando `/code-quality` retorna verdict ≤ FAIL_*, `/plan-confidence` capa na banda correspondente per cap table acima. Stable identifiers participam de `hard_caps_triggered` JSON output.

**Rationale:** Mesmo padrão do `/deps-audit` v1.1 ([cycle-plan.md § Downstream changes](../../rules/cycle-plan.md)). Mantém single point of truth para verdict do plano. Sem essa wiring, `/code-quality` standalone vira "ferramenta opcional", perdendo o gate inquebrável.

**Alternatives considered:**
- **`/code-quality` standalone sem integração com plan-confidence** — rejeitada: skills isoladas perdem o enforcement upstream; usuário pode esquecer de invocar. Mesmo erro que /deps-audit v1.1 quase cometeu (documented-only sem código).
- **`/code-quality` dentro do halt-loop de /implement (per-task)** — rejeitada: explode custos (100-300k tokens × N tasks); dead code emerge entre tasks, não dentro de cada uma; visibilidade só no fim do diff.
- **`/code-quality` invocado por /review (post-merge gate)** — rejeitada: muito tarde no pipeline; pre-merge gate (via plan-confidence) é mais barato corrigir.
- **Sem cycle integration, apenas hook git pre-commit** — rejeitada: hooks de cliente podem ser bypassed (--no-verify); pre-commit não tem contexto do plano (`## Critical paths` etc.); gate inquebrável precisa rodar via skill orquestrada.

**Consequences:**
- `plan-confidence-golden-rule.md` (LOCKED) precisa adicionar stable identifiers. Inquebrável Rule policy: locked file requires explicit ADR-style note + strategic review. Este ADR D3 SERVE como esse note: extensão (não softening), lower burden.
- `cycle-implement.md` ganha fase `/code-quality` entre halt-loop e handoff para `/review` (D4 abaixo).

### D4 — `/code-quality` roda POS-implement, PRE-review (não dentro do halt-loop)

**Decision:** Posição no `cycle-implement` = depois do halt-loop completar todas as tasks, antes do handoff para `/review`. Sibling lateral de `/deps-audit` mas no lado do código (vs. lado de dependências).

**Rationale:**
- Halt-loop de `/implement` já custa 100-300k tokens; mutation testing per-iteration explode custos.
- Dead code emerge POR INTERAÇÃO de tasks (task A cria função X, task B remove o único caller). Visível só ao fim.
- Roda uma vez sobre o diff completo = visão agregada.

**Consequences:**
- `cycle-implement.md` ganha nova subseção "code-quality gate" antes do "HANDOFF — cycle-review can begin".
- `cycle-review.md` confia que `/code-quality` rodou (não re-executa).
- Skill recebe argumento `{slug}` opcional para Mode 2 (plan-bound); standalone Mode 1 audita repo inteiro.

### D5 — Symbol fabrication usa tree-sitter + registry lookup (não LLM-as-judge)

**Decision:** D2 é DETERMINÍSTICO. Pipeline:
1. Parse código novo (diff vs main) via tree-sitter (language-agnostic).
2. Extrai imports/calls/attributes via queries tree-sitter per linguagem.
3. Para cada import declarado: valida contra registry (`npm view`, `pip show`, `cargo search`, `go list`).
4. Para cada call/attribute em lib known: valida assinatura via runtime introspection (Python `inspect`) ou type-info (TS Compiler API via subprocess).
5. Conservative flagging: introspection inconclusiva → WARNING (não BLOCKED).

**Rationale:** [arXiv:2601.19106](https://arxiv.org/abs/2601.19106) reporta 100% precision via AST + KB introspection. LLM-as-judge teria custo de tokens + non-determinism. Determinístico = mais barato + auditável + reproduzível.

**Alternatives considered:**
- LLM-as-judge — rejeitado: custo + variance.
- CodeT (LLM gera testes) — rejeitado: Inquebrável Rule 5 (TDD-first) já cobre; cria conflict.
- MARIN (dependency-constrained decoding) — rejeitado: requer modificar decoding do modelo; não aplicável quando consumimos Claude via API.
- Skip D2 em v0.1 — tentador mas dívida imediata; Spracklen et al. 2025 prova que o gap é real e exploitável.

**Consequences:**
- Skill ganha `tree-sitter` + bindings de linguagem como deps Python.
- Detector precisa de cache local para `npm view` / `pip show` resultados (CI ficaria caro sem cache).
- Test fixtures incluem exemplos KCH (Knowledge Conflicting Hallucinations) por linguagem.

### D6 — Skill implementada em Python (consistência com siblings)

**Decision:** Linguagem da skill = Python 3.10+. Estrutura compatível com `plan-confidence/` e `deps-audit/`: `pyproject.toml`, `setup.sh`, `scripts/`, `tests/`, `fixtures/`, `defaults/`, `templates/`, `SKILL.md`, `PORTABLE.md`.

**Rationale:** Todos os scripts do ecossistema `.claude/skills/` são Python (run_structural.py, check_wiring.py, etc.). Manter consistência reduz fricção cognitiva e permite reuso de utilities (`_shared.py` patterns). Python tem tree-sitter bindings maduras; integração com CLIs externos (knip, vulture, etc.) é trivial via `subprocess`.

**Alternatives considered:**
- TypeScript/Node — rejeitado: violaria consistência; reescreveríamos utilities existentes.
- Rust — rejeitado: maior friction para contributors do ecossistema; mais lento de iterar.
- Shell script — rejeitado: viola SRP; lógica de verdict + allowlist + JSON output é complexa demais para bash.

**Consequences:**
- Skill testada com pytest (mesma stack que plan-confidence).
- Dependências Python declaradas em pyproject.toml; instalação via `setup.sh`.

### D7 — Output dual: JSON (machine-readable) + Markdown (human-readable)

**Decision:** Skill emite DOIS artefatos por invocação:
1. **JSON** em stdout (ou `--json-out {path}`) — consumido por `/plan-confidence` para agregar verdict.
2. **Markdown** em `.claude/knowledge-base/audits/{slug}-code-quality-{date}.md` (Mode 2) ou stdout (Mode 1) — auditoria humana.

**Rationale:** Mesma decisão de `/deps-audit`. JSON é contrato para downstream skills; Markdown é audit trail commit-tracked.

**Alternatives considered:**
- **Apenas JSON** — rejeitada: humano precisa ler findings sem parser; revisão em PR vira leitura de JSON minificado.
- **Apenas Markdown** — rejeitada: `/plan-confidence` precisa parsear o verdict machine-readable; regex em Markdown é frágil.
- **Apenas stdout (sem persistência em arquivo)** — rejeitada: audit trail commit-tracked é requisito do `audit-trail-rotation.md`; sem arquivo em `.claude/knowledge-base/audits/` perdemos histórico para `/review` semântico.
- **YAML em vez de JSON** — rejeitada: JSON tem schema validation maduro (`jsonschema` Python lib); YAML adiciona indentation ambiguity sem ganho real.

**Consequences:**
- Template Markdown em `templates/code-quality-report.md`.
- JSON schema documentado em SKILL.md (estável; mudanças requerem version bump).

### D8 — TDD discipline per detector: positive + negative fixtures por linguagem

**Decision:** Cada detector tem ao menos 2 fixtures por linguagem habilitada:
- **Positive** — fixture contém o defeito (dead code, symbol fabricado, etc.). Test asserta detector FLAGS the issue.
- **Negative** — fixture é código limpo. Test asserta detector NÃO emite falso positivo.

**Rationale:** Inquebrável Rule 5 (TDD-first). Testes só pode validar correção se cobrir AMBOS lados. Vulture 644 FPs em 9 repos top Python é evidência de que detectores naive emitem ruído inviável; fixtures negativas são gate contra essa regressão.

**Alternatives considered:**
- **Só fixtures positive (defect present)** — rejeitada: sem fixtures negative não temos baseline para false-positive rate; vulture com 644 FPs prova que ignorar esse lado é desastre operacional.
- **Property-based testing (Hypothesis para Python, fast-check para TS)** — rejeitada para v0.1: complexidade alta para benefício marginal; defer para v0.2 quando tivermos baseline de fixtures determinísticas.
- **Fixtures real-world (clones de repos OSS conhecidos)** — rejeitada: license overhead (cada repo tem sua licença + atribuição); tamanho do repo da skill explode; manutenção fica acoplada a evolução upstream. Fixtures sintéticas minimalistas (3-10 linhas) são reproduzíveis e suficientes.
- **Snapshot testing (jest-style)** — rejeitada: assertions explícitos são mais legíveis em código de skill que valida outros códigos; meta-testing via snapshot adiciona indireção sem benefício.

**Consequences:**
- ~8 fixtures por detector (2 por linguagem × 4 linguagens). D1 sozinho = 32 fixtures.
- Test suite ≥ 50 testes ao final.
- pytest com markers (`@pytest.mark.python`, etc.) para invocação seletiva.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `pyyaml` | `^6.0` | Python | Config parsing (used by other skills already) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `tree-sitter` (NEW) | `^0.25` | Python | Evaluated: `astroid` (Python-only), `typescript-compiler` via Node (Node dep), `lib2to3` (Py2 legacy). Per-lang ASTs would mean 4 separate implementations. | Language-agnostic single library; battle-tested (used by GitHub semantic, Neovim, Atom). **[v1.2 bump]** Pinned to ^0.25 (latest at audit date) — 0.x semver: minor is breaking; revisit yearly. |
| `tree-sitter-languages` (NEW) | `^1.10` | Python | Evaluated: install each grammar separately (`tree-sitter-python`, `tree-sitter-typescript`, etc.) — more deps to manage. | Bundles 50+ grammars including all 4 target languages |
| `requests` (NEW) | `^2.32` | Python | Evaluated: `httpx` (async, heavier), `urllib` (stdlib but verbose). | Mainstream HTTP client; simple sync API for registry lookups |
| `knip` (NEW) | `^6.14` | npm (external CLI, not Python dep) | Evaluated: ts-prune (DEPRECATED 2024); unimported (less features); depcheck (only deps, not exports). | Knip succeeded ts-prune; first-class monorepo support; matched against [Effective TypeScript article](https://effectivetypescript.com/2023/07/29/knip/). **[v1.2 bump]** Pinned to ^6.14 — v5 → v6 has breaking config-file changes; T1.2 fixture MUST be validated against v6 JSON output schema before implementation. |
| `vulture` (NEW) | `^2.14` | Python (external CLI) | Evaluated: Skylos (not 1.0 yet); deadcode (jovem). | Mature, `--min-confidence 80` mitiga FPs; defer Skylos to v0.2 |
| `cargo-udeps` (NEW) | `^0.1.x` | Rust (external CLI) | Evaluated: cargo-machete (faster, less features). | More features; battle-tested |
| `deadcode` (NEW) | `golang.org/x/tools/cmd/deadcode@v0.45.0` | Go (external CLI) | Evaluated: staticcheck unused (less reliable for interfaces). | Official Go team tool; reachability analysis. **[v1.2 fix F2]** Pinned to v0.45.0 (was `@latest` — violated golden rule). Revisit at v0.5.0 cut. |
| `@stryker-mutator/core` (NEW) | `^9.6` | npm (external CLI) | No mature alternatives in TS ecosystem. | De facto standard. **[v1.2 fix F1]** Package name corrected: unscoped `stryker` on npm is v0.35.1 (abandoned); current pkg is `@stryker-mutator/core` (latest 9.6.1). Bumped from ^8.x (would mismatch wrong package). CLI binary remains `stryker` (invoked as `npx stryker`). |
| `mutmut` (NEW) | `^3.5` | Python (external CLI) | Evaluated: mutpy (abandoned), cosmic-ray (slow). | Most maintained Python mutation tool. **[v1.2 bump]** Bumped from ^2.5 to ^3.5 (latest 3.5.0). **WARNING**: mutmut 3.x is a CLI rewrite — `mutmut run --paths-to-mutate` and `mutmut results --output json` syntax referenced in T4.1 MUST be revalidated against v3 docs before implementation. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | First release of the skill |

## Dependency Graph

```
Phase 0 (Foundation)
   │
   ├──▶ Phase 1 (D1 dead code) ─────┐
   │                                 │
   ├──▶ Phase 2 (D2 symbol fab) ────┤
   │                                 ├──▶ Phase 5 (Orchestrator) ──▶ Phase 6 (Cycle integration)
   ├──▶ Phase 3 (D3 wiring) ────────┤                                  │
   │                                 │                                  ├──▶ T6.1 cycle-implement.md
   └──▶ Phase 4 (D4 mutation) ──────┘                                  ├──▶ T6.2 plan-confidence-golden-rule.md
                                                                        ├──▶ T6.3 token-budget.md
                                                                        ├──▶ T6.4 HOW-TO-USE.md
                                                                        └──▶ T6.5 plan-confidence runtime integration [v1.1 NEW]
                                                                                  │
                                                                                  ▼
                                                                                Final
```

**Parallelism:** Phases 1, 2, 3, 4 can be implemented in parallel after Phase 0 ships. Phase 5 (orchestrator) depends on at least 1 detector being functional. Phase 6 tasks T6.1-T6.4 are independent (docs only); T6.5 depends on T5.1 having `--no-audit-write` flag implemented + verdict JSON schema stable (T5.2).

---

## Phase 0: Foundation — rules + skill scaffolding

**Objective:** Ship the project-rules artifacts and the empty-but-runnable skill skeleton so that subsequent phases plug into a fixed contract.

### T0.1 — Create `.claude/rules/code-quality-golden-rule.md`

#### Objective
Codify the inquebrável contract for `/code-quality` (sibling of `deps-audit-golden-rule.md`) — locks the cap table, stable identifiers, allowlist mechanism, and policy for changes.

#### Evidence
Blueprint D2 + D3 ADRs require this file to exist before `/plan-confidence` can consume verdict (D3 chain). `plan-confidence-golden-rule.md` § "When this rule may change" requires explicit ADR-style note for extensions; this file IS that note for the `/code-quality` integration.

#### Files to edit
```
.claude/rules/code-quality-golden-rule.md — (NEW) inquebrável contract for the skill
```

#### Deep file dependency analysis
- `deps-audit-golden-rule.md` (READ ONLY) — template for shape; copy structure (Rule, What it requires, Severity rubric, Allowlist mechanism, When this rule may change, Related, Log).
- `plan-confidence-golden-rule.md` (will be modified in T6.2 to reference this file's stable identifiers).

#### Deep Dives
**Cap table to encode** (per blueprint D2):
```
HARD CAP (49 — INVALID):  dead_code_unallowlisted_{language}, symbol_fabrication_{language}
HARD CAP (49 — INVALID):  plan_missing_critical_paths_section (when Mode 2 + D4 enabled but plan lacks ## Critical paths)
SOFT CAP (70):            soft_cap_orphan_export_{language}, soft_cap_mutation_score_low_{language}, auditor_unavailable_{tool}
SOFT FLOOR (89):          soft_floor_mutation_score_medium_{language}
```

**Allowlist mechanism** (mesmo formato de deps-audit):
```
ECOSYSTEM|FILE-PATH|FINDING-TYPE|SYMBOL-OR-LINE|REASON|SUNSET-DATE
```
Onde FINDING-TYPE ∈ {dead_code, symbol_fab, orphan_export, mutation_low}.

#### Tasks
1. Copy `deps-audit-golden-rule.md` shape as starting template.
2. Replace CVE-focused content with code-quality findings (dead code, symbol fab, orphan export, mutation).
3. Encode cap table from blueprint D2.
4. Document allowlist format with sunset (≤ 30 days for HARD CAP findings; ≤ 90 days for SOFT).
5. Add "Log of changes" section seeded with `2026-05-22 | Rule created at day 0 of /code-quality skill.`.
6. **[EC-28]** Create `CHANGELOG.md` at repo root with `# Changelog` header + `## [Unreleased]` section + `### Added — code-quality skill scaffolding (TheoMemory entry).` Inquebrável Rule 6 mandates the file exists. Future tasks add entries under `[Unreleased]`.

#### TDD
```
RED:     test_golden_rule_file_exists() — assert .claude/rules/code-quality-golden-rule.md exists
RED:     test_golden_rule_lists_all_stable_identifiers() — parse file, assert ≥ 6 stable identifiers from cap table
RED:     test_golden_rule_has_allowlist_format_spec() — parse file, find pipe-separated format example
GREEN:   Write the .md file with all required sections.
REFACTOR: None expected (specification document).
VERIFY:  pytest .claude/skills/code-quality/tests/test_golden_rule.py
```

#### Acceptance Criteria
- [ ] File `.claude/rules/code-quality-golden-rule.md` exists with all sections from `deps-audit-golden-rule.md` template
- [ ] Cap table encoded with 6+ stable identifiers
- [ ] Allowlist format specified with sunset policy
- [ ] No `--force` / `--skip-checks` flag documented (skill contract)
- [ ] Pass: size — file ≤ 500 lines
- [ ] Pass: cross-ref — file references `cycle-plan.md`, `plan-confidence-golden-rule.md`, `code-quality-thresholds.txt`, `code-quality-allowlist.txt`
- [ ] **[EC-28]** `CHANGELOG.md` at repo root exists with `[Unreleased]` section + initial entry referring to this skill

#### DoD
- [ ] All RED tests now GREEN
- [ ] `python3 .claude/scripts/check_xrefs.py` succeeds (no broken cross-references)

---

### T0.2 — Create `.claude/rules/code-quality-languages.txt`, `code-quality-thresholds.txt`, `code-quality-allowlist.txt`

#### Objective
Ship the 3 config files that drive the skill: which languages habilitar, threshold values per detector, and the seed-empty allowlist.

#### Evidence
Blueprint D1 explicitly requires `code-quality-languages.txt` as a commit-tracked declarative config (user decision via AskUserQuestion: "Configurável via .claude/rules/code-quality-languages.txt"). Same pattern as `deps-audit-allowlist.txt` + `plan-confidence-thresholds.txt`.

#### Files to edit
```
.claude/rules/code-quality-languages.txt — (NEW) declarative list of habilitadas
.claude/rules/code-quality-thresholds.txt — (NEW) per-detector floors
.claude/rules/code-quality-allowlist.txt — (NEW) seed-empty allowlist
```

#### Deep file dependency analysis
- `deps-audit-allowlist.txt` (READ ONLY) — template for shape.
- `plan-confidence-thresholds.txt` (READ ONLY) — template for thresholds shape.

#### Deep Dives
**`code-quality-languages.txt` format** (one entry per line, `#` comments):
```
# Language enablement — commit-tracked declarative config
# Format: LANGUAGE | MANIFEST-MARKER | STATUS | NOTES
#
# LANGUAGE        ∈ { python, typescript, rust, go }
# MANIFEST-MARKER — filename used by auto-detection (auto-detect runs only if marker present)
# STATUS          ∈ { ENABLED, DISABLED, DEFER }  (DEFER reported as "scheduled" in audit)
#
python     | pyproject.toml   | ENABLED  | Used heavily in .claude/skills/scripts/
typescript | package.json     | ENABLED  | TheoMemory @usetheo/memory primary package
rust       | Cargo.toml       | ENABLED  | Future core / performance-critical modules
go         | go.mod           | ENABLED  | Future server / runtime
```

**`code-quality-thresholds.txt` format** (key=value, `#` comments):
```
# Code-quality thresholds — per-detector floors
# Authoritative source: .claude/rules/code-quality-golden-rule.md § Severity rubric
# Sunset for default values: 2027-05-22 (revisit yearly)

# D1 dead code
vulture.min_confidence = 80
knip.exit_code = strict
cargo_udeps.fail_on_unused = true
deadcode.fail_on_unused = true

# D2 symbol fabrication
symbol_fab.cache_ttl_hours = 24
symbol_fab.registry_timeout_seconds = 5
symbol_fab.fallback_on_introspection_failure = warning  # not blocked

# D4 mutation
mutation.critical_paths_required = true
mutation.score_floor_high = 80
mutation.score_floor_low = 60
mutation.timeout_minutes = 5
```

**`code-quality-allowlist.txt` format** (commented seed):
```
# Code-quality allowlist — findings exemptions with mandatory sunset
# Authoritative source: .claude/rules/code-quality-golden-rule.md § Allowlist mechanism
#
# Format (one entry per line):
#   ECOSYSTEM|FILE-PATH|FINDING-TYPE|SYMBOL-OR-LINE|REASON|SUNSET-DATE
#
# ECOSYSTEM     ∈ { python, typescript, rust, go }
# FINDING-TYPE  ∈ { dead_code, symbol_fab, orphan_export, mutation_low }
# SUNSET-DATE   ≤ 30 days for HARD CAP findings, ≤ 90 days for SOFT
#
# Example (commented):
# python|.claude/skills/foo/scripts/legacy.py|dead_code|unused_helper|Pending refactor|2026-07-22
```

#### Tasks
1. Write `code-quality-languages.txt` with 4 languages = ENABLED per user direction.
2. Write `code-quality-thresholds.txt` with values from blueprint + Stryker docs consensus.
3. Write `code-quality-allowlist.txt` with header comments only (no seed entries — clean start).

#### TDD
```
RED:     test_languages_file_parseable() — parse file, assert 4 entries (python/ts/rust/go)
RED:     test_thresholds_file_parseable() — parse file, assert keys for D1/D2/D4 present
RED:     test_allowlist_file_seed_empty() — parse file, assert zero active entries
GREEN:   Write 3 files with the formats above.
REFACTOR: None expected.
VERIFY:  pytest .claude/skills/code-quality/tests/test_config_files.py
```

#### Acceptance Criteria
- [ ] All 3 files exist under `.claude/rules/`
- [ ] Files parseable by `_shared.py` config loader (built in T0.4)
- [ ] Allowlist seed is empty (only commented header)
- [ ] Pass: size — each file ≤ 200 lines (small config files)

#### DoD
- [ ] All RED tests GREEN
- [ ] Files committed in same commit as T0.1

---

### T0.3 — Create skill skeleton: SKILL.md, PORTABLE.md, pyproject.toml, setup.sh, directory tree

#### Objective
Bootstrap the entire skill directory layout with empty-but-importable Python modules + matching tests directory, so that subsequent phases plug into a known structure.

#### Evidence
Sibling skill `deps-audit/` shape. User direction: "crie uma pasta dentro da skills/scripts e crie o script para ela" — interpretado como `scripts/detectors/` subfolder com módulo por linguagem.

#### Files to edit
```
.claude/skills/code-quality/SKILL.md — (NEW) entry-point doc per skill convention
.claude/skills/code-quality/PORTABLE.md — (NEW) standalone setup doc (per plan-confidence pattern)
.claude/skills/code-quality/pyproject.toml — (NEW) Python project + deps declaration
.claude/skills/code-quality/setup.sh — (NEW) installer script (venv + pip install -e .)
.claude/skills/code-quality/scripts/__init__.py — (NEW) empty package marker
.claude/skills/code-quality/scripts/run_code_quality.py — (NEW) entrypoint stub (raises NotImplementedError; filled in Phase 5)
.claude/skills/code-quality/scripts/detectors/__init__.py — (NEW) empty package marker
.claude/skills/code-quality/scripts/detectors/python.py — (NEW) stub class PythonDetector with abstract methods
.claude/skills/code-quality/scripts/detectors/typescript.py — (NEW) stub class
.claude/skills/code-quality/scripts/detectors/rust.py — (NEW) stub class
.claude/skills/code-quality/scripts/detectors/go.py — (NEW) stub class
.claude/skills/code-quality/templates/code-quality-report.md — (NEW) Markdown report template (skeleton)
.claude/skills/code-quality/defaults/thresholds.txt — (NEW) fallback copy of .claude/rules/code-quality-thresholds.txt
.claude/skills/code-quality/defaults/languages.txt — (NEW) fallback copy
.claude/skills/code-quality/tests/__init__.py — (NEW) empty
.claude/skills/code-quality/tests/conftest.py — (NEW) pytest fixtures shared
.claude/skills/code-quality/fixtures/python/dead_code_present/example.py — (NEW) positive fixture stub
.claude/skills/code-quality/fixtures/python/clean/example.py — (NEW) negative fixture stub
(similar fixture stubs for typescript/, rust/, go/)
```

#### Deep file dependency analysis
- `plan-confidence/pyproject.toml` (READ ONLY) — template for Python project metadata.
- `plan-confidence/setup.sh` (READ ONLY) — template for installer.
- `deps-audit/SKILL.md` (READ ONLY) — template for SKILL.md frontmatter (`name:`, `description:`, `user-invocable: true`, `allowed-tools:`, `argument-hint:`).

#### Deep Dives
**SKILL.md frontmatter:**
```yaml
---
name: code-quality
description: Audit TheoMemory code for dead symbols, fabricated APIs, cross-package orphans, and weak test quality across TypeScript, Python, Rust, and Go. Auto-detects manifests; runs knip + vulture + cargo-udeps + deadcode + tree-sitter symbol fabrication checks + ast-grep cross-package wiring + stryker/mutmut mutation testing. Read-only by design (never edits code). Use after /implement completes its halt-loop, before /review begins — or standalone for periodic audits.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "[plan-slug] (optional — bind audit to a plan's Critical paths section)"
---
```

**`PythonDetector` abstract interface** (filled in subsequent phases):
```python
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Finding:
    detector: str           # "d1_dead_code" / "d2_symbol_fab" / etc.
    language: str           # "python" / "typescript" / etc.
    severity: str           # "HARD" / "SOFT_CAP" / "SOFT_FLOOR" / "INFO"
    file_path: str
    symbol_or_line: str
    message: str
    allowlist_key: str      # stable identifier used to match allowlist entries

class BaseDetector:
    language: str = ""
    manifest_marker: str = ""

    def detect_dead_code(self, repo_root: Path) -> list[Finding]: ...
    def detect_symbol_fabrication(self, diff_paths: list[Path]) -> list[Finding]: ...
    def detect_orphan_exports(self, repo_root: Path) -> list[Finding]: ...
    def detect_mutation_score(self, critical_paths: list[Path]) -> list[Finding]: ...
```

#### Tasks
1. Create directory tree `mkdir -p` for all paths above.
2. Write `SKILL.md` with frontmatter + Trigger conditions + Modes + Workflow placeholder sections (mirror deps-audit shape; fill in later phases).
3. Write `PORTABLE.md` describing standalone installation (matches plan-confidence/PORTABLE.md pattern). **[v1.2 F6]** Include `## Dev prerequisites` section listing recommended (not mandatory) external tools: `osv-scanner` (cross-ecosystem CVE scanner — install via `go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`), `knip` (^6.14), `vulture` (^2.14), `cargo-udeps` (^0.1), `deadcode@v0.45.0`, `@stryker-mutator/core` (^9.6), `mutmut` (^3.5). Without these, the corresponding detectors emit `auditor_unavailable_{tool}` SOFT_CAP Findings.
4. Write `pyproject.toml` declaring Python deps (`tree-sitter`, `tree-sitter-languages`, `requests`, `pyyaml`, `pytest`, `pytest-mock`).
5. Write `setup.sh` (venv + `pip install -e .`).
6. Write detector stubs with `BaseDetector` interface + raise `NotImplementedError` on each method.
7. Write `templates/code-quality-report.md` skeleton (sections to be filled in Phase 5).
8. Copy thresholds.txt + languages.txt into defaults/ as fallback.
9. Write empty conftest.py with `repo_root` fixture.
10. Create fixture stubs (empty .py files for positive/negative cases per language).

#### TDD
```
RED:     test_skill_md_frontmatter_parseable() — load SKILL.md, assert YAML frontmatter valid
RED:     test_pyproject_toml_declares_required_deps() — parse pyproject.toml, assert tree-sitter, tree-sitter-languages, requests, pyyaml, pytest present
RED:     test_detector_modules_importable() — import .scripts.detectors.{python,typescript,rust,go}; assert BaseDetector subclasses exist
RED:     test_detector_methods_raise_not_implemented() — call each detector method, assert NotImplementedError raised
GREEN:   Write all files per the layout above.
REFACTOR: None expected (scaffolding).
VERIFY:  pytest .claude/skills/code-quality/tests/test_skeleton.py
```

#### Acceptance Criteria
- [ ] All directories + files created
- [ ] `setup.sh` runs to completion without errors
- [ ] `python -c "from scripts.detectors import python, typescript, rust, go"` succeeds
- [ ] Pass: size — each detector stub file ≤ 100 lines (just interface)
- [ ] Pass: lint — `ruff check .claude/skills/code-quality/` zero errors

#### DoD
- [ ] All RED tests GREEN
- [ ] Skill discoverable by Claude Code (frontmatter valid)

---

### T0.4 — Create `scripts/_shared.py`: config loader + allowlist parser + Finding dataclass + report writer utilities

#### Objective
Centralize cross-detector utilities so each detector phase doesn't reimplement config loading, allowlist matching with sunset, finding serialization.

#### Evidence
Sibling skill `_shared.py` patterns (visible in plan-confidence). DRY (Inquebrável § 12): every detector needs allowlist matching; centralize.

#### Files to edit
```
.claude/skills/code-quality/scripts/_shared.py — (NEW) utilities module
.claude/skills/code-quality/tests/test_shared.py — (NEW) test suite
```

#### Deep file dependency analysis
- `BaseDetector` (from T0.3) consumes `Finding` dataclass.
- `run_code_quality.py` (Phase 5) consumes `load_config`, `match_allowlist`, `write_report`.

#### Deep Dives
**`_shared.py` API:**
```python
DEFAULT_SKIP_DIRS = frozenset({
    ".git", "node_modules", ".venv", "venv", "__pycache__",
    "target", "dist", "build", "out", "referencia",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", ".hypothesis",
    "vendor",   # Go vendored deps
    ".cache",
})
# [EC-10] Skill consumers MUST apply this set when enumerating files.

def load_languages_config(rule_file: Path) -> dict[str, dict]:
    """Parse .claude/rules/code-quality-languages.txt → {language: {manifest, status, notes}}."""

def load_thresholds(rule_file: Path) -> dict[str, str | int | float]:
    """Parse key=value thresholds; coerce types."""

def load_allowlist(rule_file: Path) -> list[AllowlistEntry]:
    """Parse pipe-separated allowlist; return entries with parsed sunset dates.
    [EC-4] SUNSET-DATE field validated against regex ^\\d{4}-\\d{2}-\\d{2}$ + datetime.strptime.
    Malformed entries SHALL NOT be silently dropped — they emit a Finding with
    allowlist_key='allowlist_malformed_entry' severity=HARD. This is the only
    way an entry typo gets surfaced (otherwise it silently bypasses the gate)."""

def is_allowlisted(finding: Finding, allowlist: list[AllowlistEntry], today: date) -> AllowlistMatch:
    """Match finding against allowlist; return ACTIVE | EXPIRED | NOT_LISTED.
    ACTIVE entries downgrade severity by 1 level (HARD → SOFT_CAP).
    EXPIRED entries are IGNORED (finding re-fires at full severity)."""

def write_audit_report(findings: list[Finding], output_path: Path, mode: str, slug: str | None) -> None:
    """Render Markdown report via templates/code-quality-report.md template."""

def emit_json_summary(findings: list[Finding], verdict: str, hard_caps_triggered: list[str]) -> dict:
    """Build JSON object for /plan-confidence consumption."""

def safe_parse_json(stdout: str, tool_name: str) -> tuple[dict | list | None, Finding | None]:
    """[EC-1] Wrap json.loads() with explicit error handling. On JSONDecodeError,
    return (None, Finding(allowlist_key=f'auditor_output_malformed_{tool_name}', severity=SOFT_CAP)).
    Used by every detector that subprocesses external CLIs whose output drifts between versions.
    NEVER let JSONDecodeError bubble — orchestrator isolation depends on graceful per-detector handling."""

def write_atomic(target: Path, content: str | bytes) -> None:
    """[EC-9] Write file atomically: tempfile in same dir + os.replace.
    Required for any cross-process state (registry cache, etc.).
    POSIX guarantees atomic rename within the same filesystem."""

def make_relative(path: Path, repo_root: Path) -> str:
    """[EC-12] Always return repo-relative path. Used to standardize Finding.file_path
    so allowlist_key matching is deterministic across machines (absolute vs relative paths break matching)."""

def sanitize_symbol(symbol: str) -> str:
    """[EC-12] Escape pipe characters in symbol names so allowlist_key parsing stays unambiguous.
    Replace '|' with '\\|'."""
```

**Finding dataclass invariants (EC-12):**

```python
@dataclass
class Finding:
    detector: str
    language: str
    severity: str
    file_path: str            # ALWAYS repo-relative (use make_relative)
    symbol_or_line: str       # ALWAYS sanitized via sanitize_symbol
    message: str
    allowlist_key: str        # ALWAYS = f"{language}|{file_path}|{finding_type}|{symbol_sanitized}"

    def __post_init__(self):
        assert not self.file_path.startswith("/"), "Finding.file_path must be repo-relative"
        assert "|" not in self.allowlist_key.split("|")[-1].replace("\\|", ""), \
            "symbol must be sanitized"
```

#### Tasks
1. Implement `load_languages_config` parser (handles `#` comments, pipe-separated, validates STATUS enum).
2. Implement `load_thresholds` parser (key=value; coerce int/float/str).
3. Implement `load_allowlist` parser (pipe-separated; parse SUNSET-DATE as `date`; **[EC-4]** reject malformed via regex + strptime validation; emit `allowlist_malformed_entry` Finding HARD on any malformed entry).
4. Implement `is_allowlisted` with sunset logic.
5. Implement `Finding` + `AllowlistEntry` + `AllowlistMatch` dataclasses with `__post_init__` invariants (**[EC-12]** repo-relative paths + sanitized symbols).
6. Implement `write_audit_report` using string template (Jinja2 is overkill; use `.format()` per template variables).
7. Implement `emit_json_summary` per JSON schema (documented in SKILL.md).
8. **[EC-1]** Implement `safe_parse_json(stdout, tool_name)` helper; document in `_shared.py` API.
9. **[EC-9]** Implement `write_atomic(target, content)` helper.
10. **[EC-10]** Export `DEFAULT_SKIP_DIRS` frozenset; document that all file-enumeration code paths MUST apply.
11. **[EC-12]** Implement `make_relative(path, repo_root)` + `sanitize_symbol(symbol)` helpers.

#### TDD
```
RED:     test_load_languages_config_parses_4_entries() — parse fixture, assert dict has python/ts/rust/go keys
RED:     test_load_languages_config_rejects_invalid_status() — parse fixture with STATUS=INVALID, assert raises ValueError
RED:     test_load_thresholds_coerces_types() — assert vulture.min_confidence is int, mutation.score_floor_low is float-or-int
RED:     test_load_allowlist_parses_sunset_date() — parse fixture entry, assert sunset_date is date(2026, 8, 1)
RED:     test_is_allowlisted_returns_active_within_sunset() — finding matches entry; today < sunset; return ACTIVE
RED:     test_is_allowlisted_returns_expired_after_sunset() — finding matches; today > sunset; return EXPIRED
RED:     test_is_allowlisted_returns_not_listed_no_match() — finding key not in allowlist; return NOT_LISTED
RED:     test_write_audit_report_creates_file_with_findings_section() — call write; assert file exists; file contains "## Findings"
RED:     test_emit_json_summary_includes_hard_caps_triggered() — given finding with severity=HARD; assert hard_caps_triggered list non-empty
RED:     test_load_allowlist_rejects_malformed_sunset_date()  [EC-4] — parse fixture with "01/08/2026" (locale BR) and empty sunset; assert returns allowlist_malformed_entry Finding for each
RED:     test_load_allowlist_rejects_invalid_calendar_date()  [EC-4] — parse "2026-13-45"; assert allowlist_malformed_entry Finding
RED:     test_safe_parse_json_returns_finding_on_decode_error()  [EC-1] — pass truncated JSON; assert (None, Finding(allowlist_key="auditor_output_malformed_vulture"))
RED:     test_safe_parse_json_returns_data_on_valid_json()  [EC-1] — pass valid JSON; assert (data, None)
RED:     test_write_atomic_does_not_leave_partial_file()  [EC-9] — interrupt mid-write (mock); assert target file is either unchanged OR fully written; never partial
RED:     test_finding_post_init_rejects_absolute_path()  [EC-12] — construct Finding(file_path="/abs/path"); assert AssertionError
RED:     test_finding_post_init_rejects_unsanitized_symbol_in_key()  [EC-12] — construct Finding with allowlist_key containing literal "|" in symbol portion; assert AssertionError
RED:     test_make_relative_strips_repo_root_prefix()  [EC-12] — make_relative(/repo/foo.py, /repo) == "foo.py"
RED:     test_sanitize_symbol_escapes_pipes()  [EC-12] — sanitize_symbol("foo|bar") == "foo\\|bar"
RED:     test_default_skip_dirs_includes_referencia()  [EC-10] — assert "referencia" in DEFAULT_SKIP_DIRS
GREEN:   Implement _shared.py with all functions above.
REFACTOR: Extract any duplicated parse logic into helper.
VERIFY:  pytest .claude/skills/code-quality/tests/test_shared.py -v
```

#### Acceptance Criteria
- [ ] All 19 RED tests GREEN (9 original + 10 new from EC-1/EC-4/EC-9/EC-10/EC-12 absorption)
- [ ] `_shared.py` ≤ 500 lines (was 400; bumped to absorb EC helpers). If excedido, split into _config.py + _allowlist.py + _report.py + _io.py
- [ ] Test coverage on `_shared.py` ≥ 95% (critical path: 100%)
- [ ] Pass: lint — `ruff check` zero errors
- [ ] Pass: complexity — no function with cyclomatic complexity > 10

#### DoD
- [ ] All RED tests GREEN
- [ ] `pytest .claude/skills/code-quality/tests/test_shared.py --cov=scripts._shared` reports ≥ 95%

---

## Phase 1: D1 dead code detectors

**Objective:** Implement 4 dead-code wrappers (one per language) each subprocess-ing the canonical external tool, parsing output, emitting `Finding` objects.

### T1.1 — Python detector: vulture wrapper

#### Objective
Wrap `vulture --min-confidence 80 {paths}` + parse output into `Finding` list. Run on `.claude/skills/**/scripts/` (real codebase that exists today) + fixtures.

#### Evidence
Blueprint Corner 1 Python ecosystem: Vulture maduro mas com FP alto; mitigação via `--min-confidence 80`. Skylos defer to v0.2 per ADR D1.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/python.py — (MODIFY) implement detect_dead_code
.claude/skills/code-quality/tests/test_python_detector.py — (NEW)
.claude/skills/code-quality/fixtures/python/dead_code_present/example.py — (MODIFY) add unused function `_orphan_helper`
.claude/skills/code-quality/fixtures/python/clean/example.py — (MODIFY) clean code (all symbols used)
```

#### Deep file dependency analysis
- `BaseDetector` (T0.3) — `python.py` already imports.
- `_shared.py` `Finding` (T0.4) — emit instances.
- External `vulture` CLI must be installed in env; if missing, detector emits `auditor_unavailable_vulture` Finding (per golden rule SOFT CAP).

#### Deep Dives
**Vulture output format:** `path:line: unused {type} '{name}' ({confidence}% confidence)`.

**Mapping to Finding:**
```python
Finding(
  detector="d1_dead_code",
  language="python",
  severity="HARD",
  file_path=parsed.path,
  symbol_or_line=f"{parsed.name} (line {parsed.line})",
  message=f"Unused {parsed.type} '{parsed.name}' ({parsed.confidence}% confidence)",
  allowlist_key=f"python|{parsed.path}|dead_code|{parsed.name}",
)
```

**Subprocess invocation:**
```python
result = subprocess.run(
    ["vulture", "--min-confidence", str(min_conf), *paths],
    capture_output=True, text=True, timeout=120,
)
# vulture returns exit code 0 (no findings), 1 (findings), 2 (error)
# Findings on stdout; errors on stderr
```

**Edge cases:**
- vulture binary missing → emit `auditor_unavailable_vulture` Finding (severity SOFT_CAP).
- Timeout → emit `auditor_timeout_vulture` (SOFT_CAP).
- vulture errors out (exit 2) → emit `auditor_error_vulture` with stderr captured.

#### Tasks
1. Implement `PythonDetector.detect_dead_code(repo_root)`.
2. Add `_run_vulture(paths, min_conf)` helper.
3. Add `_parse_vulture_output(stdout)` helper.
4. Handle subprocess errors (missing binary, timeout, error exit code).
5. Write positive fixture: `unused_helper()` function never called.
6. Write negative fixture: `used_helper()` called from `__main__`.

#### TDD
```
RED:     test_python_detector_flags_unused_function() — given positive fixture; assert ≥ 1 Finding with detector=d1_dead_code
RED:     test_python_detector_no_findings_on_clean_fixture() — given negative fixture; assert 0 Findings
RED:     test_python_detector_emits_auditor_unavailable_when_vulture_missing() — mock subprocess to raise FileNotFoundError; assert Finding(allowlist_key includes "auditor_unavailable_vulture")
RED:     test_python_detector_respects_min_confidence_threshold() — given fixture with 70% confidence FP; with threshold 80, assert 0 Findings
GREEN:   Implement PythonDetector.detect_dead_code + helpers.
REFACTOR: Extract subprocess pattern into _shared.py if reused in T1.2-T1.4.
VERIFY:  pytest .claude/skills/code-quality/tests/test_python_detector.py -v
```

#### Acceptance Criteria
- [ ] 4 RED tests GREEN
- [ ] `PythonDetector.detect_dead_code` ≤ 200 lines
- [ ] Real-world test: run detector against `.claude/skills/*/scripts/` and document findings count in test output (don't fail the test on count; just smoke test that it runs)
- [ ] Pass: lint — `ruff check scripts/detectors/python.py`
- [ ] Pass: size — file ≤ 300 lines

#### DoD
- [ ] All RED tests GREEN
- [ ] Smoke test passes against real `.claude/skills/` codebase

---

### T1.2 — TypeScript detector: knip wrapper

#### Objective
Wrap `knip --reporter json` + parse output into `Finding` list. Adoption pattern: start lenient (`--no-exit-code`), evolve to strict per knip docs.

#### Evidence
Blueprint Corner 1 TS ecosystem: knip succeeded ts-prune (deprecated 2024); first-class monorepo support. Adoption recommended lenient → strict.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/typescript.py — (MODIFY) implement detect_dead_code
.claude/skills/code-quality/tests/test_typescript_detector.py — (NEW)
.claude/skills/code-quality/fixtures/typescript/dead_code_present/src/orphan.ts — (NEW) unused export
.claude/skills/code-quality/fixtures/typescript/dead_code_present/package.json — (NEW) minimal
.claude/skills/code-quality/fixtures/typescript/clean/src/used.ts — (NEW) all exports used
.claude/skills/code-quality/fixtures/typescript/clean/package.json — (NEW)
```

#### Deep file dependency analysis
- Reuses `_run_subprocess` helper from T1.1 (extracted to _shared.py if applicable).
- Fixtures need their own `package.json` so knip can analyze them as standalone "packages".

#### Deep Dives
**Knip JSON output shape** (per [knip docs](https://knip.dev/explanations/comparison-and-migration)):
```json
{
  "files": ["src/orphan.ts"],
  "exports": [{"file": "src/foo.ts", "name": "unusedExport"}],
  "dependencies": [{"name": "unused-dep"}],
  "devDependencies": [],
  "duplicates": []
}
```

**Mapping to Finding:** one Finding per entry in `files` + `exports` + `dependencies`.

**Strict vs lenient:** in v0.1 we run STRICT (`knip --reporter json`) and emit hard-cap Findings. Lenient mode is opt-in via threshold `knip.exit_code = lenient` in `code-quality-thresholds.txt`.

#### Tasks
1. Implement `TypeScriptDetector.detect_dead_code(repo_root)`.
2. Add `_run_knip(repo_root, strict)` helper.
3. Add `_parse_knip_json(stdout)` helper.
4. Handle missing knip binary (emit `auditor_unavailable_knip`).
5. Write positive + negative fixtures with proper `package.json`.

#### TDD
```
RED:     test_typescript_detector_flags_unused_export() — given positive fixture; assert ≥ 1 Finding with symbol_or_line="unusedExport"
RED:     test_typescript_detector_flags_unused_file() — given positive fixture with unimported file; assert Finding for that file
RED:     test_typescript_detector_no_findings_on_clean() — assert 0 Findings on negative fixture
RED:     test_typescript_detector_emits_auditor_unavailable_when_knip_missing() — assert proper Finding
GREEN:   Implement TypeScriptDetector.detect_dead_code + helpers.
REFACTOR: None expected.
VERIFY:  pytest .claude/skills/code-quality/tests/test_typescript_detector.py -v
```

#### Acceptance Criteria
- [ ] 4 RED tests GREEN
- [ ] Real-world test (when `src/` exists in TheoMemory): run against `src/` (or skip with WARNING if `src/` doesn't exist yet)
- [ ] Pass: size — file ≤ 300 lines
- [ ] Pass: lint
- [ ] **[v1.2 F5]** Knip JSON output schema validated against v6.x (NOT v5.x — plan bumped due to /deps-audit F5). If v6 reporter shape differs from `{files, exports, dependencies, devDependencies, duplicates}`, update `_parse_knip_json` accordingly.

#### DoD
- [ ] All RED tests GREEN
- [ ] Skip-test passes gracefully when TheoMemory's `src/` doesn't exist
- [ ] Knip v6 JSON schema documented in code comment

---

### T1.3 — Rust detector: cargo-udeps wrapper

#### Objective
Wrap `cargo +nightly udeps --output json` + parse output. cargo-udeps requires nightly toolchain.

#### Evidence
Blueprint Corner 1 Rust ecosystem: cargo-udeps over cargo-machete (more features, more battle-tested).

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/rust.py — (MODIFY) implement detect_dead_code
.claude/skills/code-quality/tests/test_rust_detector.py — (NEW)
.claude/skills/code-quality/fixtures/rust/dead_code_present/Cargo.toml — (NEW) declare unused dep
.claude/skills/code-quality/fixtures/rust/dead_code_present/src/lib.rs — (NEW)
.claude/skills/code-quality/fixtures/rust/clean/Cargo.toml — (NEW)
.claude/skills/code-quality/fixtures/rust/clean/src/lib.rs — (NEW)
```

#### Deep file dependency analysis
- Requires `cargo +nightly` available; gate with auditor_unavailable if not.
- Fixtures require `cargo build` to run before udeps (udeps reads metadata).

#### Deep Dives
**cargo-udeps JSON output:**
```json
{"unused_deps": {"package-name": {"normal": ["dep-name"], "development": [], "build": []}}}
```

**Special concern (Rust):** `#![deny(dead_code)]` at crate root would make `rustc` itself fail on dead code; this is OUT OF SCOPE for the detector (compiler does the work). Detector focuses on unused deps + (future v0.2) `cargo-machete` for unused-file detection.

#### Tasks
1. Implement `RustDetector.detect_dead_code`.
2. Wrap subprocess + nightly toolchain check.
3. Parse JSON.
4. Write fixtures (cargo new --lib pattern, minimal).

#### TDD
```
RED:     test_rust_detector_flags_unused_dep() — assert Finding for unused dep in fixture
RED:     test_rust_detector_no_findings_on_clean() — assert 0 Findings on clean
RED:     test_rust_detector_emits_auditor_unavailable_when_nightly_missing() — mock cargo +nightly to fail; assert proper Finding
GREEN:   Implement RustDetector.detect_dead_code.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_rust_detector.py -v
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] Skip test if `cargo +nightly` unavailable in dev env (emit clear skip reason)
- [ ] Pass: size — file ≤ 300 lines

#### DoD
- [ ] All RED tests GREEN
- [ ] Documented in PORTABLE.md: "Rust detector requires nightly toolchain via rustup"

---

### T1.4 — Go detector: deadcode wrapper

#### Objective
Wrap `deadcode -json ./...` + parse output. deadcode is `golang.org/x/tools/cmd/deadcode` (official Go team tool).

#### Evidence
Blueprint Corner 1 Go ecosystem: official Go team tool; reachability analysis; entende interfaces.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/go.py — (MODIFY)
.claude/skills/code-quality/tests/test_go_detector.py — (NEW)
.claude/skills/code-quality/fixtures/go/dead_code_present/go.mod — (NEW)
.claude/skills/code-quality/fixtures/go/dead_code_present/main.go — (NEW) unreachable function
.claude/skills/code-quality/fixtures/go/clean/go.mod — (NEW)
.claude/skills/code-quality/fixtures/go/clean/main.go — (NEW)
```

#### Deep file dependency analysis
- Requires `go` toolchain + `deadcode` binary installed via `go install`.
- Fixtures need `go mod tidy` before deadcode runs.

#### Deep Dives
**deadcode JSON output:**
```json
[
  {"position": "main.go:42:6", "name": "unreachableFunc", "generated": false}
]
```

#### Tasks
1. Implement `GoDetector.detect_dead_code`.
2. Wrap subprocess + check `deadcode` binary present.
3. Parse JSON output.
4. Write fixtures.

#### TDD
```
RED:     test_go_detector_flags_unreachable_function() — assert Finding for unreachable func
RED:     test_go_detector_no_findings_on_clean() — assert 0 Findings
RED:     test_go_detector_emits_auditor_unavailable_when_deadcode_missing() — assert Finding
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_go_detector.py -v
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] Pass: size — file ≤ 300 lines

#### DoD
- [ ] All RED tests GREEN
- [ ] Documented in PORTABLE.md installation steps

---

## Phase 2: D2 symbol fabrication detectors

**Objective:** Implement tree-sitter-based AST parsing + registry lookup to detect fabricated packages, classes, functions, methods that don't exist.

### T2.1 — tree-sitter scaffolding + per-language import/call extraction

#### Objective
Build the shared `scripts/check_symbol_fab.py` module that uses tree-sitter to parse code in each language + extract imports/calls/attributes for downstream validation.

#### Evidence
ADR D5: deterministic via tree-sitter (language-agnostic) + registry lookup. arXiv:2601.19106 reports 100% precision via this approach.

#### Files to edit
```
.claude/skills/code-quality/scripts/check_symbol_fab.py — (NEW) tree-sitter parser + queries
.claude/skills/code-quality/tests/test_symbol_fab_parser.py — (NEW)
```

#### Deep file dependency analysis
- `tree-sitter-languages` dep (declared in T0.3 pyproject.toml).
- Each language requires its own tree-sitter query string (S-expressions).

#### Deep Dives
**API:**
```python
@dataclass
class ExtractedSymbol:
    language: str
    file_path: str
    line: int
    column: int
    kind: str  # "import" | "call" | "attribute"
    module: str  # for imports: package name; for calls/attrs: lib name
    symbol: str  # the called function / accessed attribute
    full_text: str  # raw matched text

def extract_imports_and_calls(file_path: Path, language: str) -> list[ExtractedSymbol]: ...
```

**Tree-sitter query strings (one per language):**
```python
PYTHON_QUERY = """
(import_statement name: (dotted_name) @import)
(import_from_statement module_name: (dotted_name) @import)
(call function: [(identifier) @call (attribute attribute: (identifier) @method)])
"""

TYPESCRIPT_QUERY = """
(import_statement source: (string) @import)
(call_expression function: [(identifier) @call (member_expression property: (property_identifier) @method)])
"""
# similar for rust, go
```

**Pitfalls (documented as comments in code):**
- Python: `import foo as bar` → module is `foo`, alias `bar`. Track alias to dedup later.
- TypeScript: `import { x } from 'foo'` → module `foo`, named import `x`. `import * as ns` → all-of-foo.
- Rust: `use foo::bar` → crate `foo`, path `bar`. Crate names may use `-` or `_`.
- Go: `import "github.com/x/y"` → module is the import path; package is last segment.

#### Tasks
1. Implement `extract_imports_and_calls` with tree-sitter.
2. Write per-language query S-expressions.
3. Handle aliases (track alias → real-name mapping).
4. Handle re-exports (Python `from x import y as z`).
5. Skip in-language stdlib (tracked via per-language stdlib lists).

#### TDD
```
RED:     test_extract_python_import_statement() — parse "import requests"; assert ExtractedSymbol(module="requests", kind="import")
RED:     test_extract_python_from_import() — parse "from foo.bar import baz"; assert module="foo.bar", symbol="baz"
RED:     test_extract_python_method_call() — parse "obj.method()"; assert kind="attribute", symbol="method"
RED:     test_extract_typescript_named_import() — parse 'import { foo } from "bar"'; assert module="bar", symbol="foo"
RED:     test_extract_rust_use_statement() — parse "use serde::Deserialize"; assert module="serde", symbol="Deserialize"
RED:     test_extract_go_import_statement() — parse `import "github.com/x/y"`; assert module="github.com/x/y"
RED:     test_aliases_tracked() — parse "import foo as bar"; assert alias_map["bar"]="foo"
GREEN:   Implement parser + queries.
REFACTOR: Extract per-lang query strings into separate constants.
VERIFY:  pytest .claude/skills/code-quality/tests/test_symbol_fab_parser.py -v
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN
- [ ] Pass: size — `check_symbol_fab.py` ≤ 400 lines (parser only; registry lookup in T2.2-T2.5)
- [ ] Pass: lint
- [ ] Documented limitations in module docstring (dynamic imports, reflection, macros)

#### DoD
- [ ] All RED tests GREEN

---

### T2.2 — Python registry lookup + `inspect`-based introspection

#### Objective
Add Python-specific validation: extracted imports validated against PyPI; methods/attributes on known libs validated via `importlib` + `inspect.signature`.

#### Evidence
ADR D5: registry lookup (`pip show` / PyPI JSON API) + runtime introspection. arXiv:2601.19106 KCH detection pattern.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/python.py — (MODIFY) add detect_symbol_fabrication
.claude/skills/code-quality/scripts/_registry.py — (NEW) shared registry-lookup cache
.claude/skills/code-quality/tests/test_python_symbol_fab.py — (NEW)
.claude/skills/code-quality/fixtures/python/symbol_fab/fabricated_import.py — (NEW)
.claude/skills/code-quality/fixtures/python/symbol_fab/clean_import.py — (NEW)
```

#### Deep file dependency analysis
- `_registry.py` provides a 24h-TTL local cache (`~/.cache/code-quality/registry/` per language).
- `PythonDetector.detect_symbol_fabrication` consumes `extract_imports_and_calls` from T2.1 + `_registry.py`.

#### Deep Dives
**PyPI lookup:**
```python
def package_exists_on_pypi(name: str) -> bool:
    url = f"https://pypi.org/pypi/{name}/json"
    # cache; 24h TTL; 5s timeout; treat timeout as ambiguous (return None)
```

**Introspection for method validation:**
```python
def method_exists_on_lib(lib_name: str, method_path: str) -> Optional[bool]:
    """Return True if method exists, False if doesn't, None if introspection inconclusive.
    Strategy: importlib.import_module(lib_name), getattr down the method_path.
    If ImportError → None (lib not installed, ambiguous).
    If AttributeError → False (method doesn't exist).
    """
```

**Conservative flagging** (per ADR D5):
- `package_exists_on_pypi(x) == False` → HARD Finding (`symbol_fabrication_python`).
- `method_exists_on_lib(x, y) == False` → HARD Finding.
- Either returns `None` (introspection failed) → SOFT WARNING (`symbol_fab_unverifiable_python`).

#### Tasks
1. Implement `_registry.py` with cache + PyPI JSON API client. **[EC-9]** Cache writes use `write_atomic` from `_shared.py`.
2. Implement `package_exists_on_pypi`.
3. Implement `method_exists_on_lib` via importlib.
4. Implement `PythonDetector.detect_symbol_fabrication`. **[EC-17]** Skip imports cujo `module` começa com `.` (relative imports — module-local; nunca consultar PyPI).
5. Skip stdlib modules (use `sys.stdlib_module_names`).
6. Write fixtures: `import doesnotexist_xyz` (fabricated); `import requests` (real); **[EC-17]** `from . import foo` (relative; deve ser skipado).

#### TDD
```
RED:     test_python_symbol_fab_flags_fabricated_package() — fixture imports "doesnotexist_xyz_123"; assert Finding(allowlist_key includes "symbol_fabrication_python")
RED:     test_python_symbol_fab_no_finding_on_real_package() — fixture imports "requests"; assert 0 Findings
RED:     test_python_symbol_fab_skips_stdlib() — fixture imports "os", "sys"; assert 0 Findings
RED:     test_python_symbol_fab_handles_introspection_failure_as_soft_warning() — uninstalled lib; assert Finding with severity=SOFT_FLOOR, allowlist_key=symbol_fab_unverifiable_python
RED:     test_python_symbol_fab_cache_hits_pypi_only_once_per_24h() — call twice; mock requests; assert HTTP called once
RED:     test_python_symbol_fab_skips_relative_imports() [EC-17] — fixture has "from . import foo", "from ..utils import x"; assert 0 PyPI lookups attempted
RED:     test_registry_cache_write_atomic() [EC-9] — concurrent writes (threading or multiprocessing); assert no corrupted JSON; cache file is either old or fully-new state
RED:     test_registry_cache_recovers_from_corrupted_disk() [EC-3] — write truncated JSON to cache path; call package_exists_on_pypi; assert skill detects + re-fetches (no crash)
RED:     test_registry_handles_html_response() [EC-2] — mock requests to return Content-Type=text/html; assert package_exists_on_pypi returns None (ambiguous), not False
GREEN:   Implement.
REFACTOR: Extract cache decorator into _shared.py.
VERIFY:  pytest .claude/skills/code-quality/tests/test_python_symbol_fab.py -v
```

#### Acceptance Criteria
- [ ] 5 RED tests GREEN
- [ ] Cache file written to `~/.cache/code-quality/registry/python.json` (gitignored)
- [ ] Pass: size — `_registry.py` ≤ 250 lines, `python.py` ≤ 500 lines total
- [ ] Pass: lint
- [ ] Network calls mocked in tests (no live PyPI hits in CI)

#### DoD
- [ ] All RED tests GREEN
- [ ] Cache TTL documented in `_registry.py` docstring + thresholds.txt

---

### T2.3 — TypeScript registry lookup + TS Compiler API introspection

#### Objective
Validate TS imports against npm registry + member access via TypeScript Compiler API (`tsc` subprocess for declaration file introspection).

#### Evidence
Blueprint D5 / Corner 4 Technique 2: AST + KB introspection. npm has stable JSON API (`https://registry.npmjs.org/{pkg}`).

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/typescript.py — (MODIFY) add detect_symbol_fabrication
.claude/skills/code-quality/scripts/_registry.py — (MODIFY) add npm lookup
.claude/skills/code-quality/tests/test_typescript_symbol_fab.py — (NEW)
.claude/skills/code-quality/fixtures/typescript/symbol_fab/fabricated.ts — (NEW)
.claude/skills/code-quality/fixtures/typescript/symbol_fab/clean.ts — (NEW)
```

#### Deep file dependency analysis
- Reuses `_registry.py` from T2.2 (extends with `package_exists_on_npm`).
- TypeScript Compiler API access via `tsc --declaration --emitDeclarationOnly` subprocess; parse `.d.ts` for exports.

#### Deep Dives
**npm lookup:**
```python
def package_exists_on_npm(name: str) -> bool:
    url = f"https://registry.npmjs.org/{quote(name, safe='@/')}"
    # 24h cache; 5s timeout
```

**Scoped packages:** `@usetheo/memory` is the package name; npm URL `https://registry.npmjs.org/@usetheo%2Fmemory`. URL-encode the `/`.

**Type-info via tsc:** v0.1 ships package-name check only (cheaper, higher value). Member-access introspection (calling `tsc` per file) DEFERRED to v0.2 — too expensive for initial release. ADR alternative documented inline.

**[EC-15] Type-only imports:** TypeScript `import type { Foo } from 'bar'` is erased at runtime. Detector tree-sitter query distinguishes `import_statement` with `import_clause` marked `type`. Type-only imports validated against both `bar` AND `@types/bar` on npm; HARD CAP only if BOTH absent.

**[EC-16] Internal monorepo subpath exports:** TheoMemory uses subpath exports (`@usetheo/memory/cloud`, `@usetheo/memory/theokit`, etc.). These resolve via `package.json#exports` and are NOT separate npm packages. Detector reads `package.json#exports` + `package.json#workspaces` + `package.json#name` and skips imports matching:
- Self-name prefix (`@usetheo/memory/*`)
- Workspace package names
- Relative paths (`./foo`, `../foo`)
- Node.js builtins (`node:fs`, `fs`, `path`, etc.)

#### Tasks
1. Implement `package_exists_on_npm` with URL encoding for scoped packages. **[EC-9]** Cache writes via `write_atomic`.
2. Implement `TypeScriptDetector.detect_symbol_fabrication` (package-name check only in v0.1).
3. **[EC-15]** Tree-sitter query distinguishes `import type` from runtime `import`; type-only validated as `pkg OR @types/pkg`.
4. **[EC-16]** Parse `package.json#exports` + `#workspaces` + `#name`; skip internal monorepo imports + Node.js builtins.
5. Document v0.2 deferred member-access via inline ADR comment.
6. Write fixtures: fabricated pkg + real pkg + type-only import + subpath export of self.

#### TDD
```
RED:     test_typescript_symbol_fab_flags_fabricated_package() — fixture imports "doesnotexist-xyz-123"; assert Finding
RED:     test_typescript_symbol_fab_no_finding_on_real_package() — fixture imports "react"; assert 0 Findings
RED:     test_typescript_symbol_fab_handles_scoped_packages() — fixture imports "@types/node"; assert 0 Findings (real)
RED:     test_typescript_symbol_fab_type_only_import_validates_against_types_alias() [EC-15] — fixture has "import type { Foo } from 'some-types-pkg'"; assert validates against both 'some-types-pkg' AND '@types/some-types-pkg' on npm
RED:     test_typescript_symbol_fab_skips_self_subpath_exports() [EC-16] — fixture has "import { x } from '@usetheo/memory/cloud'"; package.json#name == "@usetheo/memory"; assert 0 npm lookups, 0 Findings
RED:     test_typescript_symbol_fab_skips_node_builtins() [EC-16] — fixture imports "node:fs", "fs", "path"; assert 0 npm lookups, 0 Findings
RED:     test_typescript_symbol_fab_skips_workspace_packages() [EC-16] — fixture in monorepo with workspaces: ["packages/*"]; imports "@usetheo/sdk" where sdk is workspace; assert 0 Findings
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_typescript_symbol_fab.py -v
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] v0.2 deferred member-access documented in code comment
- [ ] Pass: size

#### DoD
- [ ] All RED tests GREEN

---

### T2.4 — Rust registry lookup + cargo metadata introspection

#### Objective
Validate Rust `use foo::bar` statements: crate `foo` exists on crates.io; `bar` exists via `cargo metadata`.

#### Evidence
Blueprint D5: cargo metadata is the language-native introspection.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/rust.py — (MODIFY) add detect_symbol_fabrication
.claude/skills/code-quality/scripts/_registry.py — (MODIFY) add crates.io lookup
.claude/skills/code-quality/tests/test_rust_symbol_fab.py — (NEW)
.claude/skills/code-quality/fixtures/rust/symbol_fab/fabricated/Cargo.toml — (NEW)
.claude/skills/code-quality/fixtures/rust/symbol_fab/fabricated/src/lib.rs — (NEW)
.claude/skills/code-quality/fixtures/rust/symbol_fab/clean/* — (NEW)
```

#### Deep file dependency analysis
- crates.io has stable JSON API (`https://crates.io/api/v1/crates/{name}`).
- Cargo metadata introspection deferred to v0.2 (similar to TS member-access).

#### Deep Dives
**crates.io lookup:**
```python
def crate_exists_on_crates_io(name: str) -> bool:
    url = f"https://crates.io/api/v1/crates/{name}"
    # Note: crates.io requires User-Agent header
    headers = {"User-Agent": "code-quality-skill/0.1 (audit only)"}
```

**Name normalization:** crates.io stores names with `-`; Rust `use` uses `_`. Convert: `use serde_json` → query "serde-json" AND "serde_json" (try both).

#### Tasks
1. Implement `crate_exists_on_crates_io`. **[EC-9]** Cache writes via `write_atomic`.
2. Implement `RustDetector.detect_symbol_fabrication`. **[EC-17 analog]** Skip `use crate::*`, `use super::*`, `use self::*` (module-local; nunca consultar crates.io).
3. Handle `_` vs `-` name conversion.
4. Write fixtures: fabricated crate + real crate + `use crate::foo` (deve ser skipado).

#### TDD
```
RED:     test_rust_symbol_fab_flags_fabricated_crate() — fixture uses doesnotexist crate; assert Finding
RED:     test_rust_symbol_fab_no_finding_on_real_crate() — uses "serde"; assert 0 Findings
RED:     test_rust_symbol_fab_handles_underscore_dash_conversion() — uses "serde_json"; crates.io has "serde_json"; assert 0 Findings
RED:     test_rust_symbol_fab_skips_module_local_uses() [EC-17 analog] — fixture has "use crate::foo", "use super::bar", "use self::baz"; assert 0 crates.io lookups
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_rust_symbol_fab.py -v
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] User-Agent header set on all crates.io requests
- [ ] Pass: size

#### DoD
- [ ] All RED tests GREEN

---

### T2.5 — Go registry lookup + `go list` introspection

#### Objective
Validate Go imports against Go proxy (`https://proxy.golang.org/{module}/@v/list`); members via `go list -json {pkg}`.

#### Evidence
Blueprint D5: go proxy is the canonical registry.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/go.py — (MODIFY) add detect_symbol_fabrication
.claude/skills/code-quality/scripts/_registry.py — (MODIFY) add Go proxy lookup
.claude/skills/code-quality/tests/test_go_symbol_fab.py — (NEW)
.claude/skills/code-quality/fixtures/go/symbol_fab/fabricated/* — (NEW)
.claude/skills/code-quality/fixtures/go/symbol_fab/clean/* — (NEW)
```

#### Deep file dependency analysis
- Go proxy: GET `https://proxy.golang.org/{module-encoded}/@v/list` returns 200 if module exists, 410 if doesn't.
- Module path is URL-escaped with `!` prefix for uppercase: `gopkg.in/Yaml.v2` → `gopkg.in/!yaml.v2`.

#### Deep Dives
**Go proxy lookup:**
```python
def module_exists_on_go_proxy(import_path: str) -> bool:
    encoded = _encode_for_go_proxy(import_path)
    url = f"https://proxy.golang.org/{encoded}/@v/list"
    # 24h cache; 5s timeout
```

**Edge case:** `github.com/x/y` returns 200 only if it's a Go module (has go.mod). Some valid repos aren't Go modules.

#### Tasks
1. Implement `module_exists_on_go_proxy` + URL encoder. **[EC-9]** Cache writes via `write_atomic`.
2. Implement `GoDetector.detect_symbol_fabrication`. **[EC-17 analog]** Read `go.mod#module` (e.g., `github.com/usetheo/theo-memory`); skip imports começando com esse prefix (internal); skip Go stdlib (lista padrão); skip vendored deps em `vendor/`.
3. Handle uppercase encoding (`!`-prefix).
4. Write fixtures: fabricated module + real module + internal import + vendored dep.

#### TDD
```
RED:     test_go_symbol_fab_flags_fabricated_module() — fixture imports doesnotexist module; assert Finding
RED:     test_go_symbol_fab_no_finding_on_real_module() — imports "fmt" (stdlib) or "github.com/spf13/cobra"; assert 0 Findings
RED:     test_go_symbol_fab_handles_uppercase_encoding() — imports "gopkg.in/Yaml.v2"; verify URL encoded with `!`
RED:     test_go_symbol_fab_skips_self_module_imports() [EC-17 analog] — go.mod#module="github.com/usetheo/theo-memory"; fixture imports "github.com/usetheo/theo-memory/internal/foo"; assert 0 Go proxy lookups
RED:     test_go_symbol_fab_skips_vendored_deps() [EC-18] — fixture has vendor/github.com/x/y/; imports "github.com/x/y"; assert 0 Go proxy lookups (module is vendored locally)
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_go_symbol_fab.py -v
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] Pass: size

#### DoD
- [ ] All RED tests GREEN

---

## Phase 3: D3 cross-package wiring detector

**Objective:** Detect symbols exported from one package but never imported by any other package in the same repo (orphan exports). Soft cap per ADR D2.

### T3.1 — ast-grep cross-package usage extractor (all 4 languages)

#### Objective
Single language-agnostic detector that, given the per-language tree-sitter queries from T2.1, computes: for each exported symbol, how many cross-package importers reference it. If 0 (and symbol is "public" — not `_private`), emit SOFT_CAP Finding.

#### Evidence
Blueprint Recommendation #8: ast-grep cross-package search (ecosystem already has `/ast-grep` skill); leverage instead of reimplementing.

#### Files to edit
```
.claude/skills/code-quality/scripts/check_wiring_cross_package.py — (NEW)
.claude/skills/code-quality/tests/test_wiring_cross_package.py — (NEW)
.claude/skills/code-quality/fixtures/wiring/orphan_export/* — (NEW) per language
.claude/skills/code-quality/fixtures/wiring/used_export/* — (NEW)
```

#### Deep file dependency analysis
- Reuses `extract_imports_and_calls` from T2.1 to find IMPORTERS.
- Uses `Glob` to enumerate ALL exports across the repo (per language: TS `export`, Python `def`/`class` at module top-level minus `_` prefix, Rust `pub`, Go uppercase identifiers).
- Builds bipartite graph: exports → importers.

#### Deep Dives
**Algorithm:**
1. For each language enabled:
   a. Enumerate all files matching language extension (`*.ts`, `*.py`, `*.rs`, `*.go`).
   b. For each file, extract DECLARED exports (public symbols).
   c. For each file, extract IMPORTS (from T2.1 parser).
2. Build map: `{(file, symbol) → set(importing_files)}`.
3. For each (file, symbol) where `len(importing_files) == 0 AND file is in src/` (not test) AND symbol is public:
   - Emit Finding(severity=SOFT_CAP, allowlist_key=f"{language}|{file}|orphan_export|{symbol}").

**Skipping rules:**
- Test files (`*test*`, `*spec*`, `__tests__/`) — never check exports.
- `index.ts` / `mod.rs` / `__init__.py` — barrel files; their exports are by definition re-exports.
- Entry points (declared in `package.json#main`, `Cargo.toml#bin`, etc.) — never orphan by definition.

#### Tasks
1. Implement `check_wiring_cross_package.py`.
2. Per-language "extract exports" logic.
3. Bipartite graph building.
4. Skip rules.
5. Write fixtures (TS package with orphan export; TS package with used export; same for Py/Rust/Go).

#### TDD
```
RED:     test_orphan_export_flagged_typescript() — fixture has unused TS export; assert SOFT_CAP Finding
RED:     test_used_export_no_finding_typescript() — fixture has used export; assert 0 Findings
RED:     test_orphan_export_flagged_python() — fixture; assert Finding
RED:     test_orphan_export_flagged_rust() — fixture; assert Finding
RED:     test_orphan_export_flagged_go() — fixture; assert Finding
RED:     test_test_files_skipped() — fixture has unused export in *.test.ts; assert 0 Findings
RED:     test_barrel_files_skipped() — fixture has re-export from index.ts; assert 0 Findings
GREEN:   Implement.
REFACTOR: Extract per-lang export-detection into adapter modules.
VERIFY:  pytest .claude/skills/code-quality/tests/test_wiring_cross_package.py -v
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN
- [ ] Pass: size — `check_wiring_cross_package.py` ≤ 500 lines (else split)
- [ ] Performance smoke test: on `.claude/skills/` codebase (real Python files), detector runs in ≤ 10s
- [ ] Pass: lint

#### DoD
- [ ] All RED tests GREEN
- [ ] Smoke test passes

---

## Phase 4: D4 mutation testing detectors

**Objective:** Wrap mutmut (Python) + stryker (TypeScript) scoped to plan's `## Critical paths`. ADR explicitly defers Rust+Go to v0.2.

### T4.1 — Python mutation testing wrapper (mutmut)

#### Objective
Wrap `mutmut run --paths-to-mutate {critical_paths}` + parse output + compute mutation score per critical path.

#### Evidence
Blueprint Corner 4 Technique 3: mutation testing complements coverage; thresholds >80% / 60-80% / <60%.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/python.py — (MODIFY) add detect_mutation_score
.claude/skills/code-quality/scripts/_critical_paths.py — (NEW) shared "parse plan's ## Critical paths" parser
.claude/skills/code-quality/tests/test_python_mutation.py — (NEW)
.claude/skills/code-quality/fixtures/python/mutation/weak_tests/* — (NEW)
.claude/skills/code-quality/fixtures/python/mutation/strong_tests/* — (NEW)
```

#### Deep file dependency analysis
- `_critical_paths.py` reads the plan markdown, parses `## Critical paths` section (table or bulleted list of file globs).
- Mutmut requires the project to have a working test suite; fixture provides one.

#### Deep Dives
**Critical paths section format** (to be enforced in plan-template.md as part of T6.1):
```markdown
## Critical paths

| Glob | Mutation score floor | Why critical |
|---|---|---|
| `src/core/extraction/**/*.ts` | 80% | LLM extraction pipeline; ADD-only invariant |
| `.claude/skills/code-quality/scripts/**/*.py` | 60% | Audit tool — itself must be correct |
```

**mutmut JSON output** (via `mutmut results --output json` in mutmut 2.5+):
```json
{"killed": 47, "survived": 5, "timeout": 2, "score": 0.870}
```

**[v1.2 F4 WARNING]** Plan now declares mutmut `^3.5` (bumped from `^2.5`). mutmut 3.x is a CLI rewrite — the `run --paths-to-mutate` flag AND `results --output json` flag MAY have different names or output schema. Before implementing this task, run:
```bash
pip install 'mutmut>=3.5' && mutmut --help && mutmut run --help && mutmut results --help
```
Update the subprocess invocation + JSON parsing to match v3 actual API. If schema diverges significantly, document in code comment + update `_parse_mutmut_output` accordingly.

**Verdict mapping:**
- Score ≥ floor → 0 Findings.
- Score in [floor - 20%, floor) → SOFT_FLOOR (`soft_floor_mutation_score_medium_python`, cap 89).
- Score < floor - 20% → SOFT_CAP (`soft_cap_mutation_score_low_python`, cap 70).

#### Tasks
1. Implement `_critical_paths.py` parser. **[EC-5]** Schema validation:
   - (a) Plan MUST have EXACTLY ZERO OR ONE `## Critical paths` section (regex `^## Critical paths\\s*$` count ≤ 1). Multiple sections → `plan_critical_paths_malformed` Finding HARD CAP.
   - (b) Each row glob: non-empty + parseable by `pathlib.PurePath().match` (try parse; ValueError → malformed).
   - (c) Each row floor: integer 0-100; reject "high"/"low"/empty.
   - (d) Each row reason: non-empty.
   - Malformed rows → `plan_critical_paths_malformed` Finding HARD CAP (refuse to compute mutation; gate fails).
2. Implement `PythonDetector.detect_mutation_score`.
3. Wrap subprocess mutmut.
4. Compute score per path.
5. Apply verdict mapping.
6. Write fixtures: weak tests (assertions trivial) + strong tests (assert specific behavior); **[EC-5]** malformed plan fixtures (duplicated section, invalid glob, "high" floor, empty reason).

#### TDD
```
RED:     test_critical_paths_parser_extracts_globs() — given plan markdown with table; assert returns dict of glob → floor
RED:     test_python_mutation_flags_weak_tests() — fixture with weak tests; mutation score < floor - 20%; assert SOFT_CAP Finding
RED:     test_python_mutation_no_finding_on_strong_tests() — score ≥ floor; assert 0 Findings
RED:     test_python_mutation_emits_auditor_unavailable_when_mutmut_missing() — assert proper Finding
RED:     test_python_mutation_skips_when_no_critical_paths_declared() — plan lacks section; assert SOFT_CAP "plan_missing_critical_paths"
RED:     test_critical_paths_rejects_duplicate_section() [EC-5] — fixture plan with TWO "## Critical paths" sections; assert plan_critical_paths_malformed HARD Finding
RED:     test_critical_paths_rejects_malformed_glob() [EC-5] — row with glob "**/*. ts" (trailing space); assert HARD Finding
RED:     test_critical_paths_rejects_non_integer_floor() [EC-5] — row with floor "high"; assert HARD Finding
RED:     test_critical_paths_rejects_empty_reason() [EC-5] — row with empty reason; assert HARD Finding
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_python_mutation.py -v
```

#### Acceptance Criteria
- [ ] 5 RED tests GREEN
- [ ] Timeout per mutation run: 5 minutes (per thresholds.txt `mutation.timeout_minutes`)
- [ ] Pass: size

#### DoD
- [ ] All RED tests GREEN

---

### T4.2 — TypeScript mutation testing wrapper (stryker)

#### Objective
Wrap `npx stryker run --mutate {critical_paths}` + parse output.

#### Evidence
Same as T4.1; stryker is the de-facto standard for TS mutation testing.

#### Files to edit
```
.claude/skills/code-quality/scripts/detectors/typescript.py — (MODIFY) add detect_mutation_score
.claude/skills/code-quality/tests/test_typescript_mutation.py — (NEW)
.claude/skills/code-quality/fixtures/typescript/mutation/weak_tests/* — (NEW)
.claude/skills/code-quality/fixtures/typescript/mutation/strong_tests/* — (NEW)
```

#### Deep file dependency analysis
- Reuses `_critical_paths.py` from T4.1.
- Stryker requires `stryker.conf.json`; fixture provides one.

#### Deep Dives
**Stryker JSON output:** `reports/mutation/mutation.json` after run; contains `metrics.killed`, `metrics.survived`, `metrics.mutationScore`.

**[v1.2 F1]** npm package is `@stryker-mutator/core` (scoped), NOT `stryker` (unscoped, abandoned at v0.35.1). Install via:
```bash
npm install --save-dev @stryker-mutator/core
```
The CLI binary is still `stryker` (resolves through node_modules/.bin/stryker → @stryker-mutator/core), so `npx stryker run` works as documented. Subprocess invocation does NOT need changes — only fixture `package.json` declares the scoped package name.

#### Tasks
1. Implement `TypeScriptDetector.detect_mutation_score`.
2. Wrap subprocess `npx stryker run` (binary name unchanged from v1.0 plan).
3. Read reports/mutation/mutation.json.
4. Apply verdict mapping (same as T4.1).
5. Write fixtures with `"@stryker-mutator/core": "^9.6"` in devDependencies (NOT `"stryker"`).

#### TDD
```
RED:     test_typescript_mutation_flags_weak_tests() — assert SOFT_CAP
RED:     test_typescript_mutation_no_finding_on_strong_tests() — assert 0 Findings
RED:     test_typescript_mutation_emits_auditor_unavailable() — assert Finding
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_typescript_mutation.py -v
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] Pass: size

#### DoD
- [ ] All RED tests GREEN

---

### T4.3 — ADR document: Rust + Go mutation testing DEFERRED to v0.2

#### Objective
Capture in SKILL.md that v0.1 does NOT ship Rust/Go mutation detectors. ADR justifies; rust.py + go.py raise NotImplementedError in `detect_mutation_score` (graceful skip with INFO log).

#### Evidence
Blueprint D4: "v0.1 ships TS + Python only. Rust + Go DEFER to v0.2 (avaliar gremlins vs go-mutesting)."

#### Files to edit
```
.claude/skills/code-quality/SKILL.md — (MODIFY) add "Roadmap" section with v0.2 deferred items
.claude/skills/code-quality/scripts/detectors/rust.py — (MODIFY) detect_mutation_score returns single Finding(severity=INFO, message="Rust mutation testing deferred to v0.2")
.claude/skills/code-quality/scripts/detectors/go.py — (MODIFY) same as rust.py
.claude/skills/code-quality/tests/test_rust_detector.py — (MODIFY) add test for graceful skip
.claude/skills/code-quality/tests/test_go_detector.py — (MODIFY) add test for graceful skip
```

#### Deep file dependency analysis
- Orchestrator (Phase 5) must NOT include INFO findings in `hard_caps_triggered` JSON.

#### Tasks
1. Add Roadmap section to SKILL.md.
2. Implement graceful skip in rust.py + go.py.
3. Update tests.

#### TDD
```
RED:     test_rust_mutation_emits_info_finding() — assert single Finding(severity=INFO)
RED:     test_go_mutation_emits_info_finding() — same for Go
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_{rust,go}_detector.py -v
```

#### Acceptance Criteria
- [ ] 2 RED tests GREEN
- [ ] SKILL.md Roadmap explicitly cites v0.2 plan to evaluate `gremlins` vs `go-mutesting`

#### DoD
- [ ] All RED tests GREEN

---

## Phase 5: Orchestrator + reporting

**Objective:** Wire all 4 detectors via a single entrypoint that loads config, runs detectors in parallel where safe, aggregates findings, applies allowlist, emits verdict + JSON + Markdown report.

### T5.1 — `run_code_quality.py` entrypoint (CLI + mode selection)

#### Objective
Implement the user-facing CLI for `/code-quality`.

#### Evidence
Sibling pattern from `deps-audit/scripts/run_audit.py` (conceptual; actual file may not exist, but the pattern is documented in deps-audit/SKILL.md).

#### Files to edit
```
.claude/skills/code-quality/scripts/run_code_quality.py — (MODIFY) implement entrypoint
.claude/skills/code-quality/tests/test_orchestrator_cli.py — (NEW)
```

#### Deep file dependency analysis
- Consumes: `_shared.py` (config + allowlist), `detectors/*`, `_critical_paths.py`.
- CLI args: `[plan-slug]` positional optional; `--json-out`, `--audit-out`, `--languages-rule`, `--thresholds-rule`, `--allowlist`, `--no-network` (for offline testing).

#### Deep Dives
**CLI shape:**
```
python3 run_code_quality.py [plan-slug] \
  [--json-out PATH] \
  [--audit-out PATH] \
  [--languages-rule PATH] \
  [--thresholds-rule PATH] \
  [--allowlist PATH] \
  [--no-network]
```

**Modes:**
- Mode 1 (no slug) — repo-wide audit; print report to stdout.
- Mode 2 (slug provided) — read `.claude/knowledge-base/plans/{slug}-plan.md`; bind audit to its `## Critical paths`; write report to `.claude/knowledge-base/audits/{slug}-code-quality-{date}.md`.

**[EC-6] Slug resolution rules:** Search order is STRICT:
1. `.claude/knowledge-base/plans/{slug}-plan.md` — primary.
2. `.claude/knowledge-base/plans/completed/{slug}-plan.md` — already-merged plan (audit pos-merge).
3. **REFUSE** discovery plans (`.claude/knowledge-base/discoveries/plans/{slug}-plan.md`). They have a different schema (research questions, coverage corners, no `## Critical paths`).

If slug not found in (1) or (2): error message `plan_not_found: looked in plans/{slug}-plan.md and plans/completed/{slug}-plan.md. If you meant a discovery plan, /code-quality is not the right tool — discovery plans are validated by /discover-confidence.` Exit code 2.

**[EC-25] `--no-network` flag semantics:** Disables D2 entirely. Single INFO Finding `d2_disabled_no_network` emitted (severity INFO, does NOT contribute to verdict). NO registry lookups attempted; NO `symbol_fab_unverifiable_*` cascade. Document this in SKILL.md as caveat for air-gapped CI — D2 requires network; D1+D3+D4 work offline.

**Detector orchestration:**
```python
def main(args):
    cfg = load_languages_config(args.languages_rule)
    thresholds = load_thresholds(args.thresholds_rule)
    allowlist = load_allowlist(args.allowlist)

    enabled_langs = [lang for lang, meta in cfg.items() if meta["status"] == "ENABLED"]
    detected_manifests = auto_detect_manifests(repo_root, enabled_langs)
    active_langs = [lang for lang in enabled_langs if lang in detected_manifests]

    findings = []
    for lang in active_langs:
        detector = build_detector(lang, thresholds)
        findings.extend(detector.detect_dead_code(repo_root))
        findings.extend(detector.detect_symbol_fabrication(...))
        findings.extend(detector.detect_orphan_exports(repo_root))
        if args.plan_slug:
            critical_paths = parse_critical_paths(args.plan_slug)
            findings.extend(detector.detect_mutation_score(critical_paths))

    final_findings = apply_allowlist(findings, allowlist, today())
    verdict, hard_caps = compute_verdict(final_findings, thresholds)

    json_summary = emit_json_summary(final_findings, verdict, hard_caps)
    if args.json_out: write(args.json_out, json_summary)
    else: print(json.dumps(json_summary, indent=2))

    if args.plan_slug:
        write_audit_report(final_findings, audit_path(args.plan_slug), "plan-bound", args.plan_slug)
    else:
        write_audit_report(final_findings, sys.stdout, "standalone", None)
```

#### Tasks
1. Implement argparse CLI.
2. Implement `auto_detect_manifests`.
3. Implement `build_detector` factory.
4. Implement orchestration loop.
5. **[EC-25]** Wire `--no-network` flag: when set, skip D2 entirely (don't even instantiate registry calls); emit single INFO Finding `d2_disabled_no_network` per language.
6. Error handling: any detector exception → emit `detector_crash_{lang}_{phase}` SOFT_CAP Finding + continue with other detectors.
7. **[EC-6]** Implement `resolve_plan_path(slug)` with strict search order; refuse discovery plans with helpful error.
8. **[EC-30]** Top-level try/except in `main()`: emergency Finding `orchestrator_crash` with truncated stack trace; produce parseable JSON anyway; exit code != 0.

#### TDD
```
RED:     test_cli_no_args_runs_standalone_mode() — invoke with no args; assert exit 0; assert JSON printed to stdout
RED:     test_cli_with_slug_runs_plan_bound_mode() — invoke with slug; assert audit file created at .claude/knowledge-base/audits/{slug}-code-quality-{date}.md
RED:     test_cli_auto_detect_skips_languages_without_manifests() — config has all 4 ENABLED but only package.json present; assert only TS detector ran
RED:     test_cli_detector_crash_does_not_halt_orchestrator() — mock one detector to raise; assert other detectors still ran; assert detector_crash Finding emitted
RED:     test_cli_no_network_flag_skips_registry_lookups() — mock requests; assert never called when --no-network
RED:     test_cli_no_network_emits_d2_disabled_info_finding() [EC-25] — invoke with --no-network; assert single INFO Finding per language; assert NO symbol_fab_unverifiable_* Findings cascade
RED:     test_cli_refuses_discovery_plan_slug() [EC-6] — create file at discoveries/plans/foo-plan.md only; invoke /code-quality foo; assert exit 2 + helpful error message mentioning /discover-confidence
RED:     test_cli_finds_plan_in_completed_directory() [EC-6] — create file at plans/completed/foo-plan.md only; invoke /code-quality foo; assert succeeds + binds audit to that plan
RED:     test_cli_verdict_pass_when_no_languages_active() [EC-19] — config has all DISABLED OR no manifests detected; assert verdict=PASS, languages_audited=[], INFO Finding "no auditable languages detected"
RED:     test_cli_orchestrator_top_level_crash_emits_emergency_finding() [EC-30] — mock compute_verdict to raise; assert exit != 0, JSON still parseable, contains orchestrator_crash Finding with stack trace
GREEN:   Implement run_code_quality.py.
REFACTOR: Extract orchestration into a class.
VERIFY:  pytest .claude/skills/code-quality/tests/test_orchestrator_cli.py -v
```

#### Acceptance Criteria
- [ ] 10 RED tests GREEN (5 original + 5 new from EC-6, EC-19, EC-25, EC-30 absorption)
- [ ] Pass: size — `run_code_quality.py` ≤ 500 lines
- [ ] Audit file written to deterministic path with date `YYYY-MM-DD`
- [ ] Pass: lint
- [ ] **[T6.5 cross-ref]** CLI exposes `--no-audit-write` flag (skip Markdown report; JSON to stdout only); required by `plan-confidence` integration

#### DoD
- [ ] All RED tests GREEN
- [ ] Smoke test: invoke against `.claude/skills/` repo; non-zero exit only if HARD findings present

---

### T5.2 — Verdict aggregator + JSON schema

#### Objective
Implement `compute_verdict(findings, thresholds) → (verdict, hard_caps_triggered)` per the golden rule cap table.

#### Evidence
ADR D2 + golden rule cap table.

#### Files to edit
```
.claude/skills/code-quality/scripts/_shared.py — (MODIFY) add compute_verdict + emit_json_summary
.claude/skills/code-quality/tests/test_verdict.py — (NEW)
```

#### Deep file dependency analysis
- `compute_verdict` is the SINGLE point of truth for cap logic; no other code may compute verdict.

#### Deep Dives
**JSON schema** (documented in SKILL.md):
```json
{
  "verdict": "PASS | PASS_WITH_CAVEATS | FAIL_SOFT | FAIL_HARD | INVALID",
  "score_cap": 49 | 70 | 89 | 100,
  "hard_caps_triggered": ["dead_code_unallowlisted_python", ...],
  "soft_caps_triggered": ["soft_cap_orphan_export_typescript", ...],
  "findings_by_detector": {
    "d1_dead_code": {"python": 3, "typescript": 0, ...},
    "d2_symbol_fab": {"python": 0, ...},
    "d3_orphan_export": {...},
    "d4_mutation": {...}
  },
  "languages_audited": ["python", "typescript"],
  "languages_skipped": ["rust", "go"],
  "skip_reasons": {"rust": "no Cargo.toml found", ...},
  "report_path": ".claude/knowledge-base/audits/{slug}-code-quality-{date}.md",
  "schema_version": "0.1.0"
}
```

**Cap precedence** (worst wins):
1. Any HARD finding → verdict=FAIL_HARD, score_cap=49 (INVALID).
2. Else any SOFT_CAP → verdict=FAIL_SOFT, score_cap=70.
3. Else any SOFT_FLOOR → verdict=PASS_WITH_CAVEATS, score_cap=89.
4. Else → verdict=PASS, score_cap=100.

**Special verdicts:**
- `INVALID` (score_cap=49) if `plan_missing_critical_paths_section` Finding present AND Mode 2 AND D4 enabled.

#### Tasks
1. Implement `compute_verdict`.
2. Implement `emit_json_summary`.
3. Document JSON schema in SKILL.md.

#### TDD
```
RED:     test_verdict_pass_when_no_findings() — given []; assert verdict=PASS, score_cap=100
RED:     test_verdict_fail_hard_when_hard_finding_present() — given [HARD]; assert FAIL_HARD, 49
RED:     test_verdict_fail_soft_when_only_soft_cap() — given [SOFT_CAP]; assert FAIL_SOFT, 70
RED:     test_verdict_pass_with_caveats_when_only_soft_floor() — given [SOFT_FLOOR]; assert PASS_WITH_CAVEATS, 89
RED:     test_hard_caps_triggered_list_non_empty_when_verdict_fail_hard() — assert list len > 0
RED:     test_json_schema_includes_schema_version() — assert "schema_version" key present
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_verdict.py -v
```

#### Acceptance Criteria
- [ ] 6 RED tests GREEN
- [ ] JSON schema documented in SKILL.md
- [ ] Pass: lint, size

#### DoD
- [ ] All RED tests GREEN

---

### T5.3 — Markdown report writer (template-based)

#### Objective
Render `templates/code-quality-report.md` with placeholders filled from findings + verdict.

#### Evidence
ADR D7: dual output. Sibling pattern: deps-audit Markdown output.

#### Files to edit
```
.claude/skills/code-quality/templates/code-quality-report.md — (MODIFY) full template
.claude/skills/code-quality/scripts/_shared.py — (MODIFY) flesh out write_audit_report
.claude/skills/code-quality/tests/test_report_writer.py — (NEW)
```

#### Deep file dependency analysis
- Template uses simple `{{ placeholder }}` syntax (not Jinja2 — overkill for our case; use Python `.format()` or `string.Template`).

#### Deep Dives
**Template skeleton:**
```markdown
# Code Quality Audit: {slug_or_repo}

**Date:** {date}
**Mode:** {mode}
**Verdict:** {verdict}
**Score cap:** {score_cap}
**Hard caps triggered:** {hard_caps_list}

## Summary

- Languages audited: {languages_audited}
- Languages skipped: {languages_skipped} ({skip_reasons})
- Total findings: {total_findings} ({hard_count} HARD, {soft_cap_count} SOFT_CAP, {soft_floor_count} SOFT_FLOOR, {info_count} INFO)

## Findings by detector

### D1 — Dead code

{d1_findings_table}

### D2 — Symbol fabrication

{d2_findings_table}

### D3 — Cross-package orphan exports

{d3_findings_table}

### D4 — Mutation testing (test quality)

{d4_findings_table}

## Allowlist hits

- Active (within sunset): {active_allowlist_count}
- Expired (re-fired at full severity): {expired_allowlist_count}

## Recommended actions

{recommended_actions}

## Related

- Plan: {plan_link_if_mode_2}
- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
```

#### Tasks
1. Write template `code-quality-report.md`.
2. Implement `write_audit_report` rendering.
3. Implement table rendering helpers per detector.

#### TDD
```
RED:     test_report_writer_includes_all_sections() — render with sample findings; assert sections present
RED:     test_report_writer_renders_finding_count_correctly() — given 3 findings; assert "Total findings: 3"
RED:     test_report_writer_omits_empty_detector_sections_gracefully() — given only D1 findings; assert D2/D3/D4 sections say "No findings"
GREEN:   Implement.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_report_writer.py -v
```

#### Acceptance Criteria
- [ ] 3 RED tests GREEN
- [ ] Template ≤ 200 lines
- [ ] Pass: lint

#### DoD
- [ ] All RED tests GREEN

---

## Phase 6: Cycle integration

**Objective:** Wire `/code-quality` into the broader ecosystem so it actually fires at the right moment in `cycle-implement` and contributes to `/plan-confidence` verdict.

### T6.1 — Update `cycle-implement.md` v1.x adding `/code-quality` phase

#### Objective
Document `/code-quality` as a new phase between halt-loop completion and handoff to `/review`.

#### Evidence
ADR D4: position pos-implement, pre-review.

#### Files to edit
```
.claude/rules/cycle-implement.md — (MODIFY) add /code-quality phase section
```

#### Deep file dependency analysis
- File is currently v1.0 ACTIVE. Modification bumps to v1.1.
- Same pattern as cycle-plan.md v1.0 → v1.1 adding /deps-audit (already done).

#### Deep Dives
**Sections to modify:**
1. **Chain (v1.x — inquebrável)** — insert `/code-quality {plan-slug}` after halt-loop, before final validation.
2. **Phase contracts** — new row for `code-quality` phase.
3. **Hard gates** — add 4 new hard gates (D1 + D2 per language).
4. **Soft gates** — add 3 new soft gates (D3 + D4 + auditor_unavailable).
5. **Anti-patterns** — "NEVER skip `/code-quality` when implementing in any of the 4 supported languages".
6. **Rollback** — new row for audit file.
7. **Versioning § Change log** — v1.1 entry.

#### Tasks
1. Edit `cycle-implement.md`.
2. Add v1.1 to change log.
3. Cross-reference new file `code-quality-golden-rule.md`.

#### TDD
```
RED:     test_cycle_implement_v11_mentions_code_quality_phase() — grep "code-quality" in file; assert count ≥ 5 occurrences
RED:     test_cycle_implement_change_log_has_v11_entry() — assert "v1.1" in Change log section
GREEN:   Edit file.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_cycle_integration.py -v -k "cycle_implement"
```

#### Acceptance Criteria
- [ ] 2 RED tests GREEN
- [ ] `python3 .claude/scripts/check_xrefs.py` passes (no broken refs)
- [ ] Pass: size — file ≤ 500 lines after edits

#### DoD
- [ ] All RED tests GREEN

---

### T6.2 — Extend `plan-confidence-golden-rule.md` with `/code-quality` stable identifiers (LOCKED FILE — requires explicit ADR-style note)

#### Objective
The LOCKED golden rule needs to acknowledge `/code-quality` stable identifiers as participating in `hard_caps_triggered`. Per the golden rule's own policy ("§ When this rule may change"), extensions follow ADR-style process with lower burden.

#### Evidence
Golden rule's own policy. Sibling pattern: deps-audit v1.1 also requires this extension (still pending — see `cycle-plan.md` § Downstream changes). This plan delivers it for `/code-quality` AND for `/deps-audit` (consolidates the pending follow-up).

#### Files to edit
```
.claude/rules/plan-confidence-golden-rule.md — (MODIFY) add stable identifiers from /code-quality and /deps-audit
```

#### Deep file dependency analysis
- File is LOCKED — change requires explicit ADR. This task IS the ADR (commit message + this plan as backing).
- Touches Inquebrável Rule 1 (95% confidence): pause + confirm with user before merging this file change.

#### Deep Dives
**Section to modify:** `## Rules that cannot be bent` — add rows:
```
| Plan deps section fails /deps-audit FAIL_INSECURE | M2 future — wiring track via deps-audit verdict consumption |
| Plan code touched fails /code-quality FAIL_HARD | M2 future — wiring track via code-quality verdict consumption |
```

**Section to modify:** `## Related` — add cross-reference to `code-quality-golden-rule.md`.

**95% confidence gate:** because this modifies a LOCKED file, this task MUST surface to the user before committing. The plan's `/edge-case-plan` will flag this; `/plan-confidence` may detect via `architecture_compliance` check. Mitigation: this task is the LAST one merged; PR description includes explicit "modifies LOCKED file plan-confidence-golden-rule.md — requires owner approval".

#### Tasks
1. Pause and confirm with user before editing (per Inquebrável Rule 1).
2. Edit `plan-confidence-golden-rule.md`.
3. Update Log of changes section.

#### TDD
```
RED:     test_plan_confidence_golden_rule_lists_code_quality_identifiers() — grep "dead_code_unallowlisted_" + "symbol_fabrication_"; assert both present
RED:     test_plan_confidence_golden_rule_has_v11_log_entry() — assert v1.1 log entry with rationale
GREEN:   Edit file.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_cycle_integration.py -v -k "plan_confidence"
```

#### Acceptance Criteria
- [ ] 2 RED tests GREEN
- [ ] User has explicitly approved the LOCKED file change before merge
- [ ] Log of changes entry cites this plan slug

#### DoD
- [ ] All RED tests GREEN
- [ ] Owner approval recorded in PR description

---

### T6.3 — Update `token-budget.md` with `/code-quality` cost estimate

#### Objective
Document expected token cost so contributors plan accordingly.

#### Evidence
Blueprint Recommendation #12. Sibling pattern: deps-audit row in token-budget.md.

#### Files to edit
```
.claude/rules/token-budget.md — (MODIFY) add /code-quality row in cycle-implement section
```

#### Deep Dives
**Estimate (per blueprint):**
- D1 (4 detectors): <30s × 4 ≈ <2min CI runtime. LLM token cost: ~0 (subprocess external CLIs).
- D2 (4 detectors): 30-60s × 4 ≈ ~2-4min CI runtime; LLM tokens: ~0 (deterministic).
- D3 (1 detector): <30s. LLM tokens: ~0.
- D4 (2 detectors): 1-5min per PR scoped. LLM tokens: ~0.
- Aggregation + report writing: LLM tokens to parse outputs + write Markdown report: ~5-15k.
- **Total per invocation: ~5-15k LLM tokens + 4-12min CI runtime**.

#### Tasks
1. Add row to `## Estimates per skill` § `cycle-implement` section.
2. Add anti-pattern entry: "Running /code-quality on PR with no language changes" → suggested skip.

#### TDD
```
RED:     test_token_budget_mentions_code_quality() — grep "/code-quality"; assert in cycle-implement table
GREEN:   Edit file.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_cycle_integration.py -v -k "token_budget"
```

#### Acceptance Criteria
- [ ] 1 RED test GREEN

#### DoD
- [ ] RED test GREEN

---

### T6.5 — [EC-29 Opção A] Extend `plan-confidence/scripts/run_structural.py` to invoke `/code-quality` + consume verdict

#### Objective
Ship the actual runtime wiring so that `/plan-confidence` programatically invokes `/code-quality` and applies its stable identifiers to `hard_caps_triggered`. Without this task, the golden rule extension in T6.2 is documentation-only — violating Inquebrável Rule 3 (extreme honesty: don't claim integration that doesn't exist).

#### Evidence
EC-29 from edge-case review. User decision 2026-05-22 (AskUserQuestion): Opção A — ship gate completo.

#### Files to edit
```
.claude/skills/plan-confidence/scripts/run_structural.py — (MODIFY) add invocation of /code-quality + JSON parse + cap merge
.claude/skills/plan-confidence/scripts/_code_quality_consumer.py — (NEW) helper that subprocesses /code-quality and parses JSON output
.claude/skills/plan-confidence/tests/test_code_quality_integration.py — (NEW)
```

#### Deep file dependency analysis
- `run_structural.py` already aggregates hard_caps_triggered. New code adds a step BEFORE final verdict computation: invoke `/code-quality {slug} --json-out -` (stdout); parse JSON; merge stable identifiers into hard_caps_triggered.
- `_code_quality_consumer.py` isolates the subprocess + parse logic for testability.
- Plan-confidence's verdict cap logic already supports "smallest cap wins" — code-quality verdict cap (49/70/89) participates as input.

#### Deep Dives
**Subprocess invocation:**
```python
def invoke_code_quality(slug: str, repo_root: Path, timeout_s: int = 600) -> dict:
    """Run /code-quality {slug} --no-audit-write --json-out -; parse JSON; return summary.
    --no-audit-write flag (NEW) tells /code-quality to skip writing the markdown audit file
    (plan-confidence is consuming verdict only; audit file already written by standalone invocation).
    On error: return {"verdict": "auditor_unavailable_code_quality", "hard_caps_triggered": ["code_quality_invocation_failed"]}.
    """
    result = subprocess.run(
        ["python3", str(repo_root / ".claude/skills/code-quality/scripts/run_code_quality.py"),
         slug, "--no-audit-write", "--json-out", "-"],
        capture_output=True, text=True, timeout=timeout_s, cwd=repo_root,
    )
    if result.returncode == 0:
        return safe_parse_json(result.stdout, "code_quality")
    else:
        return {"verdict": "FAIL_HARD", "hard_caps_triggered": [f"code_quality_exit_{result.returncode}"]}
```

**Verdict cap merge:**
```python
# run_structural.py — after existing checks
if args.slug:
    cq_summary = invoke_code_quality(args.slug, repo_root)
    structural_caps.extend(cq_summary["hard_caps_triggered"])
    structural_caps.extend(cq_summary.get("soft_caps_triggered", []))
    # plan-confidence's compute_final_verdict picks the smallest cap = strictest verdict
```

**Backward compatibility:** if `/code-quality` binary not present (skill not yet installed in the env), invocation fails gracefully → `code_quality_invocation_failed` SOFT_CAP (cap 70). Documented as known degradation in plan-confidence/PORTABLE.md.

**New CLI flag in `/code-quality`:** `--no-audit-write` — when set, skill writes JSON to stdout only; skips markdown audit file. Required by this task; added to T5.1 acceptance criteria via cross-reference.

#### Tasks
1. Implement `_code_quality_consumer.py` with `invoke_code_quality(slug, repo_root)`.
2. Extend `run_structural.py` to invoke + merge caps when Mode 2 (slug present).
3. Add `--no-audit-write` flag to `/code-quality` CLI (T5.1 — update there).
4. Update `plan-confidence/PORTABLE.md` documenting the new dependency on `/code-quality`.

#### TDD
```
RED:     test_plan_confidence_invokes_code_quality_when_slug_present() — mock subprocess; assert /code-quality invoked with --no-audit-write --json-out -
RED:     test_plan_confidence_merges_code_quality_hard_caps() — mock returns {"hard_caps_triggered": ["dead_code_unallowlisted_python"]}; assert final_caps includes "dead_code_unallowlisted_python"
RED:     test_plan_confidence_handles_code_quality_invocation_failure_as_soft_cap() — mock subprocess to exit 2; assert "code_quality_invocation_failed" in soft_caps
RED:     test_plan_confidence_handles_code_quality_malformed_json() — mock subprocess returns invalid JSON on stdout; assert "code_quality_invocation_failed" + does NOT crash plan-confidence
RED:     test_plan_confidence_no_code_quality_invocation_when_no_slug() — invoke without slug (Mode 1); assert subprocess NEVER called
GREEN:   Implement consumer + extend run_structural.
REFACTOR: Extract subprocess-with-timeout pattern if already in deps-audit consumer.
VERIFY:  pytest .claude/skills/plan-confidence/tests/test_code_quality_integration.py -v
```

#### Acceptance Criteria
- [ ] 5 RED tests GREEN
- [ ] `/code-quality` CLI has `--no-audit-write` flag (cross-ref T5.1 acceptance)
- [ ] `plan-confidence/PORTABLE.md` documents new dependency
- [ ] End-to-end smoke: create fake plan with declared dead code; run `/plan-confidence {slug}`; assert verdict caps at 49 with `dead_code_unallowlisted_*` in hard_caps_triggered
- [ ] Pass: size — `_code_quality_consumer.py` ≤ 200 lines; run_structural.py delta ≤ 50 lines
- [ ] Pass: lint
- [ ] Inquebrável Rule 3 honored: integration is REAL, not documentation-only

#### DoD
- [ ] All RED tests GREEN
- [ ] End-to-end smoke passes
- [ ] T6.2 documentation is now backed by actual runtime code (no honesty gap)

---

### T6.4 — Update `HOW-TO-USE.md` to mention `/code-quality`

#### Objective
Onboarding doc reflects the new skill.

#### Evidence
HOW-TO-USE.md is the entry-point onboarding doc per `.claude/HOW-TO-USE.md § Quick start`.

#### Files to edit
```
.claude/HOW-TO-USE.md — (MODIFY) add /code-quality to quick start + skills table
```

#### Tasks
1. Add row to "When to use which cycle" table.
2. Add subsection in "Quick start" #3 (implement) for `/code-quality`.
3. Add `/code-quality` to skills/ directory listing in "Where things live".

#### TDD
```
RED:     test_how_to_use_mentions_code_quality() — grep "/code-quality"; assert ≥ 3 occurrences
GREEN:   Edit file.
REFACTOR: None.
VERIFY:  pytest .claude/skills/code-quality/tests/test_cycle_integration.py -v -k "how_to_use"
```

#### Acceptance Criteria
- [ ] 1 RED test GREEN

#### DoD
- [ ] RED test GREEN

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Symbol fabrication detection (M3 in plan-confidence-golden-rule) | T2.1, T2.2, T2.3, T2.4, T2.5 | Deterministic tree-sitter + registry lookup per language |
| 2 | Dead code estrutural detection | T1.1, T1.2, T1.3, T1.4 | Wrappers around knip, vulture, cargo-udeps, deadcode |
| 3 | Multi-language adapter pattern (D1) | T0.3, all T1.*, all T2.*, T3.1, T4.1, T4.2 | `scripts/detectors/{language}.py` modules with shared interface |
| 4 | Config via languages.txt | T0.2 | `.claude/rules/code-quality-languages.txt` ENABLED/DISABLED per language |
| 5 | Hard cap stable identifiers (D2) | T0.1, T5.2 | Golden rule + verdict aggregator |
| 6 | Deterministic via tree-sitter + registry (D5) | T2.1, T2.2, T2.3, T2.4, T2.5 | tree-sitter parsing + 24h-TTL registry cache |
| 7 | Position pos-implement, pre-review (D4 blueprint) | T6.1 | cycle-implement.md v1.x update |
| 8 | plan-confidence consumes verdict (D3 blueprint) | T6.2 | golden rule extension with stable identifiers |
| 9 | Allowlist with sunset | T0.1, T0.2, T0.4 | `code-quality-allowlist.txt` + sunset logic in `_shared.py` |
| 10 | Skill is read-only (analyze, don't auto-fix) | T0.3 (SKILL.md), all detectors | Documented in SKILL.md; detectors emit Findings, never edit files |
| 11 | Tests: positive + negative fixtures per language | T1.*, T2.*, T3.1, T4.*, T4.3 | ~32 fixtures across 4 languages × 4 detectors (with D4 deferred for Rust+Go) |
| 12 | Audit output at .claude/knowledge-base/audits/{slug}-code-quality-{date}.md | T5.3 | write_audit_report writes to deterministic path |
| 13 | Token budget documentation | T6.3 | token-budget.md updated |
| 14 | HOW-TO-USE.md updated | T6.4 | Skill mentioned in onboarding |
| 15 | Cross-package wiring detector | T3.1 | ast-grep + tree-sitter shared infrastructure |
| 16 | Test quality via mutation (D4) | T4.1, T4.2 | mutmut + stryker wrappers scoped to critical paths |
| 17 | Rust + Go mutation DEFERRED v0.2 | T4.3 | ADR + graceful skip Finding |
| 18 | Verdict JSON schema | T5.2 | Documented in SKILL.md; emit_json_summary produces compliant output |
| 19 | Subprocess error handling (missing binary, timeout, crash) | T1.1, T1.2, T1.3, T1.4, T5.1 | auditor_unavailable Findings + detector_crash isolation in orchestrator |
| 20 | Network/offline mode | T5.1 | --no-network flag + cache fallback in _registry.py |

| 21 | [EC-1] Malformed subprocess output | T0.4 (`safe_parse_json`), T1.1-T1.4, T4.1-T4.2 | Helper in `_shared.py`; every detector wraps json.loads via `safe_parse_json` |
| 22 | [EC-4] Allowlist sunset date validation | T0.4 (`load_allowlist`) | Regex + strptime; malformed → `allowlist_malformed_entry` HARD Finding |
| 23 | [EC-5] `## Critical paths` parsing validation | T4.1 (`_critical_paths.py`) | Schema validation: 1 section, valid glob, integer floor, non-empty reason |
| 24 | [EC-6] Slug resolution refuses discovery plans | T5.1 (`resolve_plan_path`) | Strict search: plans/ → plans/completed/; refuse discoveries/plans/ |
| 25 | [EC-9] Atomic cache writes | T0.4 (`write_atomic`), T2.2-T2.5 | tempfile + os.replace; POSIX-atomic rename |
| 26 | [EC-10] Skip list for file enumeration | T0.4 (`DEFAULT_SKIP_DIRS`), T1.1-T1.4, T3.1 | frozenset constant; consumed by all enumerators |
| 27 | [EC-12] `allowlist_key` determinism | T0.4 (`Finding.__post_init__`, `make_relative`, `sanitize_symbol`) | Repo-relative paths + sanitized symbols; assertions block misuse |
| 28 | [EC-15] TS type-only imports | T2.3 | Tree-sitter query distinguishes; validate `pkg OR @types/pkg` |
| 29 | [EC-16] Monorepo subpath exports skipped | T2.3 | Read package.json#exports + #workspaces + Node builtins |
| 30 | [EC-17] Module-local imports skipped | T2.2 (Python), T2.4 (Rust crate::/super::/self::), T2.5 (Go self-module) | Per-language relative-import detection |
| 31 | [EC-25] `--no-network` disables D2 entirely | T5.1 | Single INFO Finding `d2_disabled_no_network`; no cascade |
| 32 | [EC-28] CHANGELOG.md created (Inquebrável Rule 6) | T0.1 (sub-task 6) | Header + `[Unreleased]` + initial entry |
| 33 | [EC-29] plan-confidence runtime integration (Opção A) | T6.5 (NEW) | `_code_quality_consumer.py` + `run_structural.py` extension |
| 34 | [EC-18] Go vendored deps skipped from registry | T2.5 | Detect `vendor/` dir; skip lookups for modules vendored |
| 35 | [EC-19] All-languages-skipped verdict graceful | T5.1, T5.2 | Verdict=PASS, INFO Finding "no auditable languages detected" |
| 36 | [EC-30] Orchestrator top-level crash safe | T5.1 | Top-level try/except → emergency Finding + parseable JSON |

**Coverage: 36/36 gaps covered (100%)** — 20 originais + 16 absorvidos de `/edge-case-plan` (11 MUST FIX + 5 SHOULD TEST que viraram acceptance criteria explícito).

## Global Definition of Done

- [ ] All phases completed (Phase 0 through Phase 6 + Final) — including T6.5 [v1.1 NEW]
- [ ] All tests passing — `pytest .claude/skills/code-quality/tests/ -v` green (~80+ tests across 18+ test files after v1.1 absorbed EC tests)
- [ ] Zero lint warnings — `ruff check .claude/skills/code-quality/`
- [ ] File-size budget respected — every file ≤ 500 lines (per template default; specific budgets in tasks)
- [ ] **[EC-28]** CHANGELOG.md exists at repo root with `[Unreleased]` section containing entry for this skill (Inquebrável Rule 6 satisfied)
- [ ] All 4 new config files exist in `.claude/rules/` (golden-rule + languages + thresholds + allowlist)
- [ ] cycle-implement.md updated to v1.1 with `/code-quality` phase
- [ ] plan-confidence-golden-rule.md (LOCKED) extended with explicit user approval recorded
- [ ] **[EC-29]** plan-confidence/run_structural.py extended with `/code-quality` invocation (runtime integration shipped, not documentation-only)
- [ ] token-budget.md includes `/code-quality` row
- [ ] HOW-TO-USE.md mentions `/code-quality`
- [ ] **Runtime-metric proof** — `/code-quality` runs end-to-end against the real `.claude/skills/` Python codebase (smoke test in Final phase); audit file produced; verdict deterministic across re-runs. ADDITIONALLY: `/plan-confidence {slug}` invokes `/code-quality` and merges caps (end-to-end Mode 2 smoke).
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move `.claude/knowledge-base/plans/code-quality-skill-plan.md` to `.claude/knowledge-base/plans/completed/code-quality-skill-plan.md`. NEVER move before merge.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER all 6 phases complete. The plan is NOT done until validation passes end-to-end.

**Objective:** Validate the skill works in a real workload — not just isolated unit tests.

### Execution

```bash
# 1. Install the skill
bash .claude/skills/code-quality/setup.sh

# 2. Run unit + integration tests
cd .claude/skills/code-quality && pytest tests/ -v

# 3. Lint
ruff check .claude/skills/code-quality/

# 4. End-to-end smoke test (Mode 1 — standalone)
python3 .claude/skills/code-quality/scripts/run_code_quality.py --no-network

# 5. End-to-end smoke test (Mode 2 — plan-bound, using this very plan as the slug)
python3 .claude/skills/code-quality/scripts/run_code_quality.py code-quality-skill --no-network

# 6. Verify audit file was written
test -f .claude/knowledge-base/audits/code-quality-skill-code-quality-$(date +%Y-%m-%d).md

# 7. Cross-reference validator
python3 .claude/scripts/check_xrefs.py

# 8. [EC-29] End-to-end Mode 2 — plan-confidence consumes /code-quality verdict
python3 .claude/skills/plan-confidence/scripts/run_structural.py code-quality-skill
# Expected: structural caps include any /code-quality stable identifiers
# Verify integration is REAL (T6.5 runtime wiring), not documentation-only
```

### Acceptance Criteria

- [ ] All pytest tests green (~80+ tests after v1.1 absorbed; expected pass rate 100%)
- [ ] Zero ruff warnings
- [ ] Standalone mode produces JSON to stdout with verdict + findings_by_detector populated
- [ ] Plan-bound mode produces audit Markdown file at deterministic path
- [ ] `check_xrefs.py` passes (no broken cross-references in modified files)
- [ ] Runtime-metric proof: audit file produced; verdict is deterministic (re-run produces identical JSON modulo timestamps); audit file contains all 4 detector subsections (even when 0 findings — "No findings" placeholder)
- [ ] Smoke test against `.claude/skills/` (Python codebase that exists today) emits realistic findings count (not 0, not 1000+); document count in test output
- [ ] **[EC-29]** Step 8 passes: `/plan-confidence code-quality-skill` shows `/code-quality` was invoked + caps merged. Integration is runtime-real, not documentation-only.

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing environment issues (missing nightly toolchain, missing knip binary, etc.).
2. Environment issues: document in PORTABLE.md installation steps + skip the affected test with clear reason.
3. Plan-caused failures: fix before declaring complete. Re-run validation chain.
4. Pre-existing issues unrelated to this plan: log in PR description, do NOT block plan completion.
