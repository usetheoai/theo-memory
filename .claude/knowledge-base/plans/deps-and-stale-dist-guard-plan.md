---
slug: deps-and-stale-dist-guard
milestone_id: M20
created_at: 2026-07-25
goal: Zerar os 4 advisories de runtime (hono ×3 + node-server) e os 3 HIGH transitivos, e fazer `themory server` recusar iniciar com dist stale via erro tipado com teste negativo.
---

# Plan: deps-and-stale-dist-guard (M20 — #123, #118)

- **Version:** 1.0
- **Milestone:** M20 (`ROADMAP.md`) — theo-memory#123, #118.
- **Depends:** nenhuma.

## Goal

Duas entregas independentes: (a) **#123** — upgrade de `hono` (≥4.12.27) + `@hono/node-server` (≥2.0.5) resolvendo os 4 advisories de runtime, com a suíte de integração do servidor REST verde; os 3 HIGH transitivos (`brace-expansion` ×2, `js-yaml`) resolvidos por `pnpm.overrides`; `pnpm audit` antes/depois registrado. (b) **#118** — `themory server` recusa iniciar quando o `dist/` rodando é mais antigo que o `src/` (checkout de dev), com um erro tipado `StaleDistError` e mensagem acionável, provado por um teste de caso negativo que assevera o tipo e a mensagem.

Sucesso observável: `pnpm audit` pós-upgrade sem os 4 runtime advisories nem os 3 HIGH; suíte de integração do servidor REST verde; teste negativo `StaleDistError` verde.

## Baseline Context

HEAD `e26f20a` (v0.46.2 released, M19 [x]). Branch `develop`.

### Files that will be touched

| Arquivo | Papel |
|---|---|
| `packages/api/package.json` | `hono ^4.7.18` → `^4.12.32`; `@hono/node-server ^1.14.4` → `^2.0.11` |
| `package.json` | root `hono >=4.11.4` → `>=4.12.27`; `@hono/node-server ^1.13.0` → `^2.0.5`; `pnpm.overrides` += `brace-expansion`, `js-yaml` |
| `packages/cli/src/stale-dist-guard.ts` | (NEW) `assertDistNotStale()` + `StaleDistError` |
| `packages/cli/src/stale-dist-guard.test.ts` | (NEW) teste negativo do erro tipado |
| `packages/cli/src/run-server.ts` | chama `assertDistNotStale()` no início de `runServer()` |
| `packages/api/src/errors.ts` (ou cli/errors) | `StaleDistError` tipado (se houver módulo de erros do cli) |
| `docs/security/m20-audit.md` | (NEW) `pnpm audit` antes/depois |

### Current callers / dependents

- `runServer()` (`run-server.ts:112`) — caller de produção: `cli.ts` command `server` (`:233`). A guarda entra no topo de `runServer`.
- `hono`/`@hono/node-server` — consumidos por `packages/api` (`createServer`, `serve`). O bump de node-server 1.x→2.x é MAJOR (risco de breaking); o gate é a suíte de integração do servidor.

### Architecture boundaries affected

`stale-dist-guard.ts` é do cli (interface layer). Usa `node:fs`/`node:url` (stdlib, parsimony rung 2). `StaleDistError` é um erro tipado (Regra 8). Nenhuma fronteira DIP nova.

## Prior Art & Related Work

- (nenhuma patterns skill) — dep upgrade + guard.
- Interno: o padrão de erro tipado + teste negativo segue `error-handling.md` (fail-fast, typed) e `testing.md § 4.1` (negative case assevera o erro específico).

## Coverage Matrix

| # | Afirmação do Goal | Task(s) | Coberto? |
|---|---|---|---|
| C1 | hono + node-server upgraded, 4 runtime advisories resolvidos | T1.1 | sim |
| C2 | REST server integration suite verde pós-upgrade | T1.1 | sim |
| C3 | 3 HIGH transitivos resolvidos via overrides | T1.2 | sim |
| C4 | pnpm audit antes/depois registrado | T1.3 | sim |
| C5 | `themory server` recusa dist stale com StaleDistError tipado | T2.1 | sim |
| C6 | teste negativo assevera o tipo + mensagem | T2.1 | sim |

100% mapeado.

## Dependencies

### Existing — to upgrade

| Package | De | Para | Ecosystem | Why |
|---|---|---|---|---|
| `hono` | ^4.7.18 / >=4.11.4 | ^4.12.32 | npm | Corrige 3 advisories moderados de runtime (API-gateway drop, jsx context, JSX XSS); patched ≥4.12.27 |
| `@hono/node-server` | ^1.14.4 / ^1.13.0 | ^2.0.11 | npm | Corrige path-traversal em `serve`; patched ≥2.0.5 (major bump — gated pela suíte) |

### New — pnpm overrides (transitive security pins)

| Package | Version | Rule 9 rationale | Why |
|---|---|---|---|
| `brace-expansion` | `>=1.1.16` (override) | pin transitivo, não reimplementa nada | HIGH DoS; via `eslint>minimatch` (dev), não runtime — override força o patched |
| `js-yaml` | `>=4.3.0` (override) | pin transitivo | HIGH quadratic; via `@apidevtools/swagger-parser` — override força o patched |

### Removed

(none)

## ADRs

### D1 — node-server major bump gated pela suíte, allowlist como fallback

**Decisão:** subir `@hono/node-server` de 1.x para 2.x (major). Se a suíte de integração do servidor REST quebrar, o desfecho é reverter o node-server e allowlistar o advisory com sunset em vez de forçar o upgrade (o path-traversal é em `serveStatic`, que o produto não usa — allowlist justificável).

**Rationale:** o DoD do #123 diz "resolvidos por upgrade, com a suíte verde; se quebrar, allowlist com sunset". A suíte é o gate empírico (`testing.md § 2` — integração contra o boundary real). Major bump sem prova de não-quebra é risco (`architecture.md § 6`).

**Alternativas rejeitadas:**
- **Forçar 2.x mesmo quebrando.** Rejeitada: quebra o servidor em produção.
- **Ficar em 1.x + allowlist direto.** Rejeitada sem antes tentar o upgrade: o DoD prefere upgrade; allowlist é fallback.

### D2 — Guarda de stale-dist é no-op quando `src/` ausente (pacote publicado)

**Decisão:** `assertDistNotStale()` compara o mtime do dist rodando com o `src/` mais novo APENAS quando `src/` existe (checkout de dev/host-run). Num pacote publicado / imagem distroless (sem `src/`), é no-op — não há fonte para comparar.

**Rationale:** o bug (#118) é do host-run em dev, onde `dist/` obsoleto serve silenciosamente código pré-M13. Num deploy publicado não há `src/`, então a guarda não deve falso-positivar (`error-handling.md` — falhar só quando há erro real).

**Alternativas rejeitadas:**
- **Sempre exigir um manifesto de build.** Rejeitada: adiciona artefato/complexidade (YAGNI); o mtime de `src/` vs `dist/` é o sinal direto e suficiente.

## Phase 1 — Deps (#123)

### T1.1 — Upgrade hono + node-server; suíte de integração do servidor verde

#### Files to edit

- `packages/api/package.json`
- `package.json`

#### Deep file dependency analysis

`hono` + `@hono/node-server` são consumidos por `packages/api` (`createServer`, `serve` em `run-server.ts:280`). O node-server 2.x pode mudar a assinatura de `serve`. A suíte `tests/integration/auth/*` + os testes do servidor REST exercitam o boundary.

#### Why this step

**Ação:** bump das duas deps, `pnpm install`, rodar a suíte de integração do servidor. **Raciocínio:** resolve os 4 runtime advisories; o gate é a suíte (ADR D1).

#### TDD

RED: test_rest_server_integration_green_after_bump — a suíte de integração do servidor (`tests/integration/auth/lifecycle.test.ts` + server smoke) passa contra `ankane/pgvector:v0.5.1` real com hono 4.12.x + node-server 2.x. Se falhar, ADR D1 fallback.

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

Ver `## Failure scenarios`.

#### Acceptance criteria

- `pnpm install` sucede; hono ≥4.12.27, node-server ≥2.0.5 no lockfile.
- Suíte de integração do servidor REST verde.

#### DoD

- `pnpm audit` não lista os 3 hono moderate nem o node-server moderate.

### T1.2 — pnpm overrides para os 3 HIGH transitivos

#### Files to edit

- `package.json`

#### Deep file dependency analysis

`brace-expansion` (via `eslint>minimatch`, dev) e `js-yaml` (via `swagger-parser`). `pnpm.overrides` já existe com pins de segurança; adicionar os dois.

#### Why this step

**Ação:** adicionar `brace-expansion` + `js-yaml` a `pnpm.overrides`, `pnpm install`. **Raciocínio:** resolve os 3 HIGH sem esperar upstream (Regra 9 — pin transitivo, não reimplementa).

#### TDD

RED: test_no_high_advisories_after_overrides — `pnpm audit --json` pós-override não lista `brace-expansion` nem `js-yaml` como HIGH.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `pnpm audit` sem os 3 HIGH (brace-expansion ×2, js-yaml).

#### DoD

- Overrides no `package.json`; lockfile atualizado.

### T1.3 — Registrar pnpm audit antes/depois

#### Files to edit

- `docs/security/m20-audit.md` (NEW)

#### Deep file dependency analysis

Documento com o `pnpm audit` summary antes (6 high, 9 moderate) e depois (esperado: sem os 4 runtime + 3 HIGH).

#### Why this step

**Ação:** capturar antes/depois. **Raciocínio:** DoD explícito do #123.

#### TDD

RED: test_audit_doc_records_before_after — sentinela: o doc contém o summary antes e depois.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `docs/security/m20-audit.md` com antes/depois.

#### DoD

- Doc committed.

## Phase 2 — Stale-dist guard (#118)

### T2.1 — `assertDistNotStale()` + `StaleDistError` + wiring + teste negativo

#### Files to edit

- `packages/cli/src/stale-dist-guard.ts` (NEW)
- `packages/cli/src/stale-dist-guard.test.ts` (NEW)
- `packages/cli/src/run-server.ts`

#### Deep file dependency analysis

`assertDistNotStale()` usa `fileURLToPath(import.meta.url)` para achar o dist rodando, sobe até a raiz do pacote (procura `package.json`), e se `src/` existe compara o mtime mais novo de `src/**/*.ts` com o do dist. `StaleDistError` (extends Error, `name='StaleDistError'`). `runServer()` (`run-server.ts:112`) chama no topo; um throw impede o boot.

#### Why this step

**Ação:** implementar a guarda + erro tipado, wire em `runServer`, teste negativo. **Raciocínio:** #118 — dist stale servindo silenciosamente é o bug; falhar-alto com erro acionável (`error-handling.md`). Cita ADR D2 (no-op sem src).

#### TDD

RED: test_stale_dist_throws_typed_error — dado um dir temp com `dist/x.js` (mtime antigo) e `src/y.ts` (mtime novo), `assertDistNotStale(distPath, srcRoot)` lança `StaleDistError` com mensagem contendo "pnpm build". `expect(() => ...).toThrow(StaleDistError)`.

RED: test_fresh_dist_does_not_throw — dist mais novo que src → não lança.

RED: test_no_src_is_noop — sem `src/` (pacote publicado) → não lança (ADR D2).

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

Ver `## Failure scenarios`.

#### Acceptance criteria

- `assertDistNotStale` lança `StaleDistError` tipado quando dist < src; no-op sem src.
- `runServer` chama a guarda antes de bind.
- Teste negativo assevera o TIPO + a mensagem (não só "throws").

#### DoD

- `npm test -- stale-dist-guard` exit 0; `npm run typecheck` exit 0.

## Failure scenarios

| Cenário | Comportamento esperado |
|---|---|
| node-server 2.x muda a assinatura de `serve` e quebra o boot | A suíte de integração do servidor FALHA (o gate) → ADR D1 fallback: reverter node-server, allowlist o advisory com sunset. |
| `src/` presente mas ilegível (permissão) | `assertDistNotStale` trata como no-op (não pode comparar) — não bloqueia o boot por um erro de I/O da própria guarda (fail-open na guarda, não no produto). |
| dist e src com mtime idêntico | Não-stale (só `src > dist` é stale) — sem falso-positivo. |

## Drawbacks & Risks

| Risco | Por que é real | Mitigação |
|---|---|---|
| node-server major bump quebra o servidor REST | 1.x→2.x é major, pode mudar `serve` | Suíte de integração é o gate; ADR D1 fallback para allowlist |
| Guarda de stale-dist falso-positiva em CI/deploy | mtime pode variar por checkout/cache | ADR D2: no-op sem `src/`; só `src > dist` bloqueia; fail-open em erro de I/O da guarda |
| Overrides transitivos quebram build de dev | forçar brace-expansion/js-yaml pode conflitar | `pnpm install` + suíte inteira é o gate; ambos são patches semver-compatíveis |

## Unresolved Questions

(none — every decision resolved at plan time.)

## Test Plan

- **Unidade:** `stale-dist-guard.test.ts` — 3 casos (stale throws typed, fresh no-op, no-src no-op), em ms.
- **Integração:** suíte do servidor REST verde pós-bump contra pg real.
- **Auditoria:** `pnpm audit` antes/depois.

## Critical paths

- `packages/cli/src/run-server.ts`
- `packages/cli/src/stale-dist-guard.ts`

## Global Definition of Done

- hono ≥4.12.27, node-server ≥2.0.5; `pnpm audit` sem os 4 runtime nem os 3 HIGH.
- Suíte de integração do servidor REST verde.
- `StaleDistError` tipado + teste negativo verde; `runServer` wired.
- `docs/security/m20-audit.md` antes/depois.
- `/code-quality` PASS; `/review` READY_TO_MERGE.

## Final Phase: Integration Validation

`run_validation.py deps-and-stale-dist-guard` → `/code-quality` → `/review`. Não completo até `pnpm audit` limpo dos alvos + suíte verde + teste negativo verde.
