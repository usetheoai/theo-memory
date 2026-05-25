# Edge Case Review — discover-web-v0-1

Data: 2026-05-25
Plano analisado: `.claude/knowledge-base/plans/discover-web-v0-1-plan.md` (v1.0)
Tasks analisadas: 14 (T0.1, T1.1-T1.3, T2.1-T2.3, T3.1-T3.2, T4.1, T5.1-T5.2, T6.1-T6.2)
Edge cases encontrados: 15 (MUST FIX: 8, SHOULD TEST: 5, DOCUMENT: 2)

## MUST FIX

### EC-1: `URL_CITATION_RE` captura caracteres trailing de markdown link
- **Task afetada:** T2.1
- **Família:** Format
- **Cenário:** Blueprint com `[Mem0 paper](https://arxiv.org/abs/2304.03442)` faz a regex `https?://[^\s)>\"\\]+` parar antes do `)` por causa do char-class exclusion. ✓ Mas e o caso `cite: https://arxiv.org/abs/2304.03442.` (URL no final de frase)? A regex inclui `.` no match porque `.` não está no exclusion set. Resultado: sha256 calculado com `.` no fim → snapshot file não bate.
- **Impacto:** False-positive `snapshot_missing_or_corrupt` em URLs perfeitamente válidas. Cada falso positivo bloqueia o plan no INVALID band (49).
- **Fix sugerido:** Adicionar passo explícito de post-strip — `url.rstrip('.,;!?')` antes de qualquer hash/lookup. Adicionar caso de teste `test_url_strips_trailing_sentence_punctuation`. O plano já menciona "Strips trailing `.`, `,`, `)`, `]`" em passing — promover a regra explícita no código + teste.

### EC-2: Convenção sha256 vs formato real do snapshot file é ambígua
- **Task afetada:** T2.1, ADR D1
- **Família:** Format
- **Cenário:** D1 declara `sha256 = sha256(f"{url}\n---\n{content}")`. Mas o snapshot file v0-3 real é:
  ```
  # Snapshot: {url}
  ---
  **Source:** WebFetch 2026-05-23 (allowlisted domain X)

  {fetched-content}
  ```
  Para re-validar o hash a partir do file, é preciso strippar `# Snapshot:` + `---` + `**Source:**` + linha em branco. Quantas linhas? Qual o separator exato? Se body extraction errar por 1 caractere, sha256 falha.
- **Impacto:** Re-validação de snapshots existentes (v0-3 já tem 4 commitados) pode falhar mesmo quando o snapshot está correto. Quebra backward compat com snapshots que foram escritos antes do checker existir.
- **Fix sugerido:** D1 deve declarar **explicitamente** o algoritmo de body extraction:
  ```python
  def _extract_snapshot_body(file_content: str, url: str) -> str:
      expected_header = f"# Snapshot: {url}\n---\n"
      if not file_content.startswith(expected_header):
          raise ValueError("snapshot header malformed")
      after_header = file_content[len(expected_header):]
      # Skip the **Source:** line (1 line) + 1 blank line separator
      lines = after_header.split('\n', 2)
      return lines[2] if len(lines) >= 3 else ''
  ```
  E re-confirmar: sha256 é sobre `{url}\n---\n{body}` (não inclui `**Source:**` linha). Adicionar test fixture com snapshot real do v0-3 + assertar hash bate.

### EC-3: `--check-urls-live` sem timeout total budget pode travar CI
- **Task afetada:** T2.1
- **Família:** Resource / Timing
- **Cenário:** `urllib.request.urlopen(url, timeout=5)` aplica timeout por OP de socket, mas DNS resolution pode adicionar até 60s. Blueprint com 10 URLs off-allowlist `--check-urls-live` em CI offline = 10 × 60s = 10min de hang.
- **Impacto:** CI hang silencioso; review-time spot-check vira blocker.
- **Fix sugerido:** Adicionar total-budget cap no checker: máximo 30s combinados para todas URLs no `--check-urls-live` mode; URLs além do budget → `soft_floor_url_unreachable` com reason="time-budget-exceeded". Usar `signal.SIGALRM` ou `concurrent.futures` com timeout total.

### EC-4: T2.2 quebra blueprints v0-3 existentes silenciosamente (breaking change não-mitigado)
- **Task afetada:** T2.2 (e indiretamente T0.1, Phase 0)
- **Família:** State / Backward compat
- **Cenário:** Plan menciona em Deep Dives "blueprints que predam v1.1 podem adicionar `<!-- DEFER-CORNER: prior_art -->` para passar", mas isso NÃO está como sub-task de T2.2 nem como verificação em T0.1. Se existe `.claude/knowledge-base/discoveries/blueprints/v0-3-agent-tools-mcp-blueprint.md` (precisa verificar), após T2.2 ele começa a emitir `empty_corner_prior_art` silenciosamente.
- **Impacto:** Confidence score de blueprint legítimo cai de SHIPPABLE para INVALID sem code-defect. Confusão downstream.
- **Fix sugerido:** Adicionar sub-tarefa explícita em T0.1: `find .claude/knowledge-base/discoveries/blueprints -name "*.md" -exec grep -L "prior_art\|DEFER-CORNER: prior_art" {} \;` → lista blueprints afetados. Em T2.2 (ou novo T2.4), inserir DEFER-CORNER marker nesses blueprints com rationale `"predates v1.1 — predates the prior_art corner; no retroactive web research scheduled"`.

### EC-5: T3.2 não cita explicitamente o file-referenced pattern do loop-engine-convention.md
- **Task afetada:** T3.2
- **Família:** Integration / Format
- **Cenário:** Plan diz "Add 7-step protocol to halt-loop driver prompt" sem reforçar que o prompt vai para o **arquivo** (.claude/halt-loop-prompts/) e o ralph-loop arg é só um POINTER curto. O 7-step inclui código bash (`grep` no allowlist) que se for inlined no ralph-loop positional arg, quebra parsing per `loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely`.
- **Impacto:** Primeira invocação de `/discover-execute` com prior_art question pode bash-parse-error no startup do halt-loop. Regressão observada anteriormente em /implement v0.3 (per loop-engine-convention.md).
- **Fix sugerido:** Adicionar 1-line callout em T3.2 Deep Dives: "O 7-step protocol DEVE ser escrito em `.claude/skills/discover-execute/prompts/{name}-prompt.md` (file-referenced pattern); o ralph-loop arg invocado por `/discover-execute` SKILL.md deve seguir o padrão `Read .claude/halt-loop-prompts/discover-execute-{slug}.md and follow its instructions for this halt-loop iteration.` per `loop-engine-convention.md`."

### EC-6: BLOCKED marker pode corromper blueprint se URL aparece em code fence
- **Task afetada:** T4.1
- **Família:** Format
- **Cenário:** Blueprint pode ter exemplo de uso em `` ```bash `` ou `` ```python `` mostrando uma URL fake como didática. Ex: ` ```bash\ncurl https://example.com/api\n``` `. Se essa URL trigger uma cap (off-allowlist), apply_fixes insere `<!-- BLOCKED: ... -->` acima da linha — DENTRO do code fence — comment HTML vira código visível que quebra render markdown E pode quebrar a sintaxe da linguagem (bash não tem comentário HTML).
- **Impacto:** Blueprint markdown vira inválido; render quebra; iteração subsequente do halt-loop pode tropeçar.
- **Fix sugerido:** Em `apply_fixes.py`, walk fences ANTES de aplicar markers: detectar `` ``` `` blocks; skip URL citations dentro deles (URLs em code fences são documentação, não asserção). Adicionar caso de teste `test_url_in_code_fence_does_not_get_blocked_marker`.

### EC-7: T0.1 assertion `grep -c "YOUR_ADR_REF" == 4` falha confusamente em estado parcial
- **Task afetada:** T0.1
- **Família:** State
- **Cenário:** Se alguém entre o /to-plan e o /implement já substituiu 2 dos 4 placeholders (mão), grep retorna 2 — não 0 nem 4. T0.1 falha com "expected 4, got 2". Implementer fica confuso: "fix está pronto? ou pra fazer?".
- **Impacto:** Halt loop bloqueia em ambiguidade; debug demora.
- **Fix sugerido:** T0.1 deve aceitar 0 OU 4 (estado limpo): `assert count in (0, 4), f"partial state — found {count} placeholders, expected 0 (done) or 4 (pending)"`. Em estado 4 → procede com T1.3. Em estado 0 → log "T1.3 already done; skipping".

### EC-8: 7-step protocol não inclui `mkdir -p` antes do snapshot write
- **Task afetada:** T3.2
- **Família:** State / Resource
- **Cenário:** Primeiro snapshot para um novo slug. Path `.claude/knowledge-base/discoveries/snapshots/{slug}/` não existe. Write falha com `FileNotFoundError`.
- **Impacto:** Halt-loop quebra na primeira citação web do primeiro discovery após v0.3.
- **Fix sugerido:** Adicionar passo 6.5 no 7-step protocol em T3.2: "Garanta que o dir existe via `Bash mkdir -p .claude/knowledge-base/discoveries/snapshots/{slug}/` ANTES do write." Operação é idempotente. 1 linha.

## SHOULD TEST

### EC-9: URLs com query string + fragment geram hashes diferentes
- **Task afetada:** T2.1
- **Teste sugerido:** `test_url_with_query_string_hashes_differently_from_bare_url` — assertar que `https://arxiv.org/abs/x?source=foo` produz sha256 diferente de `https://arxiv.org/abs/x`. Documenta o comportamento intencional (URL é parte do hash); previne refactor futuro de "normalizar URLs antes do hash".

### EC-10: URLs com trailing slash variation
- **Task afetada:** T2.1
- **Teste sugerido:** `test_url_trailing_slash_hashes_differently` — `https://arxiv.org/abs/x` vs `https://arxiv.org/abs/x/`. Documenta + faz reviewer pensar 1 vez sobre canonicalização (decidir: NÃO canonicalizar, é parte do contrato de honestidade).

### EC-11: Consumo de tokens por prior_art question pode exceder +30k estimado
- **Task afetada:** T3.2, T5.1
- **Teste sugerido:** Após T6.1 passar, rodar `/discover-execute` num fixture plan com 1 prior_art question + medir tokens via Claude Code session log. Documentar deviação no commit body. Se >50k consistentemente, ajustar token-budget.md para banda mais larga.

### EC-12: Smoke test não assertia "URL válida foi contada como citação válida"
- **Task afetada:** T6.1
- **Teste sugerido:** `test_mixed_blueprint_valid_url_counted_in_metrics` — assertar `result["url_citations_total"] == 3`, `result["url_citations_allowlisted"] == 2`, `result["url_citations_snapshotted"] == 1`. Cobre positive case além dos negative.

### EC-13: Allowlist file com CRLF line endings (Windows checkout)
- **Task afetada:** T2.1
- **Teste sugerido:** `test_load_allowlist_strips_cr_line_endings` — fixture com `arxiv.org\r\n` no allowlist; lookup `arxiv.org` deve match. Implementer aplica `.strip()` em cada linha no loader (1 char no código). Sem teste, bug aparece só em desenvolver Windows.

## DOCUMENT

### EC-14: Snapshot file > 50KB tem sha256 O(n) — não-issue em prática
- **Task afetada:** T2.1
- **Risco aceito:** Snapshot files são texto markdown puro; vendor docs maior visto = ~30KB no v0-3 (MCP spec). sha256 a 30KB roda em <5ms em Python. Mesmo a 500KB seria <50ms. Não vale otimizar; documentar como aceito.

### EC-15: `discover-plan-confidence` skill referenciada como "may not exist yet"
- **Task afetada:** T1.1 (Deep file dependency analysis)
- **Risco aceito:** Plan honestamente nota: "File is referenced by `.claude/skills/discover-plan-confidence/SKILL.md` (sibling skill — note this file mentions it may not exist yet; verify)". Se essa skill não existe, o `discover-plan-golden-rule.md` ainda é load-bearing para `check_reference_citations.py` (que SIM existe, no `discover-confidence`). Gap real só se discover-plan-confidence nunca for shipped — neste caso o golden rule pertence semanticamente a `discover-blueprint-golden-rule.md` (que é o que esse plan extends de qualquer jeito). Não é blocker; acknowledge como dívida potencial.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 1 (EC-7) | 0 | 0 |
| T1.1 | 1 | 0 | 0 | 1 (EC-15) |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 0 | 0 | 0 | 0 |
| T2.1 | 7 | 3 (EC-1, EC-2, EC-3) | 3 (EC-9, EC-10, EC-13) | 1 (EC-14) |
| T2.2 | 1 | 1 (EC-4) | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 3 | 2 (EC-5, EC-8) | 1 (EC-11) | 0 |
| T4.1 | 1 | 1 (EC-6) | 0 | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| T5.2 | 0 | 0 | 0 | 0 |
| T6.1 | 1 | 0 | 1 (EC-12) | 0 |
| T6.2 | 0 | 0 | 0 | 0 |
| **TOTAL** | **15** | **8** | **5** | **2** |

**Veredicto:** PLANO PRECISA DE AJUSTE

8 MUST FIX é volume significativo, com 3 deles (EC-1, EC-2, EC-6) concentrados em format/parsing — área onde bugs silenciosos custam mais (false positives bloqueiam confidence, false negatives deixam fabricação passar). EC-4 (breaking change em blueprints existentes) é especialmente alto-risco se não tratado: post-merge, blueprint legítimo do v0-3 começa falhando sem explicação óbvia.

**Recomendação ao usuário (humano absorbe os MUST FIX):**

1. Bumpar plano v1.0 → v1.1 incorporando:
   - **EC-1, EC-9, EC-10, EC-13** em T2.1 (1 helper `_canonicalize_url` + 3 testes adicionais)
   - **EC-2** em ADR D1 (especificar `_extract_snapshot_body` explicitamente)
   - **EC-3** em T2.1 (total timeout budget para --check-urls-live)
   - **EC-4** em T0.1 + nova sub-task T2.2.5 (audit existing blueprints + insert DEFER-CORNER)
   - **EC-5** em T3.2 Deep Dives (file-referenced pattern callout)
   - **EC-6** em T4.1 (code-fence skip logic + test)
   - **EC-7** em T0.1 (accept 0 OR 4 placeholders)
   - **EC-8** em T3.2 (mkdir -p step 6.5)
2. Adicionar **EC-11, EC-12** como SHOULD TEST nas DoDs dos tasks correspondentes (teste obrigatório, sem mudar escopo de implementação)
3. **EC-14, EC-15** ficam como nota em Context ou ADR D1 (riscos aceitos documentados)

Após absorção: re-rodar `/plan-confidence discover-web-v0-1` no plano v1.1.
