# Edge Case Review — chat-with-memory-e2e-fixes

Data: 2026-05-30
Tasks analisadas: 5 (T0.1, T1.1, T1.2, T2.1, T3.1)
Edge cases encontrados: 11 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 6)

---

## MUST FIX

### EC-1: CHANGELOG.md não está nas "Files to edit" de nenhuma task

- **Task afetada:** T2.1 (mais natural — está dentro da fase de docs) OR Phase 3 (final)
- **Família:** State (audit trail)
- **Cenário:** O Global DoD lista "CHANGELOG.md updated under `[Unreleased]` § Changed" como obrigatório, mas nenhuma task lista `CHANGELOG.md` em `#### Files to edit`. O `/implement` halt-loop pode chegar ao fim com Phase 3 verde, README atualizado, e CHANGELOG sem entry — porque DoD não dispara halt automaticamente em itens fora de "Files to edit". Pre-existing footgun do template, mas crítico para v0.6.1 onde CHANGELOG é o contrato externo.
- **Impacto:** Audit trail incompleto. Próximo `/review` flag como F-xval (MINOR), mas pre-merge ninguém repara → ship com narrative gap.
- **Fix sugerido:** Adicionar `CHANGELOG.md — append entry under [Unreleased] § Changed citing the 4 commits + re-run verdict` em `#### Files to edit` da T2.1 (ou criar uma sub-task T2.2 dedicada). Inquebrável Rule 6 (changelogs obrigatórios).

### EC-2: `.next/` cache pode mascarar T0.1 + T1.1 na re-run da T3.1

- **Task afetada:** T3.1
- **Família:** State (build cache invalidation)
- **Cenário:** Durante o run de hoje que produziu a baseline NEEDS_FIXES, a primeira tentativa de `/api/info` retornou 404 porque `.next/` carregava artifacts de um build anterior que não conhecia a rota. O fix foi `find .next -mindepth 1 -delete` antes de re-spawnar `next dev`. Plan T3.1 § Tasks lista "Verify pre-conditions ... port 3000 free" mas NÃO lista cache-purge. Se o re-run pega `.next/` populado por um spawn pre-T0.1, os artifacts compilados da PRE-fix `theomemory-plugin.ts` continuam servindo → F3 cenário FAIL persiste mesmo com o código corrigido em disco.
- **Impacto:** Verdict falso-negativo (NEEDS_FIXES quando o código está OK), loop infinito de "por que não funcionou?".
- **Fix sugerido:** Adicionar passo 1.5 na T3.1 § Tasks: `find examples/chat-with-memory/.next -mindepth 1 -delete` (ou `rm -rf examples/chat-with-memory/.next`) ANTES da invocação `/test-chat-with-memory`. Documentar no Acceptance Criteria também.

---

## SHOULD TEST

### EC-3: `clusterThreshold: 0.6` pode ainda não ser suficiente para os 2 fixtures retry-helper

- **Task afetada:** T1.1 + T1.2 (atomic)
- **Família:** Boundary (empirical threshold tuning)
- **Cenário:** O plano cita "OpenAI text-embedding-3-small ... tipicamente 0.65-0.78" mas isso é estimativa de memória; nunca foi medido contra os 2 fixtures específicos do D4 (`retry fetch with backoff (D1 e2e)` + `axios-based retry with backoff (D4 e2e)`). Se o cosine real ficar abaixo de 0.6 (e.g., 0.55), D4 continua FAIL mesmo com a correção.
- **Teste sugerido:** No início da T1.1 § Tasks, adicionar um passo pre-coding: rodar um script ad-hoc (ou `evaluate_script` no Chrome MCP de uma sessão futura) que mede cosine empírico entre os 2 vectors via `await openai.embeddings.create(...)`. Persistir o valor medido em comentário no `route.ts` ao lado de `DEMO_DEFAULT_CLUSTER_THRESHOLD`. Se medido < 0.6, ajustar para `medido - 0.05`. Anchor evidence vs guess.

### EC-4: Zumbis de `next dev` em port 3000 (já vimos na sessão de hoje)

- **Task afetada:** T3.1 (pre-flight)
- **Família:** Resource (port contention)
- **Cenário:** Na sessão de hoje encontramos 2 processos `next dev` órfãos de uma execução anterior segurando port 3000. `lsof -ti:3000` reportava "free" porque rodava sem privilégio, mas Chrome via `next dev` warn "port 3000 in use, using 3002". O `/test-chat-with-memory` SKILL.md pre-flight checa `lsof -ti:3000` apenas — não detecta este caso. Re-run T3.1 pode bater no mesmo problema.
- **Teste sugerido:** No T3.1 § Tasks adicionar verificação ANTES de `/test-chat-with-memory`: `pgrep -af "next dev" || echo "no orphan"` — se houver match, `pkill -9 -f "next dev" && sleep 2`. Documentar no Acceptance Criteria.

### EC-5: `clusterThreshold: 0` ou `1` via request body — comportamento documentado mas não testado

- **Task afetada:** T1.1
- **Família:** Input (boundary values)
- **Cenário:** Plan Deep Dives diz "caller passes 0: would cluster everything together. Demo route allows it" e "caller passes 1.0: would only cluster perfectly-identical". Comportamento documentado mas não exercitado por nenhum cenário do `/test-chat-with-memory` (D4 usa default 0.6). Se um futuro contributor mexer na validação e quebrar inadvertidamente, ninguém repara.
- **Teste sugerido:** Adicionar mini-teste manual no Acceptance Criteria da T1.1: após implementar, fazer 2 fetches ad-hoc via Chrome MCP — `fetch('/api/skills/consolidate', POST, {repoId:'demo', clusterThreshold: 0})` e `... clusterThreshold: 1` — confirmar 200 em ambos (boundary aceito).

---

## DOCUMENT

### EC-6: Dev-server restart zera `globalThis._themory_demo_writeCounts`

- **Risco aceito:** Por design. `globalThis` é PROCESS-scoped, não survives `Ctrl+C` + `npm run dev` again. Mesma semântica do `_themory_demo_singleton` para memory; consistente. Não vale persistir em arquivo — é demo, contador de side-channel, sem valor cross-process. A README guidance da T2.1 já recomenda `ThresholdReflectionPolicy` para production (que persiste em pgvector). OK.

### EC-7: Production build (`next start`) também usa `globalThis` mas sem HMR pressure

- **Risco aceito:** Em `next start`, módulos não são HMR-reloaded → módulo-level Map TAMBÉM funcionaria. O fix é dev-mode-driven mas é correto em ambos paths (custo zero). README T2.1 não precisa detalhar — apenas mencionar "production-grade reflection counters live em `reflection_counters` table via `ThresholdReflectionPolicy`" basta.

### EC-8: Duas abas do browser com mesmo userId compartilham writeCounts

- **Risco aceito:** Comportamento esperado de demo (`userId` em localStorage; mesma origem = mesmo localStorage). Se usuário abre 3 tabs e cada uma manda mensagens, threshold dispara conforme soma global. Documentar não é necessário — natural behavior do tier-User.

### EC-9: Consolidate em repo com 0 ou 1 skill

- **Risco aceito:** Orquestrador já trata graciosamente (clusters size < 2 são dropped per `consolidate.ts:12-13` JSDoc). UI mostra "0 derived skill(s) produced from 0 source cluster(s)". OK.

### EC-10: OpenAI offline durante a re-run do T3.1

- **Risco aceito:** Skill `/test-chat-with-memory` pre-flight não verifica conectividade OpenAI — mas falhas seriam visíveis nos primeiros cenários (B1 enviaria mensagem e falharia em 30-60s). Aceitar: se OpenAI cair, re-run aborta cedo via timeout, e usuário humano sabe re-tentar depois. Não vale adicionar healthcheck dedicado.

### EC-11: Plan archive timing é ambíguo no Global DoD

- **Risco aceito:** Plan diz "archived ... after re-run confirms READY AND the working-tree demo commits are merged to `main`". Mas a branch atual `feat/v0-6-voyager-skill-library` carrega TANTO os commits v0.6.1 (voyager) QUANTO o demo expansion. Se o PR único merge essa branch, ambos os plans (voyager-skill-library-fixes-v0-6-1 + este) ficam prontos para archive no mesmo evento. Ambíguo mas não bloqueante: humano archiva ambos em um único commit `chore(audit)(plans): archive completed plans` após o merge para `main`. Documentar não é necessário no plano — é audit hygiene padrão.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 3 | 0 | 0 | 3 (EC-6, EC-7, EC-8) |
| T1.1 | 2 | 0 | 2 (EC-3, EC-5) | 1 (EC-9) |
| T1.2 | 1 | 0 | 1 (EC-3 compartilhado) | 0 |
| T2.1 | 1 | 1 (EC-1) | 0 | 0 |
| T3.1 | 4 | 1 (EC-2) | 1 (EC-4) | 2 (EC-10, EC-11) |
| **TOTAL** | **11** | **2** | **3** | **6** |

**Veredicto:** PLANO PRECISA DE AJUSTE

Os 2 MUST FIX (EC-1 CHANGELOG + EC-2 `.next/` cache) são absorções rápidas:

- **EC-1** — Adicionar `CHANGELOG.md` em `#### Files to edit` da T2.1 (1 linha).
- **EC-2** — Adicionar `rm -rf examples/chat-with-memory/.next` em T3.1 § Tasks como passo 1.5 + Acceptance Criteria (2 linhas).

Pós-absorção, bump plano para v1.1 e re-rodar `/plan-confidence` para confirmar SHIPPABLE.

Os 3 SHOULD TEST podem virar inline comments / pre-coding ad-hoc scripts (não exigem novas tasks). Os 6 DOCUMENT são audit-hygiene aceito conscientemente — sem ação no plano.

O plano permanece tecnicamente sólido: ADRs justificados, escopo restrito a `examples/`, zero churn em `src/`. Os edges encontrados são todos de tipo "footgun procedural durante execução", não falhas de design.
