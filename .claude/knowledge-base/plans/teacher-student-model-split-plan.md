---
type: plan
created_at: 2026-05-22
slug: teacher-student-model-split
status: revised
feature_branch: feat/teacher-student-model-split
bootstrap_commit: 192cf5c
versions:
  - v1.0: initial draft
  - v1.1: absorved edge-cases-2026-05-22 (2 MUST FIX, 5 `SHOULD TEST`, 4 DOCUMENT)
---

# Plan: Teacher/Student Model Split — /review (MVP) + /implement (conditional)

> **Version 1.1** — Trazer o roteamento de modelos por **papel** (teacher/student) inspirado em `huggingface/upskill` (`src/upskill/model_resolution.py`, `ResolvedModels` dataclass) para os dois cycles mais caros do nosso ecosystem: `/review` (escopo MVP, alta ROI, baixo risco) e `/implement` (conditional, sujeito a spike de viabilidade do halt-loop). Done = (a) `spawn_reviewers.py` emite agents com `model:` resolvido por arquétipo (4 baseline → student, cross-validation → teacher), (b) rule `review-model-routing.txt` declara o mapeamento com critério de rollback, (c) `token-budget.md` reflete estimativas pós-split, (d) `/implement` ou tem split por phase via Agent tool aninhado OU ADR-DEFER documentado quando o ralph-loop boundary impede. Economia esperada: `/review` 150-250k → ~60k tokens (~70%), `/implement` (se viável) 100-300k → 60-150k tokens (~40-50%).

## Changelog v1.0 → v1.1 (2026-05-22)

Absorved from `.claude/knowledge-base/reviews/teacher-student-model-split-edge-cases-2026-05-22.md`:

- **EC-1 (MUST FIX, T1.3):** Domain role base lookup — script gera `f"domain-{X}"` mas rule usa chave base `domain`. Invariant + pseudocode adicionado em T1.3 Deep Dives.
- **EC-2 (MUST FIX, T2.1):** Spike T2.1 ganha 2 paths canonical do ralph-loop (cache + marketplace) para evitar fabricated citation cap em `discover-blueprint-golden-rule.md`.
- **EC-3 a EC-7 (`SHOULD TEST`, T1.3):** 5 RED tests adicionais — BOM, domain base lookup, CLI override vazio, malformed entry, modelo desconhecido fail-soft. Seção TDD de T1.3 vai de 5 RED tests → 10 RED tests.
- **EC-8 a EC-11 (DOCUMENT):** notas inline em T1.4 (2x), T2.1 (1x), T3.3 (1x) — sem subtasks novas.

## Context

### Estado atual — `/review` queima Opus em todos os agents

`.claude/skills/review/templates/agent-*.md` (5 templates) hardcoded com `model: opus` no frontmatter:

| Template | Modelo atual | Papel | Justificativa atual |
|---|---|---|---|
| `agent-architecture-reviewer.md` | `opus` | Executor de checklist SOLID/DIP | Padrão repetitivo — student basta |
| `agent-test-reviewer.md` | `opus` | Executor de checklist AAA/pyramid | Padrão repetitivo — student basta |
| `agent-wiring-reviewer.md` | `opus` | Executor de triad checklist | Padrão repetitivo — student basta |
| `agent-domain-reviewer.md` | `opus` | Executor de patterns domain | Padrão repetitivo — student basta |
| `agent-cross-validation-reviewer.md` | `opus` | Auditor semantic plan-vs-code | Raciocínio cross-cutting — teacher justificado |

`scripts/spawn_reviewers.py` (171 LoC) faz substituição simples de `{KEY}` markers (`{SLUG}`, `{PLAN_PATH}`, `{DIFF_BASE}`, `{DOMAIN}`, etc.). Não há variável `{MODEL}` nem lookup de modelo por arquétipo. Token-budget para `/review`: **150-250k tokens por invocação** (`.claude/rules/token-budget.md`).

### Estado atual — `/implement` ralph-loop sem subagent boundary

`.claude/skills/implement/SKILL.md § Workflow Step 4`: `/implement` invoca `ralph-loop:ralph-loop`. Cada iteração executa 5 phases (RED → GREEN → REFACTOR → WIRING → COMMIT) no **modelo da sessão atual**. Token-budget: **100-300k tokens por invocação**. `.claude/rules/loop-engine-convention.md § The three loop mechanisms` documenta que ralph-loop é state-external mas não cobre como mudar modelo entre iterações. **Bloqueador a investigar:** Agent tool aninhado dentro do ralph-loop é viável? OU precisa restart de sessão por phase?

### Evidência externa — `huggingface/upskill` v2 (2026-05-22)

Inspeção dos seguintes arquivos:

- `huggingface/upskill src/upskill/model_resolution.py`: `ResolvedModels` (frozen dataclass) com 4 campos (`skill_generation_model`, `test_generation_model`, `evaluation_models: list`, `extra_eval_model`) + 2 flags (`is_benchmark_mode`, `run_baseline`). `resolve_models(command, config, cli_*)` tem ramos por comando com fallback chain `cli > config > default`.
- `huggingface/upskill src/upskill/config.py`: `Config.effective_eval_model` property — `self.eval_model or self.skill_generation_model`. Fallback explícito.
- `huggingface/upskill upskill.config.yaml`: config declarativa de papéis (`skill_generation_model: sonnet`, `test_gen_model: opus`, `eval_model: sonnet`).
- `huggingface/upskill src/upskill/model_resolution.py:build_fastagent_model_references`: projeta papéis em "card slots" do FastAgent (`{"system": {"default": ..., "skill_gen": ..., "test_gen": ...}}`). Mesmo agent harness, modelos diferentes por papel.

**Insight central importado:** roteamento por **papel**, não por phase nem por código. Tarefa de alta criatividade + baixa frequência = TEACHER (Opus). Tarefa de alta frequência + execução padronizada = STUDENT (Haiku/Sonnet).

### Risco transversal — Quality regression silenciosa

Trocar Opus → Haiku sem A/B baseline controlado pode degradar qualidade dos findings/ações. A técnica "A/B baseline vs with-skill" do upskill (`evaluate.py:_iter_evaluation_phases`) **NÃO entra neste plan** — vira plan separado como pré-requisito futuro de `/implement` split. Para mitigar nesta entrega: cada migração de modelo na rule `review-model-routing.txt` carrega marcador `experimental_until: YYYY-MM-DD` + critério de rollback explícito.

## Objective

Done = todas as 5 condições satisfeitas:

1. `scripts/spawn_reviewers.py` resolve modelo por arquétipo via rule declarativa, com fallback `cli > rule > default opus` e marcador experimental.
2. 5 templates ganham placeholder `{MODEL}`; após substituição, arquétipos baseline emitem `model: haiku` (ou sonnet conforme rule), cross-validation emite `model: opus`.
3. Rule `.claude/rules/review-model-routing.txt` declara mapeamento role → model + critério de rollback observável.
4. `.claude/rules/token-budget.md` atualizado com estimativa pós-split de `/review` (target ~60k).
5. `/implement` ou tem T2.2-A implementado (split por phase via Agent tool aninhado, validado por dry-run) OU T2.2-B (ADR-DEFER explícito em `cycle-implement.md` com critério futuro de reabertura).

Critérios mensuráveis:

- `pytest .claude/skills/review/tests/` 100% verde, com testes novos verificando `model: <value>` em frontmatter substituído (TDD obrigatório — Inquebrável Rule 5).
- Dry-run `python3 .claude/skills/review/scripts/spawn_reviewers.py --plan {sample} --slug test --primary-domain x --output-dir /tmp/x` mostra 5 arquivos com modelos esperados.
- Re-leitura de `token-budget.md` reflete tabela atualizada.

## ADRs

### D1 — Roteamento por papel (arquétipo) vs por modelo único

- **Decisão:** Mapear modelo por **papel/arquétipo do agent** (architecture/tests/wiring/domain → student; cross-validation → teacher). Não por phase do pipeline.
- **Rationale:** Alternativas consideradas:
  - (a) **Modelo único Opus para todos** (status quo) — rejeitado: custo desnecessário para tarefas de checklist; upskill's `ResolvedModels` mostra que separação por papel é a abstração certa.
  - (b) **Modelo por phase (RED/GREEN/REFACTOR)** — rejeitado para `/review` (não tem phases); aplicável a `/implement`, mas é uma decisão separada (T2.x).
  - (c) **Modelo por usuário/contexto runtime** — rejeitado: scope creep; precisaria machinery de feature flags; YAGNI.
  - Escolhido (a-alt): papel/arquétipo, alinhado com upskill `model_resolution.py:ResolvedModels` que separa por `skill_generation_model` / `test_generation_model` / `evaluation_models`. Princípio: SRP — cada agent é UMA responsabilidade, modelo segue a responsabilidade.
- **Consequências:** Mapping declarado em rule file; troca de modelo não exige refactor de script. SOLID (SRP+DIP) respeitado: scripts dependem do contrato da rule, não de modelos concretos.

### D2 — Config declarativa em rule file vs env var ou hardcoded

- **Decisão:** Mapeamento role → model vive em `.claude/rules/review-model-routing.txt` (novo arquivo de regra de projeto), formato chave-valor com comentários.
- **Rationale:** Alternativas:
  - (a) **Env var `REVIEW_MODEL_<ROLE>`** — rejeitado: difícil auditar histórico via git; mistura runtime config com decisão arquitetural.
  - (b) **Hardcoded em `spawn_reviewers.py`** — rejeitado: viola DIP (script alto nível dependendo de detalhes de baixo nível); cada troca exige edit + commit + review do script.
  - (c) **YAML em `templates/`** — rejeitado: templates ficam misturados com config; complexidade extra para parsing YAML em Python.
  - Escolhido: rule `.claude/rules/review-model-routing.txt` (texto simples, lookup determinístico, gitable). Cita Inquebrável Rule 6 (changelog) — toda mudança de modelo gera entrada `Changed`.
- **Consequências:** Toda alteração de modelo é uma PR sobre o rule file, com diff legível. `spawn_reviewers.py` faz `read + parse` simples; sem dependência de PyYAML extra. KISS preservado.

### D3 — Marcador experimental + critério de rollback observável

- **Decisão:** Cada entry da rule `review-model-routing.txt` carrega `experimental_until: YYYY-MM-DD` + `rollback_if: <observable_criterion>` (ex: `rollback_if: review-findings BLOCKER count > 2 across 5 runs`).
- **Rationale:** Sem A/B baseline (deferido), corremos risco de regressão silenciosa Opus→Haiku. Alternativas:
  - (a) **Sem marcador** — rejeitado: viola Inquebrável Rule 3 (extreme honesty) — não temos prova que Haiku entrega qualidade equivalente.
  - (b) **A/B baseline embutido** — rejeitado: vira plan separado; aqui é over-scope (DRY de plans — não duplicar esforço de outro plan).
  - Escolhido: marcador inline na rule + critério observável. Quando expira o `experimental_until` sem critério violado, a mesma PR remove o marcador OU revoga o split.
- **Consequências:** Rollback é uma edit no rule file, não refactor de código. Plan futuro de A/B baseline tem checkpoint claro para validar quantitativamente.

### D4 — `/implement` halt-loop split: estratégia depende de spike T2.1

- **Decisão:** Não decidir AGORA a estratégia de split para `/implement`. Spike T2.1 investiga viabilidade de Agent tool aninhado dentro de `ralph-loop:ralph-loop`; baseado no resultado, T2.2 vira A (implementar) OU B (ADR-DEFER).
- **Rationale:** Alternativas:
  - (a) **Assumir Agent aninhado funciona** — rejeitado: viola Regra de Confiança de 95%; nenhum precedente conhecido no nosso codebase.
  - (b) **Assumir restart de sessão é necessário** — rejeitado: pessimista demais; pode haver path via `Skill` tool composition com modelo declarado.
  - (c) **Pular completamente `/implement`** — rejeitado: usuário escolheu escopo #1+#2 explicitamente.
  - Escolhido: spike pequeno (T2.1) com decisão binária no fim. Honesty discipline (Inquebrável Rule 3) — não cravar approach sem evidência.
- **Consequências:** Plan tem ramificação condicional em Phase 2. Aceita-se que outcome B (ADR-DEFER) seja sucesso legítimo do plan, não falha — alinhado com `cycle-implement.md § Stop conditions`.

### D5 — A/B baseline vs with-skill DEFERIDO a plan separado

- **Decisão:** Não incluir A/B baseline (técnica do `huggingface/upskill evaluate.py:_iter_evaluation_phases`) neste plan. Vira plan dedicado, pré-requisito de qualquer expansão futura do split.
- **Rationale:** Alternativas:
  - (a) **Incluir A/B aqui** — rejeitado: dobra escopo; A/B precisa de runtime de eval que TheMemory ainda não tem (pre-code phase).
  - (b) **Nunca implementar A/B** — rejeitado: D3 deixa a porta aberta; sem A/B, não temos prova quantitativa do split.
  - Escolhido: deferir, com marcador `experimental_until` (D3) servindo de "stand-in" qualitativo até A/B chegar.
- **Consequências:** Plan permanece tratável. Critério de rollback (D3) opera de forma observable mesmo sem A/B.

## Dependency Graph

```
Phase 0 (Bootstrap) ──▶ Phase 1 (/review split) ──▶ Phase 3 (Integration Validation)
                  │                              ▲
                  │                              │
                  └─▶ Phase 2 (/implement spike+split) ──┘
                       T2.1 spike ──▶ T2.2-A OR T2.2-B
```

- Phase 0 é trivial (gate-check). Phase 1 e Phase 2 podem rodar em paralelo APÓS Phase 0; ambas bloqueiam Phase 3.
- Dentro de Phase 1: T1.1 (TDD RED) → T1.2 (templates) → T1.3 (script) → T1.4 (rule) → T1.5 (token-budget). T1.3 depende de T1.1 (tests existem antes do código).
- Dentro de Phase 2: T2.1 (spike) → T2.2 (A ou B). Decisão binária no fim de T2.1.

---

## Phase 0: Bootstrap

**Objective:** Validar pré-condições e gravar o branch state para auditoria.

### T0.1 — Pre-condition validation

#### Objective
Confirmar que estamos em feature branch correta, working tree clean (exceto este plan), e que tooling (pytest) está acessível.

#### Evidence
`feat/teacher-student-model-split` criada via `git switch -c` em 2026-05-22, commit bootstrap `192cf5c`. Hook `validate-command.sh` ativo (validado quando bloqueou commit anterior em main).

#### Files to edit
```
(nenhum — apenas verificação)
```

#### Deep file dependency analysis
N/A — task de gate.

#### Tasks
1. `git branch --show-current` → deve retornar `feat/teacher-student-model-split`.
2. `git status --porcelain` → apenas o plan recém-criado.
3. `python3 -m pytest --version` → versão presente.
4. `python3 .claude/skills/review/scripts/spawn_reviewers.py --help` → script executa sem traceback.

#### Acceptance Criteria
- [ ] Em feature branch (NÃO em `main`) — Inquebrável Rule 4.
- [ ] Working tree limpa exceto pelo plan.
- [ ] Pytest acessível.
- [ ] Script `spawn_reviewers.py` executável.

#### DoD
- [ ] Saída dos 4 comandos acima registrada na PR description ao final do cycle.

---

## Phase 1: `/review` agent model split (MVP)

**Objective:** Refatorar `/review` para emitir agents com modelo resolvido por arquétipo via rule declarativa, com TDD obrigatório.

### T1.1 — TDD RED: tests para frontmatter `model:` substituído

#### Objective
Escrever testes que falhem **antes** de qualquer mudança em `spawn_reviewers.py` ou templates, validando que após substituição o frontmatter `model:` reflete o arquétipo correto.

#### Evidence
`tests/test_spawn_reviewers.py` atual (76 LoC, inspecionado) cobre baseline count, file write, secondary domains, findings dir — mas **não** verifica frontmatter `model:`. Sem TDD RED first, qualquer mudança em script viola Inquebrável Rule 5 e `testing.md § Core rule — TDD + BDD são obrigatórios`.

#### Files to edit
```
.claude/skills/review/tests/test_spawn_reviewers.py — adicionar testes (RED)
.claude/skills/review/tests/conftest.py — adicionar fixture sample_routing_rule se necessário
```

#### Deep file dependency analysis
- `test_spawn_reviewers.py` (existing): chama `spawn_reviewers.py` via `subprocess` com `--skill-dir` override; verifica `data["agents_count"]`, `path.exists()`, substituição de `{SLUG}`. Mudança aqui é **aditiva**: novos testes não quebram os existentes.
- `conftest.py`: provê fixture `sample_plan`. Novo fixture `sample_routing_rule` (tmp_path) será criado para isolar testes (cada um escreve sua rule temporária).
- Downstream: nenhum arquivo depende destes tests; são folhas no DAG.

#### Deep Dives

**Tests a escrever (TDD RED — todos DEVEM falhar antes de T1.2/T1.3):**

1. `test_baseline_agents_get_student_model` — após spawn, os 4 agents baseline (architecture/tests/wiring/domain) têm `model: haiku` (ou valor de rule) no frontmatter substituído.
2. `test_cross_validation_gets_teacher_model` — agent cross-validation tem `model: opus` no frontmatter.
3. `test_routing_rule_fallback_default` — quando rule file ausente, todos os agents default para `model: opus` (fallback safety — preserva comportamento atual).
4. `test_cli_model_override` — flag `--model-override architecture=sonnet` (a definir em T1.3) sobrescreve o valor da rule para esse arquétipo.
5. `test_experimental_marker_preserved` — quando rule declara `experimental_until`, output JSON do script inclui campo `experimental_routings: [...]` listando os arquétipos marcados.

**Invariants:**
- Nenhum teste depende de modelo "real" (haiku/opus/sonnet) — apenas valores string substituídos.
- Nenhum teste chama API LLM (Inquebrável: testing.md § Determinism).

**Edge cases:**
- Rule file malformado (linha inválida) → exit code não-zero, mensagem em stderr.
- Rule file vazio → fallback para default opus (preservação backward-compat).
- Arquétipo não listado na rule → fallback default opus (não fail).

#### Tasks
1. Adicionar 5 funções `test_*` em `test_spawn_reviewers.py`.
2. Estender fixture em `conftest.py` para criar rule file temporária.
3. Rodar `pytest .claude/skills/review/tests/test_spawn_reviewers.py -v` → esperado **FAIL** nos 5 novos testes.

#### TDD

10 RED tests (5 base + 5 absorbed from edge-cases-2026-05-22 `SHOULD TEST`):

```
RED:     test_baseline_agents_get_student_model() — asserta model: haiku em 4 agents
RED:     test_cross_validation_gets_teacher_model() — asserta model: opus em 1 agent
RED:     test_routing_rule_fallback_default() — sem rule file, todos viram opus
RED:     test_cli_model_override() — flag CLI sobrescreve rule
RED:     test_experimental_marker_preserved() — campo experimental_routings no JSON

# Absorved v1.1 (`SHOULD TEST`):
RED:     test_routing_rule_with_utf8_bom_parsed_correctly()         — EC-3: rule file com BOM (\xef\xbb\xbf) ainda parseia entry da 1ª linha
RED:     test_domain_secondary_resolves_via_base_lookup()           — EC-4 + EC-1: domain-X, domain-Y, domain-Z resolvem via key base 'domain'
RED:     test_cli_override_with_empty_value_rejected()              — EC-5: --model-override architecture= retorna exit code != 0
RED:     test_routing_rule_malformed_line_silently_skipped()        — EC-6: linha sem ':' descartada; linhas válidas restantes funcionam
RED:     test_routing_rule_unknown_model_passes_through()           — EC-7: rule com modelo inexistente vira literal no frontmatter (fail-soft passthrough)

GREEN:   (deferido a T1.2 + T1.3)
REFACTOR: None expected nesta task
VERIFY:  pytest .claude/skills/review/tests/test_spawn_reviewers.py -v   (10 novos RED)
```

#### Acceptance Criteria
- [ ] 10 novos testes adicionados (5 core + 5 `SHOULD TEST` de v1.1), todos falham com mensagens claras (não traceback de import error).
- [ ] Testes existentes (`test_baseline_4_agents_generated`, etc.) continuam passando.
- [ ] Pass: lint — `python3 -m py_compile .claude/skills/review/tests/test_spawn_reviewers.py` zero erros.
- [ ] Pass: complexity — cada test ≤ 15 LoC.
- [ ] Pass: size — `test_spawn_reviewers.py` ≤ 300 LoC (limite ampliado vs v1.0 por adição dos 5 `SHOULD TEST`; `loc-limits.md` default 500).

#### DoD
- [ ] `pytest -v` confirma 10 novos failures + N existing passes.
- [ ] Commit `test(review): add RED tests for model frontmatter routing` (referencia T1.1; cobre 5 core + 5 EC `SHOULD TEST`).

### T1.2 — Adicionar placeholder `{MODEL}` aos 5 templates

#### Objective
Substituir `model: opus` hardcoded por `model: {MODEL}` nos 5 templates, mantendo backward-compat (substituição falhar → fallback explícito).

#### Evidence
Leitura de `.claude/skills/review/templates/agent-architecture-reviewer.md:5` (e similares nos outros 4) mostra `model: opus` literal. Estado validado pelo Read do template em phase de discovery.

#### Files to edit
```
.claude/skills/review/templates/agent-architecture-reviewer.md     — linha 5: model: opus → model: {MODEL}
.claude/skills/review/templates/agent-test-reviewer.md             — linha 5: idem
.claude/skills/review/templates/agent-wiring-reviewer.md           — linha 5: idem
.claude/skills/review/templates/agent-domain-reviewer.md           — linha 5: idem
.claude/skills/review/templates/agent-cross-validation-reviewer.md — linha 5: idem
```

#### Deep file dependency analysis
- 5 templates: edit local linha 5. Nenhum import / parse externo depende dessa linha específica além de `spawn_reviewers.py:substitute()`.
- `spawn_reviewers.py:substitute()` (l.51-56): faz `result.replace("{" + key + "}", value)`. Já genérico. Novo marker `{MODEL}` será resolvido em T1.3.
- Downstream: agents gerados pelo Agent tool consomem o frontmatter — se `{MODEL}` não for substituído, Agent tool recebe string literal `{MODEL}` (falha). T1.3 garante substituição.

#### Deep Dives

**Substituição mínima por template:**
```diff
- model: opus
+ model: {MODEL}
```

**Anti-pattern a evitar:** múltiplos placeholders no mesmo template (ex: `model: {MODEL} # was: {DEFAULT_MODEL}`). Mantém um placeholder por linha.

**Edge cases:**
- Templates legados em `_archive/` — NÃO tocar (audit trail por `audit-trail-rotation.md`).
- Se um template novo for adicionado no futuro, autor DEVE incluir `{MODEL}` ou explicit `model: opus` se quer pin manual.

#### Tasks
1. `Edit` cada um dos 5 templates substituindo `model: opus` por `model: {MODEL}` (replace_all=false; old_string único na linha).

#### TDD
```
RED:     (já cobertos por T1.1 — tests vão começar a falhar diferente: agora vão ver `{MODEL}` literal)
GREEN:   (esta task NÃO faz GREEN ainda — só prepara o terreno; T1.3 fecha o GREEN)
REFACTOR: None expected
VERIFY:  pytest .claude/skills/review/tests/test_spawn_reviewers.py -v   (5 falhas com nova mensagem)
```

#### Acceptance Criteria
- [ ] 5 templates contêm `model: {MODEL}` na linha 5 (verificável via `grep '^model:' .claude/skills/review/templates/agent-*.md`).
- [ ] Nenhum template mantém `model: opus` literal.
- [ ] Pass: size — cada template inalterado em LoC ± 1.
- [ ] Tests de T1.1 continuam RED (agora com mensagem "literal {MODEL} not substituted").

#### DoD
- [ ] `grep -L 'model: {MODEL}' .claude/skills/review/templates/agent-*.md` retorna vazio (todos contêm).
- [ ] Commit `refactor(review): introduce {MODEL} placeholder in agent templates` (referencia T1.2).

### T1.3 — Implementar resolução de modelo em `spawn_reviewers.py`

#### Objective
Estender `spawn_reviewers.py` para: (a) ler `.claude/rules/review-model-routing.txt`, (b) resolver modelo por arquétipo com fallback chain `cli > rule > default opus`, (c) substituir `{MODEL}` no mapping antes de chamar `substitute()`, (d) expor flag `--model-override role=model` para CLI, (e) emitir `experimental_routings` no JSON de saída.

#### Evidence
`spawn_reviewers.py` atual (171 LoC, lido) tem estrutura clara: `TEMPLATES` dict, `BASELINE_ROLES` lista, `main()` parsa args, monta `base_mapping`, loop por role. Adição é localizável — não exige refactor estrutural. `huggingface/upskill src/upskill/model_resolution.py` (`resolve_models` function) é a referência canônica do shape.

#### Files to edit
```
.claude/skills/review/scripts/spawn_reviewers.py — adicionar lookup de modelo + flag CLI + experimental tracking
```

#### Deep file dependency analysis
- `spawn_reviewers.py` (171 LoC atual; pós-task estimado ~250 LoC ainda < 500 budget de `loc-limits.md`):
  - Novo helper `_load_routing_rule(path: Path) -> dict[str, dict]` — parser linha-a-linha do txt.
  - Novo helper `_resolve_model(role: str, rule: dict, overrides: dict) -> tuple[str, bool]` — retorna (model, is_experimental).
  - Modificação em `main()`: parsear `--model-override`, carregar rule, popular mapping com `MODEL` por role.
  - Modificação em loop baseline (l.117-126) e domain (l.135-145): mapping ganha `MODEL` antes de `write_agent_file`.
  - Modificação em `output` dict: novo campo `experimental_routings: list[str]`.
- Downstream: testes de T1.1 viram GREEN. Nada mais depende.

#### Deep Dives

**Formato da rule `.claude/rules/review-model-routing.txt` (lido por T1.4, mas spec aqui):**

```
# review-model-routing — mapeamento role → model
# Generated 2026-05-22 — Plan teacher-student-model-split
# Format: <role>: <model> [experimental_until=YYYY-MM-DD] [rollback_if=<criterion>]
architecture: haiku experimental_until=2026-06-22 rollback_if=blocker_findings_gt_2_per_5_runs
tests: haiku experimental_until=2026-06-22 rollback_if=blocker_findings_gt_2_per_5_runs
wiring: haiku experimental_until=2026-06-22 rollback_if=blocker_findings_gt_2_per_5_runs
domain: haiku experimental_until=2026-06-22 rollback_if=blocker_findings_gt_2_per_5_runs
cross-validation: opus
# default fallback: opus (when role not listed OR rule missing)
```

**Parser (deterministic, stdlib-only — D2 KISS):**

```python
def _load_routing_rule(path: Path) -> dict[str, dict[str, str]]:
    """Parse review-model-routing.txt → {role: {"model": ..., "experimental_until": ..., "rollback_if": ...}}.

    Returns empty dict if file missing OR malformed. Caller decides fallback policy.
    """
    if not path.exists():
        return {}
    parsed: dict[str, dict[str, str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        role, rest = line.split(":", 1)
        role = role.strip()
        tokens = rest.strip().split()
        if not tokens:
            continue
        entry = {"model": tokens[0]}
        for token in tokens[1:]:
            if "=" in token:
                k, v = token.split("=", 1)
                entry[k] = v
        parsed[role] = entry
    return parsed
```

**Fallback chain (`_resolve_model`):**

```python
def _resolve_model(role: str, rule: dict, overrides: dict[str, str], default: str = "opus") -> tuple[str, bool]:
    """Resolve model for a role: cli override > rule > default. Returns (model, is_experimental).

    Domain role normalization (EC-1, absorved v1.1): script generates role as
    f"domain-{NAME}" but rule entries use the base key 'domain'. Normalize before lookup.
    Without this normalization, domain agents silently fall back to default opus,
    nullifying ~40% of expected token savings.
    """
    # EC-1 invariant: role keys with "domain-" prefix collapse to base "domain" for rule lookup.
    # Direct overrides + direct rule entries still take precedence (specific > base).
    lookup_key = role
    if role.startswith("domain-") and role not in overrides and role not in rule:
        lookup_key = "domain"

    if lookup_key in overrides:
        return overrides[lookup_key], False
    if lookup_key in rule:
        entry = rule[lookup_key]
        is_experimental = "experimental_until" in entry
        return entry["model"], is_experimental
    return default, False
```

**Invariant (EC-1):** Any role string matching pattern `^domain-.+$` SHALL resolve via the base `domain` key when no exact match exists in overrides or rule. Test `test_domain_secondary_resolves_via_base_lookup` (EC-4) is the regression guard.

**CLI flag spec:**

```
--model-override architecture=sonnet --model-override tests=haiku
```

Acumula em dict via `argparse.Action` custom. Override é **plan-time/operator-time**, sobrescreve rule para esta invocação.

**Invariants:**
- Substituição `{MODEL}` SEMPRE produz string não-vazia (default opus garante).
- Quando rule ausente, comportamento é equivalente ao atual (todos opus) — backward-compat preservado.
- `experimental_routings` no JSON é informativo, não bloqueia execução.

**Edge cases:**
- Domain agent: role no mapping é `"domain"` (não `"domain-{NOME}"`). Lookup usa string base `domain`.
- Múltiplos secondary domains: cada um pega o mesmo modelo (do role `domain`); não há per-domain override (YAGNI — adicionar se evidência justificar).
- Rule file com linha tipo `architecture haiku` (sem `:`) — descartada silenciosamente (parser robusto, fail-soft em dados não-críticos).

#### Tasks
1. Adicionar `_load_routing_rule()`, `_resolve_model()`, custom argparse action para `--model-override`.
2. Carregar rule em `main()` via path `.claude/rules/review-model-routing.txt` (resolvido relativo a `skill_dir.parent.parent`).
3. Adicionar parâmetro `--routing-rule` (default: resolved path) para overridable em testes.
4. Mapping de cada role ganha `"MODEL"` antes de `write_agent_file`.
5. Output JSON ganha `experimental_routings: [role1, role2, ...]`.
6. Rodar testes — esperado GREEN nos 5 de T1.1.

#### TDD
```
RED:     (já existentes de T1.1, atualmente FAIL)
GREEN:   Implementar lookup + substituição → 5 testes de T1.1 viram PASS
REFACTOR: Garantir que `_load_routing_rule` e `_resolve_model` são funções puras testáveis isoladamente
VERIFY:  pytest .claude/skills/review/tests/test_spawn_reviewers.py -v   (todos verdes)
```

#### Acceptance Criteria
- [ ] 5 testes de T1.1 passam.
- [ ] Testes existentes (4) continuam passando.
- [ ] `spawn_reviewers.py` ≤ 300 LoC (margem confortável < 500 budget).
- [ ] Pass: complexity — funções novas cyclomatic ≤ 10 (manual audit — sem switch profundo).
- [ ] Pass: lint — `python3 -m py_compile` zero erros; `ruff check` se disponível.
- [ ] Dry-run manual: `python3 .claude/skills/review/scripts/spawn_reviewers.py --plan <sample> --slug demo --primary-domain x --output-dir /tmp/demo` produz 5 arquivos com modelos esperados.

#### DoD
- [ ] 9 testes verdes (`pytest -v`).
- [ ] Dry-run validation registrada em comment do commit.
- [ ] Commit `feat(review): resolve agent model per role via routing rule` (referencia T1.3).

### T1.4 — Criar rule `.claude/rules/review-model-routing.txt` + xref em `cycle-review.md`

#### Objective
Criar o arquivo de rule consumido por T1.3 e adicionar cross-reference em `.claude/rules/cycle-review.md` para que humanos descubram o split ao ler o contrato do cycle.

#### Evidence
D2 escolheu rule file declarativa. T1.3 lê o arquivo. Sem T1.4, T1.3 funciona via fallback (todos opus), mas o split fica inexistente em produção.

#### Files to edit
```
.claude/rules/review-model-routing.txt — NEW
.claude/rules/cycle-review.md — adicionar seção "Model routing" + xref
.claude/rules/token-budget.md — pequeno breadcrumb apontando para review-model-routing.txt (full update em T1.5)
```

#### Deep file dependency analysis
- `review-model-routing.txt` (NEW): consumido por `spawn_reviewers.py` em T1.3. Formato spec'd em T1.3 Deep Dives.
- `cycle-review.md` (existing, 207 LoC): seção nova "Model routing" entre `## Phase contracts` e `## Hard gates`. Adições de cross-reference em `## Cross-references` ao final.
- `token-budget.md` (existing): apenas breadcrumb; full update em T1.5.

#### Deep Dives

**Conteúdo de `review-model-routing.txt`:** ver T1.3 Deep Dives. Spec literal.

**Notas inline absorvidas v1.1 (DOCUMENT):**

- **EC-8 (`experimental_until` no passado):** parser NÃO valida data automaticamente. Validação é responsabilidade do reviewer humano antes de cada release. Sem auto-expiração — rollback é decisão observable baseada em `rollback_if` criterion (D3), não na data calendar. Adicionar comment-line no header do rule file: `# experimental_until is informational only — review manually before each release; no auto-expiration`.
- **EC-9 (opus + experimental semantic odor):** `cross-validation: opus experimental_until=...` é semanticamente confuso (opus é status quo, não experimental). Parser aceita silenciosamente. Adicionar comment-line no rule template: `# experimental_until only makes sense paired with a non-default model (opus is the safe fallback, not experimental)`.

**Seção nova em `cycle-review.md`:**

```markdown
## Model routing (teacher/student split)

Source of truth for which model each review agent runs on: `.claude/rules/review-model-routing.txt`.

- Baseline arquétipos (architecture, tests, wiring, domain) — student (default haiku) — checklist-shape execution.
- Cross-validation arquétipo — teacher (opus) — cross-cutting raciocínio plan-vs-code.
- Rule file lookup is fail-soft: missing OR malformed → fallback all-opus (status quo preserved).
- Each non-default entry carries `experimental_until: YYYY-MM-DD` + `rollback_if: <criterion>` (no silent regressions — D3 of teacher-student-model-split plan).
```

**Backward-compat note:**
- Removendo `.claude/rules/review-model-routing.txt` em qualquer momento → `/review` volta a usar Opus em todos os agents. Rollback completo é 1 `git rm`.

#### Tasks
1. `Write` `.claude/rules/review-model-routing.txt` com conteúdo spec.
2. `Edit` `.claude/rules/cycle-review.md` adicionando seção "Model routing".
3. `Edit` `.claude/rules/token-budget.md` adicionando 1-linha breadcrumb apontando para a rule (full update em T1.5).

#### TDD
```
RED:     N/A (mudança de doc/rule, não de código executável)
GREEN:   N/A
REFACTOR: None expected
VERIFY:  cat .claude/rules/review-model-routing.txt | grep -c '^[a-z]' ≥ 5  (5 roles listados)
         grep -l 'review-model-routing' .claude/rules/*.md  (xref presente)
```

#### Acceptance Criteria
- [ ] `review-model-routing.txt` existe e parse OK pelo `_load_routing_rule()` de T1.3.
- [ ] `cycle-review.md` tem seção "Model routing" entre Phase contracts e Hard gates.
- [ ] `token-budget.md` referencia a nova rule (breadcrumb).
- [ ] Pass: rule lookup — rodar `spawn_reviewers.py` produz 4 haiku + 1 opus em frontmatter.

#### DoD
- [ ] Rule file commitado.
- [ ] Cross-reference visível em `cycle-review.md` e `token-budget.md`.
- [ ] Commit `docs(rules): add review-model-routing rule + cross-references` (referencia T1.4).

### T1.5 — Atualizar `token-budget.md` com estimativas pós-split

#### Objective
Refletir economia esperada de `/review` na tabela do `token-budget.md`, com link explícito para a rule. Inserir nota sobre estado do `/implement` (depende de Phase 2).

#### Evidence
`.claude/rules/token-budget.md § cycle-review skills` declara: `/review | 150-250k | Spawns 5-7 specialized agents in parallel; each agent does deep review (30-50k each)`. Com 4 agents virando haiku (~1/10 do custo), nova estimativa: ~60k.

#### Files to edit
```
.claude/rules/token-budget.md — atualizar tabela cycle-review (e cycle-implement se Phase 2 entregar T2.2-A)
```

#### Deep file dependency analysis
- `token-budget.md` (existing, ~200 LoC): atualização de 1-2 entradas de tabela + nota explicativa. Não toca workflows existentes.
- Downstream: consumido por humanos lendo o repo + cited em PR descriptions.

#### Deep Dives

**Diff conceitual da tabela:**

```diff
 ### `cycle-review` skill

 | Skill | Typical cost | Notes |
 |---|---|---|
-| `/review` | **150-250k** | Spawns 5-7 specialized agents in parallel; each agent does deep review (30-50k each) |
+| `/review` | **~60k (split) / 150-250k (fallback)** | Spawns 5-7 agents; 4 baseline → haiku (~5k each), 1 cross-validation → opus (~40k). Falls back to all-opus if `.claude/rules/review-model-routing.txt` missing (status quo). See `review-model-routing.txt` for split config + rollback criteria. |
-| **Full cycle** | **150-250k** | Most expensive single cycle by design |
+| **Full cycle** | **~60k (split) / 150-250k (fallback)** | Split mode: ~70% reduction vs all-opus baseline (D3 of plan teacher-student-model-split). |
```

**Nota nova em `## When NOT to use these cycles`:**
```diff
+| `cycle-review` split mode | Critical security review of high-blast-radius diff | Override routing via `--model-override architecture=opus,domain=opus` to escalate baseline agents to teacher |
```

**Phase 2 contingency:**
- Se T2.2-A entrega → adicionar update similar para `/implement`.
- Se T2.2-B (ADR-DEFER) → adicionar 1 linha sob `/implement`: `Split deferred — see .claude/rules/cycle-implement.md § ADR-DEFER teacher-student-split for criteria`.

#### Tasks
1. Editar tabela de `cycle-review` em `token-budget.md`.
2. Adicionar nota de override em "When NOT to use".
3. Adicionar nota de `/implement` baseada no outcome de Phase 2 (depois de Phase 2 concluir).

#### TDD
```
RED:     N/A (doc-only)
GREEN:   N/A
REFACTOR: None
VERIFY:  grep -c 'review-model-routing' .claude/rules/token-budget.md ≥ 1
```

#### Acceptance Criteria
- [ ] Tabela cycle-review reflete `~60k (split) / 150-250k (fallback)`.
- [ ] Note "When NOT to use" lista escalation override.
- [ ] Pass: link integrity — referência a `review-model-routing.txt` resolve.

#### DoD
- [ ] Commit `docs(rules): update token-budget for /review teacher-student split` (referencia T1.5).

---

## Phase 2: `/implement` halt-loop investigation + (conditional) split

**Objective:** Investigar viabilidade de model split dentro do ralph-loop e ou implementar OU documentar ADR-DEFER explícito.

### T2.1 — Spike: viabilidade de Agent tool aninhado em ralph-loop

#### Objective
Determinar via investigação read-only se é possível invocar `Agent` tool com modelo distinto **dentro** de uma iteração do `ralph-loop:ralph-loop`, sem violar `loop-engine-convention.md`.

#### Evidence
`.claude/skills/implement/SKILL.md § Workflow Step 4` invoca `ralph-loop:ralph-loop` via `Skill` tool. `loop-engine-convention.md § The three loop mechanisms` documenta os 3 mecanismos mas não combina-os. Sem este spike, T2.2 é especulativo (viola Regra de Confiança de 95%).

#### Files to edit
```
.claude/knowledge-base/discoveries/blueprints/teacher-student-halt-loop-spike.md — NEW (relatório do spike)
```

#### Deep file dependency analysis
- Spike é **read-only investigation**. Outputs apenas um blueprint short-form documentando achados.
- Não modifica `/implement` nem `ralph-loop`.

#### Deep Dives

**Investigação a fazer:**

1. Ler código-fonte do plugin `ralph-loop` em DOIS paths canonical (EC-2, absorved v1.1 — evita citação fabricada):
   - **Cache (executed version):** `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/commands/ralph-loop.md` + `1.0.0/scripts/setup-ralph-loop.sh`
   - **Marketplace (source-of-truth):** `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/commands/ralph-loop.md` + `plugins/ralph-loop/scripts/setup-ralph-loop.sh`
   - Verificar drift entre os dois (se diferentes, marketplace ganha — é source-of-truth).
   - Blueprint DEVE citar caminho + linha de cada achado (compliance com `discover-blueprint-golden-rule.md` § hard cap fabricated_citation).
2. Identificar como ralph-loop instancia cada iteração — herda contexto do parent? Subprocesso? Mesmo session?
3. Testar invocação Skill tool de Agent dentro de ralph-loop em sandbox (não nesta branch — em scratch dir).
4. Verificar `loop-engine-convention.md § When in doubt, ask these 4 questions` — re-aplicar com cenário "model split por phase".

**Nota inline absorvida v1.1 (DOCUMENT EC-10):** Spike grava blueprint em `.claude/knowledge-base/discoveries/blueprints/`, dir reservado para outputs de `/discover-execute` validados por `/discover-confidence`. Spike de cycle-plan NÃO passa pela validação golden-rule do `cycle-discover`. Para evitar consumo acidental futuro via `/skill-writer`: nome do arquivo carrega sufixo `-spike` (não `-blueprint`). Adicionar nota no topo do blueprint: `# NOTE: This is a cycle-plan spike, NOT a /discover-execute blueprint. Do NOT consume via /skill-writer.`

**Decisão binária no fim:**
- **Viável** (Agent tool aninhado funciona OU Skill tool com modelo declarado existe) → T2.2-A.
- **Não viável** (precisa restart de sessão entre phases, OU Agent aninhado conflita com promise marker) → T2.2-B.

**Output do spike (markdown short-form, ~50-100 LoC):**

```markdown
# Spike: teacher-student split em /implement halt-loop

## Pergunta investigada
É viável usar Agent tool aninhado dentro de ralph-loop:ralph-loop para isolar phases de /implement em modelos diferentes (RED/REFACTOR → opus, GREEN/COMMIT → haiku)?

## Achados
- {ralph-loop arquitetura: ...}
- {Agent tool semantics dentro de skill: ...}
- {Conflitos potenciais: promise marker timing, state file race, ...}

## Decisão
{Viável | Não viável} — vai para T2.2-{A|B}.

## Rationale
{evidência observada}
```

**Anti-pattern a evitar:** spike que produz "depends" ou "maybe" — decisão DEVE ser binária; honesty (Inquebrável Rule 3).

#### Tasks
1. Localizar e ler ralph-loop plugin source.
2. Documentar mecânica em blueprint.
3. Testar com sandbox simples (out-of-tree) se ambíguo.
4. Decisão binária registrada no blueprint.

#### TDD
```
RED:     N/A (spike investigativo, não muda código de produção)
GREEN:   N/A
REFACTOR: None
VERIFY:  test -f .claude/knowledge-base/discoveries/blueprints/teacher-student-halt-loop-spike.md
         grep -E '^## Decisão' <file>  (presença da seção)
         grep -E 'Viável|Não viável' <file>  (decisão binária presente)
```

#### Acceptance Criteria
- [ ] Blueprint criado com seções obrigatórias (Pergunta / Achados / Decisão / Rationale).
- [ ] Decisão é binária (Viável | Não viável). Sem hedging.
- [ ] Pelo menos 1 citação concreta de ralph-loop source (path + linha) sustentando a decisão.
- [ ] EC-2 satisfeito: blueprint cita AMBOS os paths canonical (cache + marketplace) e nota drift se existir.
- [ ] EC-10 satisfeito: blueprint começa com nota explícita "NOT a /discover-execute blueprint"; nome do arquivo termina em `-spike.md` (não `-blueprint.md`).

#### DoD
- [ ] Spike entregue.
- [ ] Próxima task (T2.2-A ou T2.2-B) selecionada com base na decisão.
- [ ] Commit `docs(spike): investigate teacher-student split in ralph-loop` (referencia T2.1).

### T2.2-A — (Conditional: Viável) Implementar split per-phase em `/implement`

> **Trigger:** T2.1 decidiu "Viável". Skip se "Não viável" — pula direto a T2.2-B.

#### Objective
Refatorar `implementation-prompt.md` para invocar Agent tool aninhado em phases-student (GREEN, COMMIT) usando modelo haiku, mantendo phases-teacher (RED, REFACTOR) no modelo da sessão (opus).

#### Evidence
T2.1 spike (a ser feito) — decisão "Viável" com path técnico identificado.

#### Files to edit
```
.claude/skills/implement/prompts/implementation-prompt.md — adicionar instruções de Agent tool por phase
.claude/skills/implement/SKILL.md — documentar split em § Workflow
.claude/rules/cycle-implement.md — seção "Model routing" análoga à de cycle-review.md
.claude/rules/review-model-routing.txt — (REVISITAR — pode virar implement-model-routing.txt OU consolidar em model-routing.txt)
```

#### Deep file dependency analysis
- `implementation-prompt.md` (lido parcial, ~200 LoC): seção GREEN e COMMIT ganham instrução "use Agent tool com modelo haiku para esta phase".
- `SKILL.md` (212 LoC): seção "Workflow" ganha nota de split.
- `cycle-implement.md`: análoga ao patch de T1.4 em cycle-review.md.
- Rule file: decisão a tomar — consolidar `review-model-routing.txt` em `model-routing.txt` genérico OU criar `implement-model-routing.txt` separado. Decisão registrada como sub-ADR em T2.2-A.

#### Deep Dives

**Pseudocode do prompt update (GREEN phase):**

```diff
 ### GREEN phase

+**Model split:** This phase runs on student model (haiku per implement-model-routing.txt).
+Invoke the GREEN work via the Skill tool wrapping an Agent invocation when split is active:
+- Read the routing rule for `implement.green` → resolved model
+- If model differs from session model → use Agent tool with `model:` frontmatter
+- Otherwise (fallback) → continue inline in the halt-loop

 - Write the MINIMAL production code that makes the RED test pass
 - ...
```

**TDD obrigatório (Inquebrável Rule 5):** novos testes em `.claude/skills/implement/tests/`:
- `test_phase_model_routing_resolves_green_to_haiku`
- `test_phase_model_routing_fallback_when_rule_missing`

**Edge cases:**
- 3 retries em GREEN → todos no student model? Ou último retry escala a teacher? **Decisão**: todos student (preserva semantics de "execução padronizada"). Escalation manual via operator override.
- COMMIT phase usa student → commit message gerada por haiku. Risk: mensagem pobre. Mitigação: template literal de conventional-commits no prompt deixa pouca latitude.

**Anti-pattern:** declarar split em prompt sem suporte na rule → fallback inconsistente. Rule é source of truth.

#### Tasks
1. (Conditional sobre rule strategy) — criar `implement-model-routing.txt` OU estender `review-model-routing.txt`.
2. Atualizar `implementation-prompt.md` com instrução de Agent tool para GREEN/COMMIT.
3. Atualizar `SKILL.md § Workflow`.
4. Atualizar `cycle-implement.md` com seção Model routing.
5. Adicionar testes em `tests/test_implementation_routing.py` (NEW).
6. Dry-run em scratch dir para validar Agent invocation funciona.

#### TDD
```
RED:     test_phase_model_routing_resolves_green_to_haiku() — falha antes da rule existir
RED:     test_phase_model_routing_fallback_when_rule_missing() — assert default opus
GREEN:   Implementar rule lookup + prompt update
REFACTOR: Extrair helper se duplica lógica de spawn_reviewers (DRY rule-of-three)
VERIFY:  pytest .claude/skills/implement/tests/ -v
```

#### Acceptance Criteria
- [ ] Rule file existe (consolidado ou separado).
- [ ] Prompt instrui Agent tool para GREEN/COMMIT.
- [ ] Testes novos verdes.
- [ ] Dry-run em scratch dir mostra GREEN rodando em Agent com model: haiku.

#### DoD
- [ ] Commit `feat(implement): per-phase model split via nested Agent tool` (referencia T2.2-A).

### T2.2-B — (Conditional: Não viável) ADR-DEFER em `cycle-implement.md`

> **Trigger:** T2.1 decidiu "Não viável". Skip se "Viável" — pula direto a Phase 3.

#### Objective
Documentar ADR-DEFER explícito em `cycle-implement.md` declarando: bloqueador identificado, critério futuro de reabertura, link para spike T2.1.

#### Evidence
T2.1 spike — decisão "Não viável" com bloqueador técnico documentado.

#### Files to edit
```
.claude/rules/cycle-implement.md — adicionar seção "ADR-DEFER: teacher-student-split"
.claude/rules/token-budget.md — anotar que /implement permanece em estimativa atual
```

#### Deep file dependency analysis
- `cycle-implement.md` (existing): seção nova entre `## Anti-patterns` e `## Rollback`.
- `token-budget.md`: nota explícita.

#### Deep Dives

**Conteúdo da seção ADR-DEFER:**

```markdown
## ADR-DEFER: teacher-student-split (2026-05-22)

`/implement` halt-loop split por phase (RED/REFACTOR teacher, GREEN/COMMIT student) foi investigado em T2.1 do plan teacher-student-model-split.

**Bloqueador identificado:** {citar achado concreto do spike — ex: "ralph-loop emite promise marker que conflita com Agent tool nested return"}

**Critério futuro de reabertura:**
- {ex: "Quando ralph-loop suportar nested Agent tool with promise propagation"}
- {ex: "Quando harness oferecer API de mid-loop model switch"}

**Link:** `.claude/knowledge-base/discoveries/blueprints/teacher-student-halt-loop-spike.md`

**Estimativa de custo permanece:** 100-300k tokens por `/implement` (sem split).
```

**Anti-pattern a evitar:** ADR-DEFER vago (`"vague placeholder text"`). Critério DEVE ser observable.

#### Tasks
1. Editar `cycle-implement.md` adicionando seção ADR-DEFER.
2. Atualizar `token-budget.md` com nota.

#### TDD
```
RED:     N/A (doc-only)
GREEN:   N/A
REFACTOR: None
VERIFY:  grep -E '^## ADR-DEFER: teacher-student-split' .claude/rules/cycle-implement.md
         grep 'teacher-student-halt-loop-spike' .claude/rules/cycle-implement.md
```

#### Acceptance Criteria
- [ ] Seção ADR-DEFER presente em `cycle-implement.md`.
- [ ] Critério de reabertura é observable.
- [ ] Link para spike funciona (`test -f` no path).

#### DoD
- [ ] Commit `docs(rules): defer teacher-student split for /implement (halt-loop bloqueio)` (referencia T2.2-B).

---

## Phase 3: Integration Validation (MANDATORY)

**Objective:** Validar que `/review` opera corretamente com o split E que mudanças em `/implement` (qualquer outcome de T2.2) preservam invariants.

### T3.1 — End-to-end dry-run de `/review` com split

#### Objective
Executar `spawn_reviewers.py` em modo dry-run contra um plano sintético e verificar que: (a) 5 arquivos gerados, (b) frontmatter `model:` reflete rule, (c) testes passam.

#### Evidence
Phase 1 produziu rule + script + tests. Sem integration check, podemos ter regressão em interação não-coberta.

#### Files to edit
```
(nenhum — execução de validação)
```

#### Tasks
1. Criar plano sintético em `/tmp/sample-plan.md` (10 LoC).
2. Rodar `python3 .claude/skills/review/scripts/spawn_reviewers.py --plan /tmp/sample-plan.md --slug demo-split --primary-domain pgvector-schema --output-dir /tmp/demo-out`.
3. Validar via `grep '^model:' /tmp/demo-out/*.md`:
   - 4 arquivos com `model: haiku` (architecture, tests, wiring, domain-pgvector-schema).
   - 1 arquivo com `model: opus` (cross-validation).
4. Rodar `pytest .claude/skills/review/tests/ -v` — full suite.

#### TDD
```
RED:     N/A (este é integration validation, não TDD)
GREEN:   N/A
REFACTOR: None
VERIFY:  Os 4 comandos acima retornam código 0.
```

#### Acceptance Criteria
- [ ] 5 arquivos gerados em /tmp/demo-out.
- [ ] Distribuição de modelos correta.
- [ ] Pytest 100% green.
- [ ] Pass: lint — `python3 -m py_compile .claude/skills/review/scripts/spawn_reviewers.py` zero erros.

#### DoD
- [ ] Output do dry-run anexado ao PR description final.

### T3.2 — Validação cruzada de rules e xrefs

#### Objective
Verificar que TODAS as cross-references entre rules são bidirecionais e funcionam (`grep` resolve em ambas direções).

#### Files to edit
```
(nenhum — verificação)
```

#### Tasks
1. `grep -l 'review-model-routing' .claude/rules/` → deve listar `cycle-review.md`, `token-budget.md`.
2. `test -f .claude/rules/review-model-routing.txt` → existe.
3. (Se T2.2-A): `grep -l 'implement-model-routing\|model-routing' .claude/rules/cycle-implement.md` → 1+ match.
4. (Se T2.2-B): `grep 'ADR-DEFER: teacher-student-split' .claude/rules/cycle-implement.md` → 1 match.
5. `python3 .claude/scripts/check_xrefs.py 2>&1` (se existe e for executável).

#### Acceptance Criteria
- [ ] Todas as referências resolvem.
- [ ] Nenhum arquivo de rule referencia path inexistente.

#### DoD
- [ ] Commit `chore: validate rule cross-references for teacher-student split` (referencia T3.2; pode ser empty commit se nada mudou — pular se for caso).

### T3.3 — Final validation chain

#### Objective
Pre-code phase: project não tem `package.json` (Inquebrável precedente em `cycle-implement.md § Step 1 Check 5`). Executar apenas validações aplicáveis ao Python tooling em `.claude/skills/`.

#### Files to edit
```
(nenhum)
```

#### Tasks
1. `python3 -m pytest .claude/skills/review/tests/ .claude/skills/plan-confidence/tests/ -v` — full suite Python.
2. `python3 -m py_compile .claude/skills/review/scripts/*.py` — sem syntax errors.
3. `python3 -m py_compile .claude/skills/review/tests/*.py`.
4. Manual: re-leitura do plan vs implementação — toda task tem commit referenciando seu ID (T1.1, T1.2, ...).
5. `git log --oneline feat/teacher-student-model-split` → cada task aparece em commit message.
6. **EC-11 (absorved v1.1):** atualizar `CHANGELOG.md` seção `[Unreleased]` com entradas `Added`/`Changed` correspondentes (CHANGELOG.md JÁ existe no repo — entrada é obrigatória, não condicional).

#### Acceptance Criteria
- [ ] All test suites green.
- [ ] Zero Python syntax errors.
- [ ] Every task ID present in git log.
- [ ] CHANGELOG.md atualizado sob `[Unreleased]` (Inquebrável Rule 6) — arquivo JÁ existe; entrada é mandatória, não condicional (EC-11).

#### DoD
- [ ] PR ready to open with description summarizing achievement + economy estimate.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `/review` agents todos rodam Opus sem ROI claro (~200k/run baseline) | T1.2, T1.3 | Templates ganham `{MODEL}`, script resolve por arquétipo via rule |
| 2 | `spawn_reviewers.py` não tem lookup de modelo por arquétipo | T1.3 | Helper `_load_routing_rule` + `_resolve_model` |
| 3 | Sem rule declarando mapeamento role → model | T1.4 | `review-model-routing.txt` criado |
| 4 | Sem cross-reference em cycle-review.md sobre o split | T1.4 | Seção "Model routing" adicionada |
| 5 | `token-budget.md` desatualizado vs split | T1.5 | Tabela cycle-review reflete `~60k (split)` |
| 6 | TDD ausente para frontmatter `model:` substituído | T1.1 | 5 RED tests escritos antes do script update |
| 7 | Viabilidade de model split em `/implement` halt-loop desconhecida | T2.1 | Spike read-only com decisão binária |
| 8 | `/implement` split per-phase (caso viável) | T2.2-A | Refator do prompt + Agent tool aninhado |
| 9 | `/implement` ADR-DEFER documentado (caso bloqueado) | T2.2-B | Seção ADR-DEFER em cycle-implement.md |
| 10 | Risco de quality regression silenciosa sem A/B baseline | T1.4 (ADR D3) | Rule entries carregam `experimental_until` + `rollback_if` — mitigação real implementada em T1.4 ancorada em D3 |
| 11 | A/B baseline (técnica não inclusa neste plan) | Deferred — out-of-scope (ADR D5) | Marcador inline serve de stand-in até plan dedicado de A/B baseline chegar |
| 12 | Integration validation antes do merge | Phase 3 (T3.1, T3.2, T3.3) | Dry-run + xrefs + final chain |
| 13 | Backward-compat preservado (rule ausente → status quo) | T1.3 fallback | `_resolve_model` retorna default opus quando rule ou role faltam |
| 14 | Inquebrável Rule 4 (no main commits) | Phase 0 T0.1 + git workflow | Feature branch já criada; hook bloqueia main |
| 15 | Inquebrável Rule 5 (TDD obrigatório) | T1.1 (10 RED tests v1.1) + T2.2-A (2 RED tests) | Tests escritos primeiro em cada task de código |
| 16 | Inquebrável Rule 6 (CHANGELOG.md) | T3.3 | Entry `[Unreleased]` antes do PR (file já existe — entrada obrigatória, EC-11) |
| 17 | EC-1 MUST FIX: Domain role lookup inconsistente anula ~40% do ganho | T1.3 Deep Dives (invariant + pseudocode com `lookup_key`) + T1.1 RED test EC-4 | Normalização `domain-X → domain` antes do lookup; regression-guarded por test |
| 18 | EC-2 MUST FIX: Spike T2.1 sem path canônico → fabricated citation cap | T2.1 Deep Dives (2 paths canonical) + Acceptance Criterion novo | Spike cita cache + marketplace, anota drift |
| 19 | EC-3 `SHOULD TEST`: UTF-8 BOM em rule file | T1.1 RED test `test_routing_rule_with_utf8_bom_parsed_correctly` | Parser usa `utf-8-sig` consistente com outros reads |
| 20 | EC-5 `SHOULD TEST`: CLI override com valor vazio | T1.1 RED test `test_cli_override_with_empty_value_rejected` | Validação no custom argparse action |
| 21 | EC-6 `SHOULD TEST`: Rule malformada (sem `:`) | T1.1 RED test `test_routing_rule_malformed_line_silently_skipped` | Fail-soft documented |
| 22 | EC-7 `SHOULD TEST`: Modelo desconhecido fail-soft passthrough | T1.1 RED test `test_routing_rule_unknown_model_passes_through` | Script aceita string qualquer; downstream Anthropic CLI decide |
| 23 | EC-8 DOCUMENT: `experimental_until` no passado não validado | T1.4 Deep Dives nota inline + rule header comment | Validação manual antes de release (D3 reforçado) |
| 24 | EC-9 DOCUMENT: opus + experimental semântico odor | T1.4 Deep Dives nota inline + rule template comment | Comment-line guia operadores; parser aceita silenciosamente |
| 25 | EC-10 DOCUMENT: Spike vs blueprint namespace conflict | T2.1 Deep Dives nota inline + Acceptance Criterion (sufixo `-spike`, nota no topo) | Convenção de naming + nota previne consumo via /skill-writer |

**Coverage: 25/25 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (Phase 0, 1, 2, 3) — Phase 2 conclui em T2.2-A OU T2.2-B (não ambos).
- [ ] All Python tests passing — `pytest .claude/skills/review/tests/ .claude/skills/plan-confidence/tests/` zero failures.
- [ ] Zero Python syntax errors — `python3 -m py_compile` em todos os scripts e tests modificados.
- [ ] File-size budget respected — `spawn_reviewers.py` ≤ 300 LoC (margem para 500 budget de `loc-limits.md`).
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6) com entrada `Added`/`Changed` por commit relevante (Phase 1 + Phase 2 + Phase 3) — arquivo JÁ existe no repo; entrada é obrigatória, não condicional (EC-11).
- [ ] Backward compatibility preserved — `.claude/rules/review-model-routing.txt` ausente → status quo (todos opus).
- [ ] Runtime-metric proof N/A — nenhuma task declara métrica runtime nova (split é static config, não emissor de counters).
- [ ] Plan-specific:
  - [ ] Dry-run de `spawn_reviewers.py` mostra distribuição correta (4 haiku + 1 opus por default rule).
  - [ ] Rule `review-model-routing.txt` parseia sem erro pelo `_load_routing_rule`.
  - [ ] Phase 2 outcome documentado (A ou B), spike blueprint citado em `cycle-implement.md`.
  - [ ] `token-budget.md` reflete economia esperada com link para rule.

## Final Phase: Integration Validation (MANDATORY)

> Cobre o que falta após Phase 3 para garantir handoff limpo a `cycle-review`.

### Execution

```bash
# Suite Python full
python3 -m pytest .claude/skills/review/tests/ -v
python3 -m pytest .claude/skills/plan-confidence/tests/ -v
python3 -m pytest .claude/skills/implement/tests/ -v   # se T2.2-A entregou novos tests

# Syntax check
python3 -m py_compile .claude/skills/review/scripts/*.py
python3 -m py_compile .claude/skills/review/tests/*.py

# Rule integrity
python3 -c "
from pathlib import Path
p = Path('.claude/rules/review-model-routing.txt')
assert p.exists(), 'rule missing'
lines = [l for l in p.read_text().splitlines() if l.strip() and not l.startswith('#')]
assert len(lines) >= 5, f'expected 5+ role entries, got {len(lines)}'
print(f'OK: {len(lines)} routing entries')
"

# Dry-run
mkdir -p /tmp/teacher-student-validation
echo "# Sample plan for validation" > /tmp/teacher-student-validation/plan.md
python3 .claude/skills/review/scripts/spawn_reviewers.py \
  --plan /tmp/teacher-student-validation/plan.md \
  --slug validation-demo \
  --primary-domain pgvector-schema \
  --output-dir /tmp/teacher-student-validation/agents \
  --skill-dir .claude/skills/review
echo "--- Frontmatter check ---"
grep -E '^(name|model):' /tmp/teacher-student-validation/agents/*.md

# Git log audit
git log feat/teacher-student-model-split --oneline | grep -cE 'T[0-9]\.[0-9]' || echo "WARN: not all commits reference task IDs"
```

### Acceptance Criteria

- [ ] All pytest suites green (review + plan-confidence + implement-if-touched).
- [ ] Zero Python syntax errors.
- [ ] Rule integrity script prints `OK: 5 routing entries` (or more).
- [ ] Dry-run frontmatter shows 4 student-model agents + 1 teacher-model agent.
- [ ] Git log shows ≥7 task-referencing commits (T0.1, T1.1, T1.2, T1.3, T1.4, T1.5, T2.1, T2.2-{A|B}, T3.1, T3.3 — exact count depends on outcome).
- [ ] Runtime-metric proof N/A (no metrics declared).

### If Validation Fails

1. Identify failed step (test, script, dry-run, git log).
2. If pre-existing (not caused by this plan) → log in PR description; do not block plan completion.
3. If plan-caused → fix in NEW commit (não amend), referenciar task ID.
4. Re-run validation chain.
5. Honesty discipline (Inquebrável Rule 3): se algum acceptance ficar PARTIAL, declare honestamente no PR; não force pass.
