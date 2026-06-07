# Discover Edge Case Review — theo-memory-faang-auth-lifecycle

Data: 2026-06-07
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/theo-memory-faang-auth-lifecycle-plan.md` (v1.0)
Research questions analisadas: 9 (Q1, Q2, Q3, Q4, Q5, Q7, Q8, Q-deps-1, Q-tests-1)
Edge cases encontrados: **10 (MUST FIX: 5, SHOULD TEST: 3, DOCUMENT: 2)**

## MUST FIX

### EC-1: Q1 cita `posthog/models/personal_api_key.py` sem verificação prévia do path
- **Question afetada:** Q1 (token model)
- **Família:** Citation / Reference
- **Cenário:** Durante `/discover-execute`, Fase B tenta `WebFetch raw.githubusercontent.com/PostHog/posthog/.../posthog/models/personal_api_key.py` e recebe 404 porque o repo PostHog tem outra organização de pastas (modelo pode estar em `ee/models/`, `frontend/.../personalAPIKey.ts`, ou renomeado). Resultado: question marca BLOCKED por reason errada ("path not found") em vez de seguir uma busca lateral, perdendo a resposta legítima.
- **Impacto:** Q1 row "PostHog" fica vazio no verdict matrix, derrubando "Cross-cutting comparison table populated" do Objective. Cai em SHIPPABLE_WITH_CAVEATS evitável.
- **Fix sugerido:** Trocar "Read PostHog source file via github.com `posthog/posthog` `posthog/models/personal_api_key.py`" por "Search github.com `PostHog/posthog` for `personal_api_key` to LOCATE the canonical file, THEN Read". Idem para qualquer hard-coded path não-verificado.

### EC-2: Q2 não distingue GitHub PAT classic vs fine-grained — dois sistemas com vocabulários diferentes
- **Question afetada:** Q2 (scope vocabulary)
- **Família:** Interpretation
- **Cenário:** GitHub PAT ships hoje em DUAS variantes (classic com scopes legacy `repo`/`gist`/`admin:org` + fine-grained com `contents:read`/`contents:write`/`metadata:read`). Q2 fala genericamente "docs.github.com PAT scopes reference". `/discover-execute` pode citar apenas uma variante e perder a comparação relevante (classic = broad role, fine-grained = resource:verb — exatamente a tensão que estamos investigando).
- **Impacto:** Resposta Q2 incompleta; conclusão sobre "granularity convention" fica enviesada. Verdict matrix Q2 × GitHub fica simplista.
- **Fix sugerido:** Adicionar sub-questions explícitas Q2a (classic PAT scope vocabulary) + Q2b (fine-grained PAT permissions vocabulary) com WebFetch separado para cada doc page.

### EC-3: Q3 cita 4 source paths hard-coded sem verificação para Supabase/PostHog/Cal.com/Plausible
- **Question afetada:** Q3 (OSS lifecycle parity)
- **Família:** Citation / Reference
- **Cenário:** Mesma classe de EC-1 mas em escala 4×. Paths citados (`supabase/supabase/apps/studio/...`, `PostHog/posthog/frontend/.../personalAPIKeysLogic.ts`, `calcom/cal.com/packages/.../apiKeys.tsx`, `plausible/analytics/lib/plausible_web/api/...`) são placeholders — Supabase apps/studio recentemente foi reestruturada, Cal.com move arquivos a cada release. Probabilidade alta de 1+ path 404 em `/discover-execute`.
- **Impacto:** Q3 vira 4× tentativa de fetch que falha → time-budget de 10 min consumido só em retries → Q3 row no verdict matrix fica majoritariamente BLOCKED, comprometendo o coração da investigação (lifecycle parity é a thesis central).
- **Fix sugerido:** Substituir todos os 4 paths por "github.com search per repo (e.g., `repo:supabase/supabase \"personal_access_token\" path:**/api-keys/`) to LOCATE, then Read". Documentar no Fase B column explicitamente "no hard-coded paths — locate first".

### EC-4: Q-tests-1 cita `supabase/auth/internal/api/token_test.go` — Supabase renomeou GoTrue → auth recentemente
- **Question afetada:** Q-tests-1
- **Família:** Reference / Repo move
- **Cenário:** Supabase renomeou o repo `supabase/gotrue` → `supabase/auth` em 2024, e a estrutura interna mudou. Path citado `internal/api/token_test.go` é plausível mas não verificado. Se inexistente, Q-tests-1 fica BLOCKED por path errado em vez de captura honesta da rotação-pattern.
- **Impacto:** Tests corner fica BLOCKED → halt-loop checkpoint "all 4 canonical corners ≥ 1 non-BLOCKED" pode disparar `BLUEPRINT_BLOCKED`, exigindo iteração extra.
- **Fix sugerido:** Trocar por "Search github.com `supabase/auth` for `*token_test*` OR `*refresh_test*` to LOCATE the rotation test file, then Read". Adicionar fallback explicit "se Supabase auth não tem .go test relevante, fallback para `supabase-community/auth-py` ou Cal.com auth tests".

### EC-5: Q5 budget de 6 min cobre 4 fontes + 2 compliance frameworks — too tight
- **Question afetada:** Q5 (audit log + rate-limit combined)
- **Família:** Time / Scope
- **Cenário:** Q5 foi resultado da colapsação Q5+Q6 (audit log + rate-limit) mas o budget permaneceu em 6 min (anterior ao merge). 4 fontes (Supabase + PostHog + Stripe + SOC2/GDPR) × 2 verticais (audit, rate-limit) = 8 WebFetches mínimas, em 6 min → 45s cada, abaixo do realista para WebFetch + parsing. Risk alto de BLOCKED por "budget exhausted" deixando Camada 4 documentação incompleta.
- **Impacto:** Cloud-repo follow-up plan (D4) fica sem reference shape suficiente; FAANG-completeness narrative perde substância.
- **Fix sugerido:** Bumpar Q5 budget de 6 min → 12 min. Compensar tirando 2 min de Q7 (6→4 — Q7 é mais focado) e 4 min de Q-deps-1 (8 min implícitos ao distribuir os 60 total entre 9 questions — recortar para 4 min porque npmjs.com pages são quick). Re-tally total: ainda ≤ 60 min.

## SHOULD TEST

### EC-6: Halt-loop checkpoint — pre-Fase-B path-existence validation
- **Question afetada:** Cross-cutting (Q1, Q3, Q4, Q7, Q-tests-1, Q-deps-1)
- **Halt-loop checkpoint sugerido:** Antes de Fase B de cada question que cita um github.com path, validar que o URL retorna HTTP 200 via `WebFetch HEAD` (ou GET com `--silent --output /dev/null --write-out '%{http_code}'`). Se 404 → caminho lateral declarado (search-then-locate) OU BLOCKED honesto sem padding.

### EC-7: Q7 docs.github.com partner-program pode requerer login (admin-only docs)
- **Question afetada:** Q7 (secret scanning)
- **Halt-loop checkpoint sugerido:** Detectar resposta 401/403 OR redirect-to-login na primeira WebFetch a docs.github.com partner-program. Se gated → mark Q7 sub-claim "registration procedure" BLOCKED com reason "docs.github.com partner-program requires login"; fallback para `github.com/github/secret_scanning_partner_demo` README (público) E para o public Partner Program announcement post na GitHub blog (allowlist needs github.blog if not already).

### EC-8: D5-supplement custom corners podem disparar `empty_corner_*` no check_research_coverage.py
- **Question afetada:** Cross-cutting (Q3 integration_patterns + Q4 protocols)
- **Halt-loop checkpoint sugerido:** Antes de emitir `<promise>BLUEPRINT_COMPLETE</promise>`, verificar com `check_research_coverage.py --dry-run` que apenas os 4 canônicos (tests/deps/tools/techniques) são contados pelo checker e que cada um tem ≥ 1 question. Custom corners (integration_patterns, protocols) DEVEM ser additivos e NÃO devem subtrair do canonical count. Se o checker exigir Q3 (integration_patterns) OR Q4 (protocols) re-classificados como `techniques`, fazer a re-classificação manualmente sem retoque no Coverage Matrix table (preserva semantic clarity).

## DOCUMENT

### EC-9: SOC2 Type II spec text está em paywall (AICPA) — honest BLOCKED é o caminho certo
- **Risco aceito:** Q5 sub-claim "SOC2 mandates" será BLOCKED por paywall. A versão pública mais próxima é a SOC2 Common Criteria 6.1 referida em blogs (não-allowlisted). Aceitar: usar **GDPR Article 30** como anchor compliance reference (publicamente disponível via eur-lex; allowlist precisa de eur-lex.europa.eu SE for usar — alternativamente usar paráfrase via aclanthology ou citar RFC equivalents). Camada 4 cloud plan absorve a SOC2 specificity (cloud team tem acesso ao AICPA via vendor). ADR-style: NÃO fabricar citação SOC2; declarar limitation honestamente na blueprint.

### EC-10: Q4 supersession-path (D6) depende de Fase B realmente completar
- **Risco aceito:** Se Q4 (OIDC bridge) ficar BLOCKED por RFC parse timeout (RFCs 8693 + 7662 + 6749 são longos), a recomendação D6 "may supersede ADR-0009" não pode ser emitida. Caminho ADR-style: nesse caso ADR-0009 fica unchanged + Camada 3 OIDC bridge ships preservando o "OAuth deferred to v1.x" status quo de ADR-0009. Documentar no blueprint que D6 é CONDITIONAL on Q4 completion.

## Resumo

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------|----------|-------------|----------|
| Q1 | 1 | 1 | 0 | 0 |
| Q2 | 1 | 1 | 0 | 0 |
| Q3 | 1 | 1 | 0 | 0 |
| Q4 | 1 | 0 | 0 | 1 |
| Q5 | 2 | 1 | 0 | 1 |
| Q7 | 1 | 0 | 1 | 0 |
| Q8 | 0 | 0 | 0 | 0 |
| Q-deps-1 | 0 | 0 | 0 | 0 |
| Q-tests-1 | 1 | 1 | 0 | 0 |
| Cross-cutting | 3 | 0 | 2 | 0 |
| **TOTAL** | **10** | **5** | **3** | **2** |

**Veredicto: DISCOVERY PLAN PRECISA DE AJUSTE**

5 MUST FIX bloqueiam `/discover-execute` em sua forma atual. Recomendação: bumpar o plano de v1.0 para v1.1 absorvendo:

1. **EC-1 + EC-3 + EC-4** (mesma família — paths hard-coded sem verify): converter todos os "Read github.com `repo/path/file.ext`" em "Search github.com `repo` for `<symbol>` to LOCATE, then Read". Pattern único aplicado em ~5 cells da tabela Q×Method.
2. **EC-2**: split Q2 em Q2a + Q2b para classic-vs-fine-grained PAT.
3. **EC-5**: re-balancear time-budget (Q5: 6→12 min, Q7: 6→4 min, Q-deps-1: 8→4 min).
4. SHOULD TEST (EC-6, EC-7, EC-8): adicionar 3 bullets na seção `## Halt-loop checkpoints` do plano.
5. DOCUMENT (EC-9, EC-10): adicionar 2 entries na seção `## ADRs` como ADR D7 (SOC2 paywall fallback) + ADR D8 (D6 supersession conditional on Q4).

Após v1.1: re-rodar `/discover-plan-confidence` e prosseguir para `/discover-execute` quando verdict ≥ SHIPPABLE_WITH_CAVEATS.
