# Edge Case Review — teacher-student-model-split

Data: 2026-05-22
Tasks analisadas: 11 (T0.1, T1.1-T1.5, T2.1, T2.2-A, T2.2-B, T3.1-T3.3)
Edge cases encontrados: 11 (MUST FIX: 2, SHOULD TEST: 5, DOCUMENT: 4)

Plan path: `.claude/knowledge-base/plans/teacher-student-model-split-plan.md`
Feature branch: `feat/teacher-student-model-split`

## MUST FIX

### EC-1: Domain role lookup inconsistente — split não se aplica a secondary domains
- **Task afetada:** T1.3
- **Família:** Format / State
- **Cenário:** `spawn_reviewers.py` linha 139 atual gera `role = f"domain-{domain}"` (ex: `domain-pgvector-schema`, `domain-memory-layer`). A rule file `review-model-routing.txt` declara entry com chave base `domain: haiku`. Sem lookup explícito de base role, o `_resolve_model("domain-pgvector-schema", rule, ...)` cai no fallback default (opus). Resultado: secondary domains (e o primary domain) ignoram silenciosamente a regra haiku, anulando ~40% do ganho esperado.
- **Impacto:** Split parece funcionar (4 baseline agents passam para haiku) mas N domain agents permanecem em opus. Tabela de economia do plan (~60k) fica incorreta — custo real seria ~80-100k. Quality regression silenciosa REVERSA: o plan acha que está testando split agressivo mas só está testando 4 dos 5+ arquétipos.
- **Fix sugerido:** Adicionar 1 linha em T1.3 Deep Dives + 1 linha de código no `_resolve_model`:
  ```python
  lookup_key = "domain" if role.startswith("domain-") else role
  ```
  E explicitar a regra de lookup na seção Deep Dives como invariant testável.

### EC-2: Spike T2.1 sem path canônico do ralph-loop — pode estagnar
- **Task afetada:** T2.1
- **Família:** Resource / Format
- **Cenário:** T2.1 Tasks lista "Localizar e ler ralph-loop plugin source" com sugestão genérica `find ~/.claude/plugins/`. Path real verificado: `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/commands/ralph-loop.md`. Spike sem path explícito pode gastar tempo procurando OU produzir blueprint com citação vaga, violando `discover-blueprint-golden-rule.md` (fabricated citation hard cap).
- **Impacto:** Spike entrega decisão binária sem citação verificável → blueprint inválido por golden rule → Phase 2 fica truncada → cycle inteiro bloqueia (cycle-plan.md § Hard gates de plan-confidence).
- **Fix sugerido:** Em T2.1 Deep Dives, substituir "buscar via `find`" por: spike DEVE ler `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/commands/ralph-loop.md` + `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/commands/ralph-loop.md` como sources canonical; verificar drift entre eles; citar linha + path no blueprint.

## SHOULD TEST

### EC-3: BOM (utf-8-sig) no rule file
- **Task afetada:** T1.3
- **Cenário:** Editor (ex: alguns VSCode plugins, Notepad++) podem salvar `review-model-routing.txt` com BOM. Primeira linha vira `﻿# review-model-routing...` — parser ignora linha de comentário OK, mas se a primeira linha for uma entry role, o role fica `﻿architecture` e lookup falha.
- **Teste sugerido:** `test_routing_rule_with_utf8_bom_parsed_correctly` — escrever rule file com prefixo `b'\xef\xbb\xbf'`, asserir que role `architecture` resolve corretamente. Fix mínimo no parser: `read_text(encoding="utf-8-sig")` (já é o padrão de `spawn_reviewers.py` em outros reads — usar consistência).

### EC-4: Domain role base lookup explícito
- **Task afetada:** T1.3
- **Cenário:** Garantir EC-1 não regride. Mesmo após fix de EC-1, secondary domain pode ser `agent-bootstrap` (não tem prefixo `domain-` se naming convention mudar).
- **Teste sugerido:** `test_domain_secondary_resolves_via_base_lookup` — spawn com `--primary-domain x --secondary-domains y,z`, asserir os 3 domain agents (`domain-x`, `domain-y`, `domain-z`) todos pegam modelo da rule entry `domain`.

### EC-5: CLI override com valor vazio
- **Task afetada:** T1.3
- **Cenário:** `--model-override architecture=` (valor vazio após `=`). Custom argparse action provavelmente parseia em `{"architecture": ""}`. Sem validação, substituição produz `model: ` (sem valor) → frontmatter inválido → Agent tool falha downstream.
- **Teste sugerido:** `test_cli_override_with_empty_value_rejected` — passar `--model-override architecture=` espera exit code != 0 com mensagem "empty model value not allowed for role 'architecture'".

### EC-6: Rule entry com role sem `:` separator
- **Task afetada:** T1.3
- **Cenário:** Editor humano comete typo `architecture haiku` (espaço em vez de `:`). Plan diz parser descarta silenciosamente. Validar.
- **Teste sugerido:** `test_routing_rule_malformed_line_silently_skipped` — rule com linha `architecture haiku` (sem `:`) e linha válida `tests: haiku`; asserir que `tests` resolve mas `architecture` cai em default opus, sem traceback.

### EC-7: Rule entry com modelo desconhecido (fail-soft passthrough)
- **Task afetada:** T1.3
- **Cenário:** `architecture: gpt5-turbo` (modelo não existe). Script aceita string qualquer e injeta no frontmatter. Falha real acontece downstream quando Agent tool tenta invocar. Aceitável (script é dumb passthrough), mas precisa documentação clara.
- **Teste sugerido:** `test_routing_rule_unknown_model_passes_through` — rule com `architecture: nonexistent-model`, asserir frontmatter substituído contém literal `model: nonexistent-model`, sem validação extra. Fail-soft é design.

## DOCUMENT

### EC-8: `experimental_until` no passado não é validado automaticamente
- **Risco aceito:** D3 declara que rollback é manual via edit no rule file. Plan NÃO automatiza checagem de data expirada. Aceitável: rollback é decisão humana baseada em observação (`rollback_if` criterion). Plan deve ter 1 linha em T1.4 Deep Dives notando: "Validação de `experimental_until` é responsabilidade do reviewer humano antes de cada release; sem auto-expiração".

### EC-9: Rule semanticamente inválida (opus + experimental)
- **Risco aceito:** `cross-validation: opus experimental_until=2026-06-22` é semanticamente confuso (opus é o status quo, não experimental). Parser aceita silenciosamente. Documento NÃO impede mas é odor. T1.4 deve incluir comentário no rule template: `# experimental_until só faz sentido com models diferentes do default opus`.

### EC-10: Spike blueprint em `discoveries/blueprints/` colide com namespace de `/discover-execute`
- **Risco aceito:** T2.1 grava em `.claude/knowledge-base/discoveries/blueprints/teacher-student-halt-loop-spike.md`. `cycle-discover.md` reserva esse dir para outputs de `/discover-execute` (blueprints validados por `/discover-confidence`). Spike de cycle-plan não passa por `/discover-confidence`. Risco: futuro `/skill-writer` tenta consumir o spike como blueprint de patterns, falha. Mitigação documentada: nome do arquivo carrega sufixo `-spike` (não `-blueprint`) — bastará grep para distinguir. T2.1 deve adicionar nota: "Spike NÃO é blueprint canonical; nome marca distinção via sufixo `-spike`. NÃO consumir via `/skill-writer`".

### EC-11: Global DoD diz "once the file exists in the repo" mas CHANGELOG.md já existe
- **Risco aceito:** Plan Global DoD herdou linguagem do plan-template ("CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6) once the file exists in the repo"). CHANGELOG.md já está no repo (verificado: `head -20 CHANGELOG.md` retorna conteúdo). Imprecisão semântica que pode levar implementador a achar que step é opcional. T3.3 deve ter linha "CHANGELOG.md ALREADY exists — entrada `[Unreleased]` é obrigatória, não condicional".

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 6 | 1 (EC-1) | 5 (EC-3 a EC-7) | 0 |
| T1.4 | 2 | 0 | 0 | 2 (EC-8, EC-9) |
| T1.5 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 1 (EC-2) | 0 | 1 (EC-10) |
| T2.2-A | 0 | 0 | 0 | 0 |
| T2.2-B | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 1 | 0 | 0 | 1 (EC-11) |
| **Total** | **11** | **2** | **5** | **4** |

**Veredicto:** PLANO PRECISA DE AJUSTE

Razão: EC-1 (domain role lookup) é load-bearing — sem fix, ~40% do ganho esperado de tokens não materializa e a métrica do plan fica incorreta. EC-2 (spike sem path canônico) interage com `discover-blueprint-golden-rule.md` (fabricated citation hard cap) e pode bloquear `/plan-confidence` downstream se o spike produzir blueprint INVÁLIDO.

**Ações sugeridas antes de `/plan-confidence`:**
1. Editar `teacher-student-model-split-plan.md` v1.0 → v1.1 absorvendo EC-1 em T1.3 Deep Dives (1 parágrafo + 1 trecho de pseudocode) e EC-2 em T2.1 Deep Dives (substituir "buscar via find" por path canonical com 2 candidates).
2. Adicionar os 5 SHOULD TEST como testes complementares na seção TDD de T1.3 (atualmente lista 5 RED tests; ampliar para 10).
3. Documentos (EC-8 a EC-11) absorver como 1-linha nas respectivas tasks Deep Dives — não exigem subtasks novas.

Após esses ajustes, plan vira v1.1, status `revised`, pronto para `/plan-confidence`.
