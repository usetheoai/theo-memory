---
name: discover-edge-cases
description: Analisa um discovery plan e identifica edge cases não previstos — focado em deep-research em .claude/knowledge-base/references/ (Mem0 / Letta / LangMem). Pragmático — aponta riscos reais sem complicar o plano. Use após /discover-plan ou quando revisar qualquer plano em .claude/knowledge-base/discoveries/plans/.
user-invocable: true
allowed-tools: Read Glob Grep Bash
argument-hint: "[plan-slug|plan-file-path]"
---

# Discover Edge Case Review

Analise o discovery plan e identifique edge cases que NÃO foram previstos para a fase de execução. Seja pragmático — aponte riscos reais, não cenários fantasiosos.

Sibling de `/edge-case-plan` — mesma filosofia, mesmo formato de output, escopo diferente: investiga riscos da **execução do discovery** (não da implementação do código).

## Cycle contract

This skill is **phase 2** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for chain order, hard gates, anti-patterns at the cycle level, and rollback. **Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains phase-specific detail (the pragmatic checklist for identifying edge cases in discovery plans, classification rubric, report format).

## Argumento

A skill recebe o slug ou caminho via mensagem do usuário (texto livre, não slash-command nativo). Resolve assim:

- Texto contém um slug (`my-discovery`): busca `Glob` em `.claude/knowledge-base/discoveries/plans/*my-discovery*.md`
- Texto contém um caminho `.md`: usa direto
- Sem indicação: lê o mais recente em `.claude/knowledge-base/discoveries/plans/` por mtime

O placeholder `${ARGUMENTS}` no bloco bash do Passo 1 é substituído pelo agente — não é shell expansion. Se a skill rodar sem argumento, use `ls -t ... | head -1`.

## Filosofia

**Você NÃO é o agente que complica.** Você é o agente que pergunta: "e se essa descoberta der errado?"

Regras de ouro:
1. **Só aponte edge cases que podem acontecer de verdade durante o /discover-execute** — não cenários teóricos
2. **Nunca sugira aumentar o escopo do plano** — a solução para um edge case é uma pergunta extra ou um método de fallback, não uma nova fase
3. **KISS prevalece** — se o fix para o edge case requer reescrever o plano todo, documente o risco e siga em frente
4. **Cada edge case apontado DEVE ter uma sugestão de fix em ≤1 linha de método ou ≤1 frase de mudança no plano**
5. **Corner cases (múltiplos edges combinados) só se forem realistas no contexto de `.claude/knowledge-base/references/`** — esquecer que uma versão pode estar desatualizada é realista; "e se a Postgres muda de spec durante a leitura" não é

## Processo

### Passo 1 — Ler o discovery plan

```!
# Encontrar o plano
ls .claude/knowledge-base/discoveries/plans/*${ARGUMENTS}* 2>/dev/null || ls -t .claude/knowledge-base/discoveries/plans/*.md | head -5
```

Leia o plano completo. Entenda:

- Quais reference projects estão em escopo (Mem0, Letta, LangMem)
- Quais subdirectories serão tocados em cada um
- Quais research questions foram declaradas
- Qual o time-budget por projeto
- Quais ADRs justificam deferral

### Passo 2 — Mapear fronteiras da investigação

Para cada research question do plano, identifique:

- **Inputs do investigador**: o que será lido? `Read`, `Grep`, `find`, `git log`? Em qual versão do clone?
- **Outputs esperados**: que forma o blueprint vai dar à resposta? Tabela? Snippet? Diagrama?
- **Dependências entre questions**: a pergunta 7 assume que a pergunta 3 já foi respondida? Quebra se a ordem flipa?

Edge cases de discovery vivem nas fronteiras: versão dos clones, dependência circular entre questions, time-budget realista, fallback se a referência for diferente do esperado.

### Passo 3 — Aplicar o checklist pragmático

Para cada research question, passe por este checklist. Marque ✅ se o plano cobre, ❌ se não:

```
REFERENCIAS:
  [ ] O path em .claude/knowledge-base/references/ realmente existe?
  [ ] A versão do clone (--depth 1, data) é mencionada quando relevante?
  [ ] O subdirectory tem o conteúdo esperado? (Mem0 mudou de Python pra TS — pode ter migrado o file)

METODO:
  [ ] O método (Read / Grep / find) é apropriado para o tamanho do alvo?
  [ ] Há fallback se o arquivo não existir? (ex: "se mem0-ts não tiver, fallback pra mem0-python")
  [ ] O time-budget cobre essa question?

INTERPRETAÇÃO:
  [ ] A pergunta tem resposta determinística OU exige interpretação? (LSP-style "isso é um wrapper?" exige julgamento)
  [ ] O blueprint sabe formatar essa resposta? (template tem a seção certa)

DEPENDÊNCIAS:
  [ ] Esta question depende de outra ter sido respondida primeiro?
  [ ] Se sim, o plano lista a ordem explicitamente?

ESCOPO:
  [ ] Há risco de scope creep durante o halt-loop? (ex: "ver como Mem0 lida com dedup" vira "ver como Mem0 lida com dedup, embeddings, indexação, ...")
  [ ] Há critério de stop claro?

COVERAGE:
  [ ] As 4 corners (tests/deps/tools/techniques) estão todas mapeadas?
  [ ] Se uma corner foi deferida, há ADR justificando?

CITAÇÕES:
  [ ] Cada path mencionado em Evidence é verificável (Read funciona)?
  [ ] O plano cita exemplos concretos ou só placeholders ("ver arquivo X")?
```

**Ignore os checks que não se aplicam.** Algumas questions não têm dependências. Algumas não têm fallback necessário. Marque só o relevante.

### Passo 4 — Classificar e reportar

Para cada edge case encontrado, classifique:

| Nível | Significado | Ação |
|---|---|---|
| **MUST FIX** | Vai quebrar o `/discover-execute` ou produzir blueprint inválido | Editar o discovery plan e incorporar |
| **SHOULD TEST** | Improvável mas perigoso — adicionar checkpoint no halt-loop | Adicionar nota no plano sob "Halt-loop checkpoints" |
| **DOCUMENT** | Risco aceito conscientemente | Adicionar como ADR no plano |
| **IGNORE** | Teórico demais ou fix é pior que o problema | Não incluir no report |

### Passo 5 — Salvar o report

Salve o report em:

```
.claude/knowledge-base/reviews/{discovery-plan-slug}-edge-cases-{YYYY-MM-DD}.md
```

Crie o diretório `reviews/` se ainda não existir. O report serve como audit trail antes de `/discover-execute` rodar.

**Quem absorve os MUST FIX no discovery plan:** este skill NÃO edita `{slug}-plan.md`. O usuário humano lê o report e bumpa o plano de v1.0 para v1.1, incorporando cada MUST FIX (typically: refining research questions, adding methods, fixing reference paths). Em seguida invoca `/discover-execute` no plano revisado.

## Formato do Report

```markdown
# Discover Edge Case Review — {plano}

Data: YYYY-MM-DD
Discovery plan analisado: .claude/knowledge-base/discoveries/plans/{slug}-plan.md
Research questions analisadas: N
Edge cases encontrados: N (MUST FIX: N, SHOULD TEST: N, DOCUMENT: N)

## MUST FIX

### EC-{N}: {descrição curta}
- **Question afetada:** Q{N}
- **Família:** Reference path / Method / Interpretation / Dependency / Scope / Coverage / Citation
- **Cenário:** {como acontece durante o /discover-execute}
- **Impacto:** {o que quebra no blueprint}
- **Fix sugerido:** {≤1 frase de mudança no plano}

## SHOULD TEST

### EC-{N}: {descrição curta}
- **Question afetada:** Q{N}
- **Halt-loop checkpoint sugerido:** {assertion to add — ex: "antes de iterar para a próxima question, valide que o path X existe"}

## DOCUMENT

### EC-{N}: {descrição curta}
- **Risco aceito:** {por que é ok não tratar agora — ADR-style rationale}

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 | N | N | N | N |
| Q2 | N | N | N | N |

**Veredicto:** DISCOVERY PLAN OK / DISCOVERY PLAN PRECISA DE AJUSTE
```

## Anti-Patterns que Você NUNCA Comete

1. **Sugerir nova reference project** — "E se a gente também olhar Zep?" → NÃO. O plano já declarou escopo. Edge case é dentro do que foi planejado, não fora.

2. **Especulação sobre versões futuras** — "E se Mem0 mudar a API no próximo release?" → NÃO. Analise o plano contra o clone que EXISTE em `.claude/knowledge-base/references/`.

3. **Paranoia de citação** — "Precisamos verificar cada palavra em cada arquivo" → NÃO. Confie no plano; só flague se há claim verificável e errado.

4. **Scope creep** — "Já que estamos aqui, vamos também investigar..." → NÃO. Seu job é apontar edges, não adicionar questions.

5. **Complexidade disfarçada** — "Vamos adicionar retry + fallback + caching no halt-loop" → NÃO. Um único método claro + critério de parada resolve 90% dos casos.

## Integração

- Roda DEPOIS de `/discover-plan` ou quando alguém pede para revisar um discovery plan
- Esta skill analisa **discovery plans antes da execução**; para análise do blueprint produzido, use `/discover-confidence`
- Faz parte da chain inquebrável documentada em `/discover-plan` SKILL.md
