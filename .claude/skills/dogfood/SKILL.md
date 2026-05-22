---
name: dogfood
description: Honesty gate that blocks any 'production-ready' / v1.0 / 'production-grade' claim for @usetheo/memory without recorded evidence of sustained internal use. Reads the dogfood manifest at .claude/knowledge-base/dogfood/manifest.md plus evidence files at .claude/knowledge-base/dogfood/evidence/, applies the dogfood golden rule (.claude/rules/dogfood-golden-rule.md), and emits EVIDENCE_SUFFICIENT / EVIDENCE_WITH_CAVEATS / EVIDENCE_INSUFFICIENT. Invoke before any production claim, milestone promotion review targeting v1.0, README/CHANGELOG edit that touches status language, or release decision.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "[audit|log-evidence|status]"
---

# Skill: dogfood

Aplica o **dogfood golden rule** (`.claude/rules/dogfood-golden-rule.md`) ao manifesto em `.claude/knowledge-base/dogfood/manifest.md` e aos arquivos de evidência em `.claude/knowledge-base/dogfood/evidence/`. Emite veredicto sobre se o projeto pode legitimamente afirmar `production-ready` / `production-grade` / `v1.0 ready`.

**Esta skill NÃO é opcional para o claim de v1.0.** Ler `dogfood-golden-rule.md` antes de invocar.

## Why this skill exists

CLAUDE.md (root): "No production claims until v1.0 with benchmarks reproduced independently."

Benchmarks provam que o sistema responde. **Dogfood prova que o sistema é usável.** Os dois são complementares — não substitutos.

O failure mode SOTA para sistemas de memória é exatamente esse: scores altos em eval sintético (LongMemEval, MemQA) combinados com DX miserável no mundo real. Um time consegue shipar um clone de Mem0 que passa nos próprios benchmarks enquanto é inutilizável em qualquer agent loop real. Sem um gate de dogfood, a tentação de claim production-ready em v1.0 — backed apenas por benchmarks contra datasets curados — é alta.

TheMemory entra em pre-release como exceção explícita ao "production-ready" claim do monorepo (lock 2026-05-15). Esta skill é o gate que mantém a exceção honesta.

## Anchor scenario (locked at day 0)

**S1 — Claude Code auto-memory backed by TheMemory**

O sistema de auto-memória persistente do Claude Code (em `/home/paulo/.claude/projects/<project-slug>/memory/`) é exatamente o problema que TheMemory resolve: memória scoped, persistente, atravessando sessões. Wirar isso a TheMemory é o dogfood mais cru possível — sentimos cada dor de DX, cada gap de API, cada miss de retrieval antes que qualquer usuário externo sinta.

A âncora está **locked**. Não pode ser silenciosamente substituída por uma alternativa "mais fácil de wirar". Mudar a âncora exige strategic review (ver `dogfood-golden-rule.md § When this rule may change`).

## Argumento

- `$ARGUMENTS = audit` (ou sem argumento) → roda o gate completo e emite veredicto
- `$ARGUMENTS = log-evidence` → modo interativo: ajuda a registrar nova evidência da âncora ou outro cenário
- `$ARGUMENTS = status` → resumo rápido (status field + contagem de evidência + idade da última); sem veredicto formal

## Processo — modo `audit` (default)

### Passo 1 — Ler o manifesto

```!
test -f .claude/knowledge-base/dogfood/manifest.md && cat .claude/knowledge-base/dogfood/manifest.md || echo "MANIFEST MISSING"
```

Se o arquivo não existe → veredicto imediato `EVIDENCE_INSUFFICIENT` com flag `manifest_missing`. Pare e reporte.

### Passo 2 — Localizar a seção da âncora

Procure no manifesto pela seção começando com `### S1 — Claude Code auto-memory backed by TheMemory` (ou com `**Slug:** claude-code-auto-memory`). Extraia:

- Campo `**Status:**` → deve ser um de: `planned | wired | running | paused | abandoned`
- Campo `**Locked at:**` → data
- Campo `**Latest evidence:**` → caminho ou `N/A`

Se a seção da âncora não está presente OU o campo `**Status:**` está ausente → flag `anchor_missing` (hard cap 1).

### Passo 3 — Aplicar hard caps na âncora

Em ordem:

| # | Check | Flag emitida |
|---|---|---|
| 1 | Seção da âncora presente + `**Status:**` presente | `anchor_missing` (se falha) |
| 2 | `**Status:**` == `running` (case-insensitive, sem trailing punctuation) | `anchor_not_running` (se falha) |
| 3 | `glob` em `.claude/knowledge-base/dogfood/evidence/*.md` retorna ≥ 1 arquivo cuja frontmatter `scenario:` casa com a âncora (`claude-code-auto-memory` ou alias declarado no manifesto) | `no_anchor_evidence` (se falha) |
| 4 | Da lista filtrada do check 3, o arquivo mais recente (por `date:` frontmatter) é ≤ 30 dias da data atual | `anchor_evidence_stale` (se falha) |

**Qualquer flag emitida → veredicto `EVIDENCE_INSUFFICIENT`.** Sem exceção, sem renormalização.

### Passo 4 — Aplicar soft caps (apenas se os 4 hard caps passaram)

| # | Check | Flag emitida |
|---|---|---|
| 5 | Primeiro arquivo de evidência da âncora tem `date:` ≥ 30 dias do today | `soft_sustained_lt_30d` (se falha) |
| 6 | Razão `(número de evidência files da âncora) / (dias rodando / 10)` ≥ 1.0 | `soft_evidence_density_low` (se falha) |
| 7 | Ao menos um arquivo de evidência da âncora tem conteúdo não-vazio em `## DX pains encountered` ou `## API gaps surfaced` | `soft_no_pains_logged` (se falha) |

**Qualquer soft cap emitido → veredicto `EVIDENCE_WITH_CAVEATS`** (não bloqueia, mas exige footnote em qualquer claim).
**Nenhuma flag emitida → veredicto `EVIDENCE_SUFFICIENT`.**

### Passo 5 — Vocabulary lock check

```!
grep -rEn '\b(production-ready|production-grade|v1\.0 ready)\b' README.md docs/ CHANGELOG.md 2>/dev/null | grep -v 'No production claims\|until v1.0\|exception to' | head -10
```

Se o grep retorna matches **E** o veredicto é `EVIDENCE_INSUFFICIENT` → adicione flag `vocabulary_lock_violated` ao report. Liste os arquivos + linhas. Isso é uma violação da inquebrável que pede correção imediata.

### Passo 6 — Emitir report

Caminho: print no stdout (não salva arquivo). Para audit trail persistente, o usuário pode redirecionar OU este passo pode ser estendido para salvar em `.claude/knowledge-base/reviews/dogfood-audit-{YYYY-MM-DD}.md` (não obrigatório no day 0).

Formato:

```
# /dogfood — audit report
Data: YYYY-MM-DD

## Verdict
**{EVIDENCE_SUFFICIENT | EVIDENCE_WITH_CAVEATS | EVIDENCE_INSUFFICIENT}**

## Anchor scenario status
- Name: Claude Code auto-memory backed by TheMemory
- Status: {planned|wired|running|paused|abandoned}
- Evidence files (anchor): N
- Latest evidence: {filename} ({N days ago})
- First evidence: {filename} ({N days ago})

## Hard caps triggered
{lista de stable identifiers OR "(none)"}

## Soft caps triggered
{lista de stable identifiers OR "(none)"}

## Vocabulary lock
{OK | VIOLATED + lista de arquivos:linhas}

## What to do next
- If EVIDENCE_INSUFFICIENT: {ações específicas — atualizar status, registrar evidence, etc.}
- If EVIDENCE_WITH_CAVEATS: {soft caps a fechar para chegar a SUFFICIENT}
- If EVIDENCE_SUFFICIENT: production claims podem ser feitas. Recheque antes de cada release.
```

## Processo — modo `log-evidence`

Modo interativo para criar um novo arquivo em `.claude/knowledge-base/dogfood/evidence/`.

1. Perguntar qual cenário (default: anchor `claude-code-auto-memory`)
2. Perguntar status atual do cenário (`running` é o esperado pra logar evidência)
3. Perguntar:
   - O que você fez na última sessão usando TheMemory como backing store?
   - Que dores de DX você sentiu? (lista — vazio é permitido mas suspeito)
   - Que gaps de API você encontrou? (lista)
   - Qual o objetivo da próxima sessão de dogfood?
4. Gerar arquivo em `.claude/knowledge-base/dogfood/evidence/{scenario-slug}-{YYYY-MM-DD}.md` com frontmatter:
   ```yaml
   ---
   scenario: claude-code-auto-memory
   date: YYYY-MM-DD
   status: running
   session_focus: "<texto curto>"
   ---
   ```
5. Sugerir atualizar o `**Latest evidence:**` campo no manifesto.

## Processo — modo `status`

Resumo rápido sem aplicar caps:

```
Anchor: claude-code-auto-memory
Status field: {value}
Evidence files (anchor): N
Latest evidence: {date} ({N days ago})
```

Sem veredicto. Útil para checar rapidamente "preciso logar evidência hoje?".

## Verdict bands

| Veredicto | Significado | O que permite |
|---|---|---|
| `EVIDENCE_SUFFICIENT` | Todos os hard + soft caps passaram. | Production claims permitidas. Recheque antes de cada release. |
| `EVIDENCE_WITH_CAVEATS` | Hard caps passaram, ≥1 soft cap acionou. | Claims com footnote explícito declarando o caveat ("running for 14 days; sustained dogfood evidence still accumulating"). NÃO use `production-ready` puro. |
| `EVIDENCE_INSUFFICIENT` | ≥1 hard cap acionou. | NENHUM claim `production-ready` / `production-grade` / `v1.0 ready` é permitido. Public copy permanece como pre-release. |

## When to invoke

Inquebrável — invoque ANTES de:

1. **Qualquer claim `production-ready` em README, docs, ou marketing.**
2. **Promoção para v1.0** (roadmap milestone).
3. **Edit em CLAUDE.md (root ou projeto) que enfraqueça a honesty discipline.**
4. **Edit em README.md § Status que mude pre-release status.**
5. **Release decision** (npm publish de qualquer tag estável).

Opcionalmente — invoque para informação:

- Antes de planning de milestone (saber onde está o anchor scenario)
- Após cada sessão de dogfood (para lembrar de logar evidence)

## Anti-patterns

1. **NUNCA crie um flag `--force` ou `--skip-checks`** — proibido pela golden rule (constructor invariant). Se o gate está bloqueando algo legítimo, o problema é o gate ou o cenário, não a presença do gate.
2. **NUNCA mude o anchor scenario silenciosamente** — exige strategic review + ADR. Trocar a âncora porque "Claude Code é difícil de wirar" é exatamente o sintoma que o gate existe para pegar.
3. **NUNCA registre evidence sintética** — "rodei mentalmente o cenário" não conta. Evidence é registro de uso REAL. Sintética é teatro.
4. **NUNCA marque status `running` se TheMemory não está sendo o backing store ativo** — `running` significa "se TheMemory cair agora, perdi memória de verdade". Senão é `wired` ou `paused`.
5. **NUNCA esconda DX pains nas evidence files** — gaps de API encontrados em dogfood são o sinal mais valioso do gate. Logar `DX pains: none` em todo arquivo é sinal de que a evidence está sendo escrita após-fato sem detalhe.
6. **NUNCA invoque este skill como rubber stamp** — se você está procurando o veredicto antes da evidência, está usando errado. O fluxo é: faça o dogfood → registre evidence → INVOQUE o skill para auditar.

## Integração

- **Skill standalone** — não faz parte do `cycle-discover`, `cycle-plan`, `cycle-implement`, ou `cycle-review`. É invocado MANUALMENTE pelo humano antes dos triggers listados em "When to invoke".
- **Não há cycle-dogfood.md** — single-skill por design (KISS / YAGNI). Se eventualmente surgir necessidade de scenario runner automatizado, scenario generator, etc., aí sim um cycle-* rule é justificado.
- **Não bloqueia `cycle-review` no fluxo atual** — `cycle-review` é o gate de merge; `/dogfood` é o gate de production claim. Diferentes momentos no tempo.
- **Estado externo:** manifesto + evidence/ são a única source of truth. Esta skill não grava state em outro lugar.

## Custo aproximado

Modo `audit`: ~3-8k tokens (lê manifest + lista evidence + emite report).
Modo `log-evidence`: ~5-10k tokens (interativo).
Modo `status`: ~1-2k tokens.

Bem abaixo dos cycles principais — adicionar ao budget mensal não move a agulha.

## Cross-references

- Rule: [`.claude/rules/dogfood-golden-rule.md`](../../rules/dogfood-golden-rule.md)
- Manifest: [`.claude/knowledge-base/dogfood/manifest.md`](../../knowledge-base/dogfood/manifest.md)
- Evidence dir: `.claude/knowledge-base/dogfood/evidence/`
- Project honesty discipline: `/home/paulo/Projetos/usetheo/theo-memory/CLAUDE.md § Roadmap → Honesty discipline`
- Root inquebrável (Honestidade Extrema): `/home/paulo/.claude/CLAUDE.md § 3`
- Token budget: `.claude/rules/token-budget.md` (skill adiciona linha; ver § Auxiliary)
