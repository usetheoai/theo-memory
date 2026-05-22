# Changelog

Todos os mudanças relevantes em `@usetheo/memory` (TheMemory) e na infraestrutura `.claude/` que governa o desenvolvimento. Format: [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — /code-quality skill scaffolding (2026-05-22, in progress)

Cycle-plan chain artifacts for multi-language wiring + dead-code + symbol-fabrication gate.

#### Blueprint + plan + edge-case + deps-audit
- `.claude/knowledge-base/discoveries/blueprints/wiring-deadcode-gates-blueprint.md` — deep-research synthesis (WebSearch + WebFetch over SOTA papers, vendor docs, OSS monorepo CI patterns). Honest about being produced outside `/discover-execute` formal pipeline.
- `.claude/knowledge-base/plans/code-quality-skill-plan.md` — v1.3 SHIPPABLE_WITH_CAVEATS (85.2/100). 25 tasks across 7 phases + Final validation. Coverage Matrix 36/36 (100%). All 8 ADRs with rejected alternatives. Multi-language scope: TypeScript + Python + Rust + Go.
- `.claude/knowledge-base/reviews/code-quality-skill-edge-cases-2026-05-22.md` — 23 EC identified, 11 MUST FIX absorbed into plan v1.1.
- `.claude/knowledge-base/audits/code-quality-skill-deps-audit-2026-05-22.md` — INVALID_PLAN_DEPS initial findings (F1 stryker wrong package name, F2 deadcode @latest version unspecified, F3-F5 outdated MAJORs, F6 osv-scanner missing). All 6 absorbed into plan v1.2.
- `.claude/knowledge-base/implementations/code-quality-skill-implementation.md` — implementation working contract; 25 tasks with dependency graph.

#### Rules infrastructure
- `.claude/rules/code-quality-golden-rule.md` (T0.1, NEW) — locked contract with 4 HARD CAPs (dead_code_unallowlisted_{language}, symbol_fabrication_{language}, plan_missing_critical_paths_section, allowlist_malformed_entry) + 5 SOFT CAPs (orphan_export, mutation_score_low/medium, auditor_unavailable, d2_disabled_no_network). Sibling of deps-audit-golden-rule.

### Added — Teacher/Student model split (2026-05-22)

Inspirado por `huggingface/upskill` v2 (`src/upskill/model_resolution.py`), trazendo roteamento de modelo por **papel** para os dois cycles mais caros — `/review` (MVP) e `/implement` (escopo enxuto).

#### `/review` agent model split (full)
- `.claude/skills/review/scripts/spawn_reviewers.py` — resolve `model:` por arquétipo via rule declarativa, com fallback chain `cli override > rule > default opus`. Helpers: `_load_routing_rule` (parser stdlib-only, tolerante a UTF-8 BOM e linhas malformadas), `_resolve_model` (com EC-1 invariant: `domain-X` → base `domain` lookup), `_ModelOverrideAction` (custom argparse, rejeita valores vazios).
- `.claude/skills/review/scripts/spawn_reviewers.py` — novas flags CLI `--routing-rule PATH` e `--model-override ROLE=MODEL` (repetível). JSON output ganha `routing_rule_path`, `routing_rule_loaded`, `experimental_routings`.
- `.claude/skills/review/templates/agent-*.md` (5 templates) — frontmatter agora declara `model: {MODEL}` substituído por role.
- `.claude/skills/review/tests/test_spawn_reviewers.py` — 10 RED→GREEN tests adicionados (5 core + 5 SHOULD TEST de EC-3..EC-7); 14/14 verde.
- `.claude/rules/review-model-routing.txt` (NEW) — mapeamento role → model com `experimental_until=2026-06-22` + `rollback_if=blocker_findings_gt_2_per_5_runs` por entry. Default: 4 baseline → haiku; cross-validation → opus.
- `.claude/rules/cycle-review.md` — nova seção "Model routing (teacher/student split)" documentando contrato, fallback chain, EC-1 invariant, escalation override.
- `.claude/rules/token-budget.md` — `/review` row atualizada: ~60k (split) / 150-250k (fallback), com nota de escalation override em "When NOT to use".
- Economia estimada: ~70% por `/review` invocation (200k → ~60k) quando rule presente.

#### `/implement` halt-loop split (experimental, COMMIT phase only)
- `.claude/knowledge-base/discoveries/blueprints/teacher-student-halt-loop-spike.md` (NEW, marked `-spike`) — investigation T2.1 confirms VIÁVEL com Agent tool aninhado dentro de ralph-loop iterations. Both ralph-loop source paths cited (cache + marketplace, drift=zero).
- `.claude/rules/implement-model-routing.txt` (NEW) — `commit: haiku experimental_until=2026-07-22 rollback_if=...`. GREEN migration deferred a 2026-08-22 per spike recommendation (escopo enxuto).
- `.claude/rules/cycle-implement.md` — nova seção "Model routing (teacher/student split — experimental)".
- `.claude/skills/implement/prompts/implementation-prompt.md` — COMMIT phase preamble instrui halt-loop driver a delegar composição via Agent tool aninhado com modelo resolvido (quando rule presente).
- `.claude/rules/token-budget.md` — `/implement` row reflete experimental status + saving modesto (~5-10%) até GREEN ship.

#### Plan + audit trail (Inquebrável Rule 6)
- `.claude/knowledge-base/plans/teacher-student-model-split-plan.md` (v1.1, SHIPPABLE 100/100) — plan completo com 5 ADRs, 25 gaps Coverage Matrix 100%, 11 tasks ordenadas, 5 SHOULD TEST inline na seção TDD de T1.3.
- `.claude/knowledge-base/reviews/teacher-student-model-split-edge-cases-2026-05-22.md` — 11 edges identificados (2 MUST FIX + 5 SHOULD TEST + 4 DOCUMENT), absorvidos no plan v1.0 → v1.1.
- `.claude/knowledge-base/reviews/teacher-student-model-split-confidence-2026-05-22.md` — M2 deterministic score 100/100 SHIPPABLE.
- `.claude/knowledge-base/implementations/teacher-student-model-split-implementation.md` — implementation contract com pre-condition gate output + status per task.
- `.claude/skills/plan-confidence/tests/test_real_plans_snapshot.py` — snapshot entry adicionado para o novo plan.

### Added — Foundation (2026-05-21)

#### Project bootstrap
- `CLAUDE.md` (202 linhas) — contrato do projeto: positioning, 4 overrides do root, arquitetura Mem0-shape locked, 3-tier scope, ADD-only, MIT license exception
- `README.md` (22001 chars) — pitch público pré-release
- `docs/agentic-memory-landscape.md` — survey de 10+ players no espaço de agentic memory (Mem0, Letta, Zep, Cognee, Honcho, LangMem, etc.)
- `docs/exploration-reports/mem0-ts.md` — exploração profunda do Mem0 TypeScript SDK que originou as 5 decisões arquiteturais locked

#### Claude Code infrastructure
- `.claude/settings.json` — 48 permissions allow + 24 deny + 3 hook types (PreToolUse, PostToolUse, Stop)
- `.claude/settings.local.json.example` — template para overrides pessoais (gitignored)
- `.claude/hooks/` — 5 hooks defensive em shell:
  - `validate-command.sh` (Inquebrável git rules, npm publish guard, referencia/ readonly, rm -rf system paths)
  - `boundary-check.sh` (DIP enforcement: core/ ↛ local/cloud, theokit/ → core/ only)
  - `post-edit-check.sh` (TypeScript no-emit check pós-edit; SKIP até tsconfig.json existir)
  - `public-copy-lint.sh` (warn-first: Mem0-clone, production-ready, Apache-2.0 vs MIT, Qdrant/pgvector em copy pública)
  - `stop-validation.sh` (TDD warn-first, CLAUDE.md locked-items drift, CHANGELOG discipline)
- `.gitignore` atualizado — cobertura completa de Python caches (`.hypothesis/`, `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/`, `__pycache__/`), settings pessoais, scratch dirs

#### Rules (`.claude/rules/`)
- `architecture.md` — DIP boundaries, 3-tier model, ADD-only, naming conventions, module hygiene
- `testing.md` — TDD + BDD, pyramid (unit/integration/e2e), Mem0 six-phase pipeline tests, AAA format
- `public-copy.md` — voice/tone aspiracional, banned positioning anchors, MIT exception, cross-Project Rule 9

#### Skills bootstrap — adaptação Rust → TS/Node
- Skills `to-plan`, `edge-case-plan`, `plan-confidence`, `plan-improve` adaptadas do padrão Rust original (que foi importado) para TS/Node
- Cargo / clippy / dogfood / code-audit / cross-validation references substituídas por npm / tsc / eslint / vitest
- 5 cópias de `.example` templates → `.claude/rules/`:
  - `plan-confidence-golden-rule.md`
  - `plan-confidence-thresholds.txt`
  - `plan-confidence-allowlist.txt`

### Added — Cycles ecosystem (2026-05-21)

#### `cycle-discover` (chain inquebrável para deep-research em `referencia/`)
- Skill `discover-plan` — gera discovery plan em `.claude/knowledge-base/discoveries/plans/{slug}-plan.md`; Step 3 explícito + question budget 5-10 com max 3 por corner; pre-validation de paths citados; PORTABLE.md para reuse cross-project; 3 fixtures (good + 2 bad examples) (#issue-discover-plan)
- Skill `discover-edge-cases` — análogo de `edge-case-plan` para discovery; classificação MUST FIX / SHOULD TEST / DOCUMENT (#discover-edge-cases)
- Skill `discover-execute` — halt-loop ralph-loop sobre `referencia/`; produz blueprint estruturado em `discoveries/blueprints/` (#discover-execute)
- Skill `discover-confidence` — score estrutural do blueprint (4 dimensões: research_coverage + reference_citations + completeness + smells); hard caps `empty_corner_*` + `fabricated_citation` (#discover-confidence)
- Skill `discover-improve` — halt-loop ralph-loop pra refinar blueprint (Phase A determinístico + Phase B LLM) (#discover-improve)
- Cauda de skill-distillation (3 skills):
  - `skill-writer` — extrai patterns + ADRs + recommendations do blueprint → candidate skill em `.claude/skills/generated/{topic}-patterns/` (#skill-writer)
  - `skill-validator` — 5 checks deterministic (frontmatter, citations, dedup, description clarity, forbidden patterns) → PASS / NEEDS_REVIEW / REJECT (#skill-validator)
  - `skill-register` — promove candidato PASS → first-class skill, escreve audit trail em `reviews/skill-register-*.md` (#skill-register)
- `cycle-discover.md` — source of truth do ciclo (v1.0 ACTIVE)
- Discovery plan real produzido: `letta-pgvector-schema-plan.md` (160 linhas, 8 questions, 4/4 corners, 100% citations resolvidas)

#### `cycle-plan` (chain inquebrável para implementation planning)
- 4 skills (to-plan, edge-case-plan, plan-confidence, plan-improve) consolidadas como ciclo unificado
- `cycle-plan.md` — source of truth (v1.0 ACTIVE)
- Chain: `/to-plan → /edge-case-plan → /plan-confidence → /plan-improve → /plan-confidence` (inquebrável)
- Step 0 estendido para auto-discovery de patterns skills via frontmatter scan
- Pattern skills geradas por cycle-discover são consumidas automaticamente (consumer chain fechado)

#### `cycle-implement` (single-skill entry-point)
- Skill `implement` — entry-point único; halt-loop ralph-loop com 5 fases por task (RED → GREEN → REFACTOR → WIRING → COMMIT) (#implement)
- Wiring triad como HARD GATE — pillar (a) static caller + pillar (b) integration test + pillar (c) runtime metric
- Quality rules enforcadas: SOLID, Clean Code, DRY, Design Patterns
- Scripts: `check_wiring.py`, `run_validation.py`
- `cycle-implement.md` — source of truth (v1.0 ACTIVE; promovido de v0.1 PROPOSED após consolidação de 3 → 1 skill)
- Lição "sota-context-engineering e67d134" referenciada explicitamente — wiring triad fecha o gap de "tests pass ≠ system works"

#### `cycle-review` (gate mais rigoroso)
- Skill `review` — entry-point único; gera 5-7 agentes especializados dinâmicos por invocação
- 4 agentes baseline (architecture, tests, wiring, cross-validation) + 1-3 domain-specific
- Agentes persistidos em `.claude/agents/review-{slug}-{date}/` como audit trail
- Cross-validation linha-a-linha via Agent task (semantic match, não regex)
- Scripts: `detect_domain.py`, `spawn_reviewers.py`, `edge_case_coverage.py`, `consolidate_findings.py`
- Severity classification: BLOCKER / CRITICAL / MAJOR / MINOR / INFO
- Verdict bands: READY_TO_MERGE / NEEDS_FIXES / NEEDS_DEEPER
- `cycle-review.md` — source of truth (v1.0 ACTIVE; promovido de v0.1 PROPOSED)

### Added — Auxiliary skills (2026-05-21)
- Skill `ast-grep` — structural code search via tree-sitter; 5 rule files YAML pré-validados (class-extends-ts, method-in-class-ts, method-call-ts, async-function-python, decorated-function-python); workflow "zoom out (ast-grep) → zoom in (Read)" documentado; integrado ao prompt do discover-execute

### Added — Skills cleanup (2026-05-21)
- Removidas globalmente todas as skills custom do gstack (44 skills movidas para `~/.claude/skills-bkp/` como audit trail)
- 7 plugins do user disabled em `~/.claude/settings.json`; mantidos: ralph-loop, codex, frontend-design
- Built-in skills da Anthropic mantidas (init, review, security-review, update-config, simplify, loop, claude-api, fewer-permission-prompts, keybindings-help)

### Added — Cycle rules SoT migration (2026-05-21)
- 4 cycle rules criadas: cycle-discover, cycle-plan, cycle-implement (PROPOSED → ACTIVE), cycle-review (PROPOSED → ACTIVE)
- Schema único em todas: Purpose / Trigger / Chain / Phase contracts / Hard gates / Soft gates / Stop conditions / Anti-patterns / Rollback / Cross-references / Versioning
- 12 SKILL.md migradas para apontar pro SoT via blocos "Cycle contract" (removeu ~200 linhas de duplicação só em to-plan/SKILL.md)
- Cross-references explícitos entre cycles (discover ↔ plan ↔ implement ↔ review)

### Added — Documentation + governance (2026-05-21, P1+P2)
- `CHANGELOG.md` (este arquivo) — Inquebrável Rule 6
- `.claude/HOW-TO-USE.md` — onboarding doc com fluxograma e exemplos
- `.claude/rules/audit-trail-rotation.md` — policy para rotação de agents/, reviews/
- `.claude/rules/token-budget.md` — custo estimado por cycle/skill
- `.claude/rules/loop-engine-convention.md` — quando ralph-loop vs Agent tool vs Skill tool
- `.claude/scripts/check_xrefs.py` — utility validator para cross-references no ecosystem
- `mem-researcher` agent archived em `.claude/agents/_archive/` (substituído pelo cycle-discover sistematizado)

### Fixed — Skills semantic review pass (2026-05-22)
Segunda rodada de revisão semântica profunda das 17 skills via 5 subagentes paralelos. 3 CRITICAL + 10 MAJOR + 7 MINOR aplicados; 233 tests Python continuam verde após os fixes.

**CRITICAL (typo + path conflict + promise reuse):**
- `plan-confidence/SKILL.md:56` — heading `## Hard Caps (mirror dogfood-golden-rule.md)` corrigido para `plan-confidence-golden-rule.md` (arquivo correto, já citado nas linhas 14/68/124 da mesma skill)
- `discover-execute/prompts/execute-mode-prompt.md:8` — caminho do progress file alinhado a `.claude/knowledge-base/discoveries/.progress-{PLAN_SLUG}.json` (era `.claude/skills/discover-execute/...`, órfão das regras de audit-trail-rotation e do próprio SKILL.md)
- `discover-execute/prompts/execute-mode-prompt.md:108-114` — exhaustion path agora emite `<promise>BLUEPRINT_BLOCKED</promise>` (não mais `BLUEPRINT_COMPLETE`), evitando contaminar o sinal de sucesso com casos blocked

**MAJOR — documentação:**
- `to-plan/SKILL.md` (3 ocorrências) + `plan-improve/prompts/improvement-prompt.md` + `plan-confidence/defaults/loc-limits.md` (2 ocorrências) — referências a `size-allowlist.txt` (arquivo inexistente) substituídas por apontadores reais a `architecture.md § Module hygiene` e defaults
- `plan-improve/prompts/improvement-prompt.md` — refs a `architecture-contract.yaml` e `domain-boundary.md` (inexistentes) consolidadas em `architecture.md`
- `plan-improve/SKILL.md` — frontmatter `allowed-tools` ganhou `Skill` (skill instrui invocar `ralph-loop:ralph-loop` via Skill tool; sem permissão o runtime bloquearia)
- `plan-improve/SKILL.md` — description ganhou trigger phrase "Use after /plan-confidence returns a verdict below SHIPPABLE_WITH_CAVEATS"
- `discover-execute/SKILL.md` — `Agent` removido de `allowed-tools` (skill nunca spawna sub-agent; per `loop-engine-convention.md` decision matrix mapeia para ralph-loop)
- `skill-register/SKILL.md` + description do frontmatter — Step 3 reescrito honestamente: script NÃO patcha `settings.json`; validator upstream já bloqueia tools fora do allowlist
- `skill-register/scripts/register_skill.py` — ordem invertida para honrar SKILL.md "Hard rule 2" (audit é escrito ANTES do `shutil.move`; previne skill registered sem trail caso a escrita do audit falhe)
- `discover-confidence/SKILL.md` + `defaults/research-coverage.md` + `templates/rubric-blueprint.md` (3 lugares) — soft cap `soft_floor_per_project_asymmetry` marcado como "Planned for M2.1, no Python checker exists yet" (era documentado mas não enforced — drift documentação/implementação)
- `discover-improve/SKILL.md` — Phase B "Empty coverage corner → add ADR" trocada por Phase A "mark as `<!-- BLOCKED -->`" + nota explicando que auto-laundering de hard cap via ADR contradiz `discover-blueprint-golden-rule.md`

**MAJOR — scripts:**
- `skill-validator/scripts/validate_skill.py` — `ALLOWED_TOOLS_BASE` apertado para `{Read, Glob, Grep}` (era frouxo: aceitava Agent/WebFetch/WebSearch); adicionada constante explícita `FORBIDDEN_TOOLS` + check passa de denylist parcial para allowlist real (unknown tool → FAIL)
- `implement/scripts/check_wiring.py` pillar (a) — função nova `_is_definition_only()` exclui arquivos onde o símbolo aparece APENAS em linha de declaração (`function foo`, `class foo`, `def foo`, `export const foo =`, …); fechava falso positivo onde `grep -l 'foo'` reportava o arquivo de definição como caller, dando PASS trivial em código dead
- `implement/scripts/check_wiring.py` pillar (b) — marker `<!-- ADR-DEFER-WIRING-B: ... -->` agora exige `{symbol}: {reason}` no payload (não basta marker bare); previne loophole onde uma deferral cobria N pillars (b) failures silenciosamente
- `implement/scripts/run_validation.py` `check_coverage` — docstring honesta documentando que o gate só verifica exit code, não parseia thresholds (decisão honest sobre limitação de M2; SKILL.md soft gate "Coverage < 100% on critical path" é advisório até parsing de lcov/json-summary ser adicionado)

**MINOR — qualidade editorial:**
- `to-plan/SKILL.md` — exemplo `foo_service.rs` (Rust) trocado por `foo-service.ts` (TS é o idioma do projeto); `trait Foo` → `interface Foo`
- `to-plan/SKILL.md` — Step 4 explicita uso da Write tool em vez de Bash heredoc
- `plan-confidence/SKILL.md` — Hard Caps section ganhou stable identifiers inline (`coverage_lt_100`, `adr_without_alternatives`, `tdd_in_bugfix`, `fabricated_citation`) — facilita correlação com JSON output
- `discover-confidence/SKILL.md:50` — frase confusa sobre renormalização reescrita (active dimensions já somam 1.0; renormalization machinery só ativa em M3+)
- `discover-edge-cases/SKILL.md` — seção "Argumento" esclarece como o agente resolve slug/path (não é shell expansion nativo)
- `review/SKILL.md` — exemplo de `spawn_reviewers.py` corrigido: `--slug` adicionado (required), `--domain` → `--primary-domain`
- `review/SKILL.md` — claim "NEVER skips review for any changed file" suavizada para "SHOULD cover every file" + nota explicando enforcement futuro em `consolidate_findings.py`
- `review/SKILL.md` — "PASS or PARTIAL with acceptable SKIPs" qualificado para alinhar com `cycle-review.md § Trigger conditions`
- `implement/SKILL.md` HARD GATE wiring (c) — nota nova explicando que plans pre-code phase DEVEM declarar ADR-defer para pillar (c) ou omitir metric (sem isso, primeiro task com métrica trava sem caminho de remediação)

**Verificação:**
- 233 tests Python passam (plan-confidence 180, discover-confidence 19, implement 10, review 17, skill-validator 5, skill-register 2)
- Nenhum SKILL.md frontmatter quebrado (verificado spawning agents updated descriptions na lista de skills)

### Fixed — Skills review pass (2026-05-21)
- `to-plan/SKILL.md` — frontmatter completado com `user-invocable: true`, `allowed-tools: Read Glob Grep Bash Write`, `argument-hint: "{topic-slug}"` (era o único skill com frontmatter incompleto)
- `to-plan/SKILL.md` — template inline (177 linhas) extraído para `to-plan/templates/plan-template.md`; SKILL.md reduzido de 329 para 157 linhas (-52%) seguindo o padrão dos siblings (`discover-plan/templates/`, `skill-writer/templates/`)
- `plan-confidence/tests/` — 4 arquivos de testes stale removidos (`test_concepts_skeleton.py`, `test_index_and_log.py`, `test_claude_md_skill_index.py`, `test_to_plan_chain.py`) — testavam estruturas removidas (concepts/ tree, ADR-001 file, inline Step 5/6 em to-plan); suite passa de 28 fail/190 pass para 0 fail/180 pass/14 skipped
- `plan-confidence/tests/test_golden_rule.py::test_golden_rule_has_related_section_with_links` — keywords ajustados de `[SKILL.md, thresholds, ADR, sota]` para `[SKILL.md, thresholds, allowlist, defaults]` refletindo a estrutura atual da Related section (ADR + sota report não existem mais on-disk)
- `edge-case-plan/SKILL.md` — `Agent` removido de `allowed-tools` (alinhado com sibling `discover-edge-cases` que opera puramente Read/Glob/Grep/Bash)
- `plan-confidence/SKILL.md` — description expandido para alinhar com sibling `discover-confidence` (mesmo nível de detalhe e referência cross-skill)
- `ast-grep/examples/`, `discover-plan/prompts/`, `plan-improve/fixtures/` — 3 diretórios vazios removidos
- `.gitignore` — 6 regras específicas para `.theo/*/` consolidadas em uma única `**/.theo/` cobrindo todos os subdirs e arquivos (`theo.md` agora também ignorado)

### Status
- Sistema: **scaffold completo, código `src/` ainda não escrito** (pre-release per `theo-memory/CLAUDE.md`)
- Skills: 15 ativas (14 do ecosystem + 1 auxiliar)
- Cycle rules: 4 (todos v1.0)
- Outras rules: 8
- Hooks shell: 5
- Scripts Python: 58 (23 sem testes — risco documentado em revisão)
- Suíte plan-confidence: 180 pass / 0 fail / 14 skipped (sanitizada 2026-05-21)
- Pre-condition para próxima versão: tests Python coverage + smoke test E2E

### Known issues
- 23 scripts Python sem cobertura de testes (discover-confidence, implement, review, skill-validator, skill-register, discover-improve) — risco MEDIUM/HIGH
- Sistema nunca executou end-to-end (cada componente testado em isolamento) — risco de defeito de integração
- Audit trail bloat sem cleanup automático (rotation policy criada mas não automatizada)
- Token cost por feature E2E: ~360-830k tokens (documentado em token-budget.md)
