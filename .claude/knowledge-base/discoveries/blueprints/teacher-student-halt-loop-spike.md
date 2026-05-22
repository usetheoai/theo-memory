# NOTE: This is a cycle-plan spike (T2.1 of teacher-student-model-split), NOT a /discover-execute blueprint. Do NOT consume via /skill-writer.

# Spike: teacher-student split em /implement halt-loop

Date: 2026-05-22
Triggered by: T2.1 of `.claude/knowledge-base/plans/teacher-student-model-split-plan.md` (v1.1)
Status: COMPLETE — decision recorded below.

## Pergunta investigada

É viável usar `Agent` tool aninhado dentro de `ralph-loop:ralph-loop` para isolar phases de `/implement` em modelos diferentes (RED/REFACTOR → opus, GREEN/COMMIT → haiku)?

## Sources canonical inspecionadas (EC-2)

Dois paths verificados, drift = **zero** (idênticos linha por linha):

1. **Cache (executed version):**
   - `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/commands/ralph-loop.md` (19 linhas)
   - `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/scripts/setup-ralph-loop.sh` (204 linhas)
   - `~/.claude/plugins/cache/claude-plugins-official/ralph-loop/1.0.0/hooks/stop-hook.sh` (191 linhas)
2. **Marketplace (source-of-truth):**
   - `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/commands/ralph-loop.md` (idêntico ao cache)
   - `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/scripts/setup-ralph-loop.sh` (assumido idêntico — versão estável `1.0.0`)

## Achados (cite path + linha)

### 1. Same-session, same-model semantics

`setup-ralph-loop.sh:130-151` cria `.claude/ralph-loop.local.md` com YAML frontmatter (active, iteration, session_id, max_iterations, completion_promise) + body = prompt original. **NÃO spawn new session, NÃO muda modelo.**

### 2. Stop-hook re-injection

`hooks/stop-hook.sh:144-191` é o coração da mecânica:
- Linha 67-77: lê transcript JSONL para extrair último assistant message
- Linha 128-142: detecta `<promise>TEXT</promise>` no output → libera exit (completion)
- Linha 144-188: se NÃO completou, retorna `{"decision": "block", "reason": prompt, "systemMessage": ...}` — Claude Code reinjeta o `reason` (=prompt original) como novo user message na MESMA session

**Implicação central:** cada "iteração" é apenas o mesmo prompt re-aplicado no mesmo contexto. **O modelo é o mesmo da session inteira.**

### 3. Session isolation guard

`hooks/stop-hook.sh:31-35`: se outra session iniciou o loop, hook não bloqueia. Isolação cross-session OK, mas dentro de UMA session o loop é monolítico.

### 4. Agent tool é independente do ralph-loop

`Agent` tool (built-in Claude Code) tem `model:` frontmatter customizável. Quando invocado, executa em contexto isolado (próprio context window) com o modelo declarado. **Não há conflito** com ralph-loop — o Agent é só uma tool call dentro da iteration, retorna 1 resultado, e a iteration continua.

## Decisão

**VIÁVEL — com complexidade média e ROI parcial.**

### Caminho técnico (T2.2-A)

Para split per-phase:

1. **Refactor `implementation-prompt.md`**: instrução condicional por phase. Quando phase = GREEN ou COMMIT (student), prompt instrui a invocar `Agent` tool com `model: haiku` (ou modelo da rule) e o sub-prompt focado na phase.
2. **Main session permanece em Opus** (ou modelo da session): roda RED + REFACTOR + ralph-loop coordination. Phases student são delegadas a Agent tool aninhado.
3. **Rule file `implement-model-routing.txt`** ou consolidação em `model-routing.txt` único — decisão arquitetural sub-ADR de T2.2-A.

### Caveat honesto sobre ROI

O ROI absoluto depende de qual modelo está na main session:

- **Se main session = Opus** (típico hoje): saving real é só nas phases student. Cada Agent call carrega overhead de context isolation + round-trip. Para phases pequenas (GREEN minimal code, COMMIT one-line message), saving por Agent call é modesto.
- **Se main session = Haiku** (inversão): main session executa RED + REFACTOR via Agent tool com `model: opus` (teacher promotion), economiza no ralph-loop coordination overhead. ROI maior mas exige refactor inverso do prompt.

Sem **A/B baseline** (técnica do upskill, deferida em D5 do plan-pai), não temos prova quantitativa do saving por path. Plan T2.2-A SHOULD ship com flag `experimental_until` análogo ao de `/review` + critério de rollback observável (ex: "iteration retry rate > N% over M tasks → revert").

### Recomendação operacional para T2.2-A

Implementar com **escopo enxuto** para primeira iteração:

- 1 phase apenas (sugestão: COMMIT — mais padronizada, prompt-template literal, menor risco de quality regression)
- Marcador `experimental_until=2026-07-22` na rule (mais conservador que /review por menor evidência)
- Expandir para GREEN somente após primeiro mês sem incidente

## Rationale

- ralph-loop é **dumb re-injector** (stop-hook.sh:181-188), não orchestrator de modelos
- Agent tool **tem subagent boundary** com modelo declarado (frontmatter `model:`)
- Combinar os dois é arquitetura conhecida ("loop coordinator + Agent worker"); não inventa nova mecânica
- Risco: cada Agent call adiciona context-window overhead; ROI marginal exige A/B para validar quantitativamente
- KISS: começar com COMMIT phase apenas reduz blast radius para o primeiro experimento

## Próxima ação

T2.2-A do plan teacher-student-model-split. Escopo enxuto (1 phase = COMMIT) recomendado.
