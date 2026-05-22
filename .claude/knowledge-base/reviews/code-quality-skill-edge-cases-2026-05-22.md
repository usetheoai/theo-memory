# Edge Case Review — code-quality-skill

**Data:** 2026-05-22
**Plano:** [`.claude/knowledge-base/plans/code-quality-skill-plan.md`](../plans/code-quality-skill-plan.md) v1.0
**Reviewer:** `/edge-case-plan`
**Tasks analisadas:** 20
**Edge cases encontrados:** 23 (MUST FIX: 11, SHOULD TEST: 8, DOCUMENT: 4)

**Veredicto:** PLANO PRECISA DE AJUSTE — 11 MUST FIX identificados; concentrados em (a) parsing/validação de inputs externos, (b) determinismo de allowlist matching, (c) falsos-positivos em D2 (symbol fabrication), (d) integração com `/plan-confidence` que é "documentation-only" no plano atual.

---

## MUST FIX

### EC-1: Saída malformada de subprocess não é tratada

- **Task afetada:** T1.1, T1.2, T1.3, T1.4, T4.1, T4.2 (todos detectores que invocam binários externos)
- **Família:** Format / Boundary
- **Cenário:** vulture/knip/cargo-udeps/etc retornam JSON corrompido (truncamento por OOM, version drift entre o que o plano espera e o que o usuário tem instalado). `json.loads()` levanta `JSONDecodeError`. Plano trata exit code != 0 mas não malformed JSON em exit code 0.
- **Impacto:** Skill crasha com stack trace; orchestrator não isola; verdict não é emitido; CI fica em estado indefinido.
- **Fix sugerido:** Em cada `_parse_{tool}_output`, wrap `json.loads()` em try/except `JSONDecodeError` → emit `auditor_output_malformed_{tool}` Finding (SOFT_CAP).

### EC-4: Sunset date com formato inválido é silenciosamente aceito

- **Task afetada:** T0.4 (`load_allowlist`)
- **Família:** Format / Input
- **Cenário:** Usuário edita `code-quality-allowlist.txt` e escreve `01/08/2026` (locale BR) ou `2026-13-45` (mês inválido) ou deixa campo vazio. Plano diz "parse sunset_date as `date`" mas não especifica fail-mode.
- **Impacto:** Se o parser usa `try/except` silencioso, entries malformadas viram NOT_LISTED → finding bypassa allowlist sem audit. Se o parser crasha, skill não roda.
- **Fix sugerido:** `load_allowlist` valida cada linha com regex `^\d{4}-\d{2}-\d{2}$` e `datetime.strptime(s, "%Y-%m-%d")` — qualquer erro emite `allowlist_malformed_entry` Finding HARD (não silencia).

### EC-5: Parsing de `## Critical paths` sem validação de schema

- **Task afetada:** T4.1 (`_critical_paths.py`)
- **Família:** Format / Input
- **Cenário:** Plano declara `## Critical paths` mas com glob vazio, floor "high" ao invés de "80%", trailing whitespace, ou múltiplas seções `## Critical paths` (user copy-paste).
- **Impacto:** Mutation testing roda em paths errados ou pula silenciosamente; verdict produzido é não-confiável.
- **Fix sugerido:** Em `_critical_paths.py` validar: (a) glob não-vazio e parseável por `pathlib.Path().match`; (b) floor é inteiro 0-100; (c) apenas UMA seção `## Critical paths` no documento. Erro → `plan_critical_paths_malformed` Finding HARD.

### EC-6: Slug colide entre plans/ implementation e discoveries/plans/

- **Task afetada:** T5.1
- **Família:** Input / Boundary
- **Cenário:** Usuário invoca `/code-quality wiring-deadcode-gates`. Slug existe em `.claude/knowledge-base/discoveries/plans/wiring-deadcode-gates-plan.md` (discovery plan), NÃO em `.claude/knowledge-base/plans/`. Discovery plan tem schema diferente (research questions, coverage corners) — não tem `## Critical paths`.
- **Impacto:** Skill ou crasha tentando parsear schema errado, ou silenciosamente trata discovery plan como implementation plan e emite verdict baseado em zero critical paths.
- **Fix sugerido:** T5.1 tenta `plans/{slug}-plan.md` PRIMEIRO; se não existir, falha com erro explícito `plan_not_found: looked in plans/{slug}-plan.md and plans/completed/{slug}-plan.md`. NÃO faz fallback para `discoveries/plans/`.

### EC-9: Cache de registry não usa escrita atômica

- **Task afetada:** T2.2, T2.3, T2.4, T2.5 (`_registry.py`)
- **Família:** Concorrência / State
- **Cenário:** CI roda 2 jobs em paralelo (PR + main); ambos invocam `/code-quality`; ambos escrevem em `~/.cache/code-quality/registry/python.json`. Race condition resulta em JSON truncado.
- **Impacto:** Próxima invocação encontra cache corrompido → JSONDecodeError → (EC-1) crash ou (com EC-3 fix) re-fetch desnecessário em escala.
- **Fix sugerido:** Escrita atômica via `tempfile.NamedTemporaryFile(dir=cache_dir, delete=False)` + `os.replace(tmp, target)`. POSIX garante rename atômico no mesmo filesystem.

### EC-10: Falta lista padrão de diretórios a pular durante enumeração

- **Task afetada:** T1.1, T1.2, T1.3, T1.4, T3.1 (qualquer task que faz `Glob`/enumeração)
- **Família:** Resource / Performance
- **Cenário:** Skill enumera arquivos `.py` no repo. Sem skip list, varre `node_modules/`, `.venv/`, `__pycache__/`, `target/`, `.git/`, `referencia/` (clones Mem0/Letta/LangMem com 110+ MB).
- **Impacto:** Tempo de execução explode (minutos vs segundos); falsos positivos em código de terceiros que não controlamos; viola Inquebrável Rule do `cycle-discover.md` "NEVER modify anything inside `referencia/`" — embora aqui seja READ, mas ainda é poluição de findings.
- **Fix sugerido:** `_shared.py` exporta constante `DEFAULT_SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", "target", "dist", "build", "referencia", ".mypy_cache", ".pytest_cache", ".ruff_cache", "vendor"}` — todos os detectores aplicam.

### EC-12: `allowlist_key` não-determinístico (caminho absoluto vs relativo + caracteres especiais)

- **Task afetada:** T0.4, T1.*, T2.*, T3.1
- **Família:** Format / State
- **Cenário:** Detector emite Finding com `file_path` absoluto (`/home/paulo/.../foo.py`). Allowlist tem entry com path relativo (`.claude/skills/foo/foo.py`). Match falha → finding bypassa allowlist.
- **Impacto:** Allowlist não funciona; HARD findings re-fire mesmo com entry válida; gate fica inviável de operar.
- **Fix sugerido:** `Finding.file_path` sempre relativo ao `repo_root`. `allowlist_key` é composto: `f"{language}|{relative_path}|{finding_type}|{symbol_sanitized}"` onde symbol_sanitized substitui `|` por `\|`. Documentar em `_shared.py` Finding docstring.

### EC-15: TypeScript type-only imports são falsos-positivos em D2

- **Task afetada:** T2.3
- **Família:** Format / Input
- **Cenário:** `import type { Foo } from 'some-types-only-pkg'`. Plano T2.3 valida pacote contra npm registry. Se pacote é só `@types/foo` ou type-only export (e.g., types-only packages publicados como devDeps), pode não estar disponível como runtime pkg.
- **Impacto:** False positive HARD CAP → bloqueia PRs legítimos.
- **Fix sugerido:** Tree-sitter query identifica `import type` vs `import`; type-only imports vão para validação separada que aceita `@types/foo` E `foo` (variantes); se ambos ausentes → mantém HARD.

### EC-16: Subpath exports do próprio monorepo são tratados como pacotes externos

- **Task afetada:** T2.3
- **Família:** Boundary / Format
- **Cenário:** Código TheoMemory imports `@usetheo/memory/cloud` (subpath export declarado em `package.json#exports`). Não é pacote separado no npm; é apenas um subpath. T2.3 query npm registry para `@usetheo/memory/cloud` → 404.
- **Impacto:** HARD CAP em todo arquivo que usa subpath exports do próprio monorepo. Bloqueia tudo.
- **Fix sugerido:** T2.3 lê `package.json#exports` do repo + `package.json#name` + `package.json#workspaces`; imports que MATCHAM esses padrões são pulados da validação npm (são internos por definição).

### EC-17: Python relative imports tentam ir ao PyPI

- **Task afetada:** T2.2
- **Família:** Format / Input
- **Cenário:** Código Python usa `from .foo import bar` ou `from ..utils import helper`. Tree-sitter extrai módulo como `.foo` ou `..utils`. T2.2 tenta `package_exists_on_pypi(".foo")` → 404.
- **Impacto:** Cada relative import vira HARD CAP. Codebase Python típica tem dezenas; gate fica inviável.
- **Fix sugerido:** T2.2 detector skip explicit: imports cujo `module` começa com `.` são module-local; nunca consultar PyPI. Same para Rust `use crate::` e `use super::`. Same para Go imports começando com path do `go.mod#module`.

### EC-25: `--no-network` produz cascata de SOFT_FLOOR mascarando uso real

- **Task afetada:** T5.1, T2.2-T2.5
- **Família:** State / Boundary
- **Cenário:** Usuário roda `--no-network` em CI offline. Todos lookups de registry retornam None → todas chamadas D2 viram `symbol_fab_unverifiable_*` SOFT_FLOOR.
- **Impacto:** Verdict cap 89 (PASS_WITH_CAVEATS) por razão errada (não é qualidade do código; é configuração de rede); ruído masca findings reais.
- **Fix sugerido:** Com `--no-network`, D2 emite UM ÚNICO Finding INFO `d2_disabled_no_network` (severity INFO, não afeta verdict) e NÃO roda lookups. Documentado em SKILL.md como caveat — para CI air-gapped, D2 deve ser combinado com D1 + D3 apenas.

### EC-28: CHANGELOG.md não existe; Inquebrável Rule 6 obriga

- **Task afetada:** Global DoD + T0.1 (foundation phase)
- **Família:** Process / Compliance
- **Cenário:** Plano Global DoD diz "CHANGELOG.md updated under [Unreleased] once the file exists in the repo (currently does not — note as known gap)". Mas Inquebrável Rule 6 é mandatória: "Todo projeto DEVE manter um CHANGELOG.md na raiz". O plano contradiz Inquebrável Rule 6 abertamente.
- **Impacto:** `/plan-confidence` `architecture_compliance` check pode marcar; `/review` certamente marca; user pode rejeitar plano por violar regra inquebrável.
- **Fix sugerido:** Adicionar à T0.1 sub-task: "Create CHANGELOG.md at repo root with header + `## [Unreleased]` + `### Added — code-quality skill scaffolding (TheoMemory entry)`". Bumps T0.1 acceptance criteria + Global DoD `CHANGELOG.md updated` passa de "skip" para "done".

### EC-29: T6.2 modifica golden rule (LOCKED) mas runtime integration fica documentation-only

- **Task afetada:** T6.2
- **Família:** Integration / Wiring
- **Cenário:** T6.2 adiciona stable identifiers ao `plan-confidence-golden-rule.md`. Mas o CÓDIGO de `/plan-confidence` (`run_structural.py`) não é estendido para INVOCAR `/code-quality` nem PARSEAR seu JSON. Resultado: golden rule diz "plan-confidence consome verdict", mas plan-confidence na prática não consome.
- **Impacto:** Wiring triad (caller + integ test + runtime metric) NÃO atende; pillar (a) FAIL — `check_wiring.py` flagaria. Plano declara integração que não existe — viola Inquebrável Rule 3 (extreme honestidade) + `cycle-implement.md` Hard gate #4.
- **Fix sugerido:** Duas opções (escolher uma):
  - **A**: Adicionar nova task T6.5 — estender `plan-confidence/scripts/run_structural.py` para invocar `/code-quality` (via subprocess ou import) e consumir JSON output. Custo: +1 task, +sprint.
  - **B**: Tornar T6.2 ADR-only — adicionar parágrafo explícito "runtime integration deferred to v0.2; this plan ships golden-rule documentation only. /plan-confidence does not consume /code-quality verdict in v0.1; mantém-se standalone." Custo: zero, mas v0.1 não tem o gate enforcement promised. **Recomendado se queremos v0.1 ship rápido.**

---

## SHOULD TEST

### EC-2: Registry retorna HTML ao invés de JSON (vendor outage)

- **Task afetada:** T2.2, T2.3, T2.4, T2.5
- **Teste sugerido:** `test_registry_lookup_handles_html_response()` — mock `requests.get` para retornar `Content-Type: text/html`; assertar que `package_exists_on_pypi` retorna None (ambiguous), NÃO False (causaria FP HARD).

### EC-3: Cache corrompido em disco

- **Task afetada:** T2.2 (`_registry.py`)
- **Teste sugerido:** `test_corrupted_cache_recovered()` — escrever JSON truncado em cache file; chamar `package_exists_on_pypi`; assertar que skill detecta corrupção, deleta cache, re-fetcha do registry.

### EC-7: mutmut/stryker escrevem em stderr ao invés de stdout

- **Task afetada:** T4.1, T4.2
- **Teste sugerido:** `test_mutation_detector_reads_from_correct_stream()` — fixture roda mutmut real (ou stub que escreve em stderr); assertar que detector lê de onde a versão atual realmente escreve. Documentar versão pinned em pyproject.toml.

### EC-8: Tree-sitter parse error em arquivo com syntax error

- **Task afetada:** T2.1, T3.1
- **Teste sugerido:** `test_tree_sitter_handles_syntax_error_gracefully()` — fixture com `def foo(` (Python syntax error); assertar parser retorna nodes parciais SEM crashar; arquivo skipado com INFO Finding `parse_error_{lang}`.

### EC-14: Tree-sitter grammar regression canary

- **Task afetada:** T2.1
- **Teste sugerido:** `test_canary_known_findings_count()` — fixture com 3 imports de PyPI + 3 fabricated; assertar count(findings) == 3. Se grammar drift quebra queries, count cai para 0 silenciosamente — canary captura.

### EC-18: Go vendored dependencies não devem ir ao Go proxy

- **Task afetada:** T2.5
- **Teste sugerido:** `test_go_vendored_deps_skipped()` — fixture com `vendor/github.com/x/y/`; tree-sitter extrai `import "github.com/x/y"`; assertar que detector PULA Go proxy lookup (módulo está vendored localmente).

### EC-19: Skill roda mas zero linguagens ativas (config + manifests não batem)

- **Task afetada:** T5.1, T5.2
- **Teste sugerido:** `test_verdict_pass_when_no_languages_active()` — config tem rust+go ENABLED mas repo só tem package.json (typescript DISABLED); assertar verdict=PASS, `languages_audited=[]`, INFO message "no auditable languages detected".

### EC-30: Orchestrator top-level crash

- **Task afetada:** T5.1
- **Teste sugerido:** `test_orchestrator_top_level_exception_emits_emergency_finding()` — mock `compute_verdict` para raise; assertar exit code != 0; assertar JSON output AINDA é parseável + contém Finding `orchestrator_crash` com stack trace truncado.

---

## DOCUMENT

### EC-11: Pre-code phase — repo sem `src/`

- **Risco aceito:** TheoMemory hoje tem `src/` vazio (pre-code). Skill deve degradar graciosamente: TypeScript detector reporta "no src/ detected, skipping" como INFO Finding, não erro. Plano já prevê isso na T1.2 acceptance criteria; reforçar em SKILL.md.

### EC-13: Knip workspaces vs single-package

- **Risco aceito:** v0.1 suporta single-package + Knip auto-detect de workspaces (Yarn/pnpm/npm workspaces). Monorepos exóticos (Lerna sem workspaces, Bit, Rush) podem precisar config extra. Documentar em PORTABLE.md "Knip handles standard npm/yarn/pnpm workspaces; outras configs podem exigir `knip.config.ts` manual".

### EC-21: Owner rejeita T6.2 (mudança em LOCKED file)

- **Risco aceito:** Se owner não aprova extensão de `plan-confidence-golden-rule.md`, skill ship standalone: `/code-quality` invocável manualmente, audit file produzido, verdict standalone — mas SEM enforcement automático em `/plan-confidence`. Documentar em SKILL.md "Modo de degradação: standalone-only quando golden rule não estendido".

### EC-23: Cache TTL 24h — pacotes yanked não detectados

- **Risco aceito:** Se um pacote é yanked do PyPI/npm/crates.io APÓS o último cache hit, skill não detecta por até 24h. Casos reais (ua-parser-js 2021, event-stream 2018) sugerem ~horas de janela. Trade-off: TTL menor = mais HTTP calls = CI lento. 24h é equilíbrio razoável. Documentar em `code-quality-thresholds.txt` comment.

---

## Resumo por task

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 1 (EC-28 — CHANGELOG.md) | 0 | 0 |
| T0.2 | 0 | 0 | 0 | 0 |
| T0.3 | 0 | 0 | 0 | 0 |
| T0.4 | 2 | 2 (EC-4, EC-12) | 0 | 0 |
| T1.1 | 2 | 1 (EC-1) | 0 | 1 (EC-11 indirect) |
| T1.2 | 2 | 2 (EC-1, EC-10) | 0 | 1 (EC-11) |
| T1.3 | 1 | 1 (EC-1) | 0 | 0 |
| T1.4 | 1 | 1 (EC-1) | 0 | 0 |
| T2.1 | 2 | 0 | 2 (EC-8, EC-14) | 0 |
| T2.2 | 4 | 2 (EC-9, EC-17) | 2 (EC-2, EC-3) | 1 (EC-23) |
| T2.3 | 3 | 3 (EC-15, EC-16, EC-9) | 1 (EC-2) | 0 |
| T2.4 | 2 | 1 (EC-9) | 1 (EC-2) | 0 |
| T2.5 | 2 | 1 (EC-9) | 2 (EC-2, EC-18) | 0 |
| T3.1 | 1 | 1 (EC-10) | 0 | 0 |
| T4.1 | 2 | 1 (EC-5) | 1 (EC-7) | 0 |
| T4.2 | 1 | 0 | 1 (EC-7) | 0 |
| T4.3 | 0 | 0 | 0 | 0 |
| T5.1 | 4 | 2 (EC-6, EC-25) | 2 (EC-19, EC-30) | 0 |
| T5.2 | 1 | 0 | 1 (EC-19) | 0 |
| T5.3 | 0 | 0 | 0 | 0 |
| T6.1 | 0 | 0 | 0 | 0 |
| T6.2 | 1 | 1 (EC-29) | 0 | 1 (EC-21) |
| T6.3 | 0 | 0 | 0 | 0 |
| T6.4 | 0 | 0 | 0 | 0 |

**Total:** 23 edge cases — 11 MUST FIX, 8 SHOULD TEST, 4 DOCUMENT.

---

## Decisão crítica que cabe ao usuário

**EC-29 (T6.2 documentation-only) é o edge case mais consequente.** Define se v0.1 entrega ENFORCEMENT real ou ENFORCEMENT documentado.

**Recomendação:** Opção B (ADR docs-only para v0.1; runtime integration v0.2). Razão: ship mais rápido + segue padrão dos siblings (`/deps-audit` v1.1 também tem integração ainda documentation-only em `plan-confidence` per `cycle-plan.md § Downstream changes`). Skill standalone ainda é valiosa — usuário pode rodar manualmente + colar verdict em PR.

**Se Opção A (ship completo):** Adicionar T6.5 estendendo `plan-confidence/scripts/run_structural.py` — custo ~1 task adicional, mas v0.1 é realmente o gate inquebrável prometido.

---

## Cross-references

- Plano fonte: [`code-quality-skill-plan.md`](../plans/code-quality-skill-plan.md)
- Blueprint origem: [`wiring-deadcode-gates-blueprint.md`](../discoveries/blueprints/wiring-deadcode-gates-blueprint.md)
- Cycle rule: [`cycle-plan.md`](../../rules/cycle-plan.md) v1.1 § Phase contracts (`edge-case-plan` row)
- Sibling skill: [`/deps-audit`](../../skills/deps-audit/SKILL.md) — usado como template arquitetural; mesmas categorias de edge cases (subprocess, registry, allowlist) aparecem lá
- Padrão de absorção: usuário humano lê este report + edita plano v1.0 → v1.1 incorporando MUST FIX + re-roda `/plan-confidence`
