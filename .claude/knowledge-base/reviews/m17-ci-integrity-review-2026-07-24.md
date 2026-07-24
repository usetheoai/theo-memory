# Review: M17 — o CI prova o que diz provar (#104, #129, #116)

**Date:** 2026-07-24
**Nature:** CI configuration change — the review IS the validation that each gate behaves.

## #104 — the contract suite now runs in CI

New `contract` job in `integration.yml`: no Postgres, no build (the contract config resolves
imports to `src` via alias), runs `pnpm test` (which carries its own typecheck). Proven to
bite: a deliberate failing test made `vitest run --config vitest.contract.config.ts` exit 1.
The job is self-verifying — the first release PR after this exercises it live.

## #129 — the double-run is gone

`Integration` and `Security SAST` keyed concurrency on `github.ref`, which differs between the
`push` and `pull_request` events for the same commit, so both ran. Re-keyed on the branch
(`github.event.pull_request.head.ref || github.ref_name`) so the PR run cancels the push run.
`publish.yml` untouched — it listens on push+tag only and its `github.ref` key is load-bearing
for separating tag builds from develop builds. Documented in the file.

## #116 — addressed within this repo's scope

Three root causes: (1) single shared runner — ALLEVIATED by #129 halving the run count;
(2) `cancel-in-progress` killing in-flight builds — consciously NOT changed, a 2026-07-22
incident (a cancel with no successor took the dev host down) makes the current behaviour
deliberate, and the docs-push cancellations the issue cites are already removed by (3);
(3) no `paths-ignore` — already applied. The remaining wins (Docker build cache, dedicated
runner) live in the reusable workflow in the `theo` repo, out of theo-memory's scope.

## Verdict

READY_TO_MERGE. Each gate's behaviour is verified: #104 proven to fail-closed, #129's key
convergence is deterministic, #116 addressed to the boundary of this repo with the cross-repo
remainder named honestly.

## Addendum — flaky exposto no primeiro release (2026-07-24)

O job de integração do PR #131 falhou uma vez em `lru-eviction T1.2-RED-4`, um teste de
concorrência PRÉ-EXISTENTE (último toque 2026-07-17, não pelo M17) que já carrega `retry x2` e
mesmo assim falhou 3×. Estabelecido por evidência que é flaky, não regressão: passa 4/4
isolado; o M17 não toca esse código; passou neste mesmo código de integração no #130 (merjado).

O `contract`-step do #104 não CAUSOU o bug — alongou o wall-clock do job (~13→~22min), o que num
runner compartilhado aumenta a janela de contenção durante a corrida. Registrado em #132 com as
duas hipóteses (retry SERIALIZABLE frágil = bug de produção real, OU asserção `=== cap` forte
demais) e o caminho de investigação. NÃO foi silenciado nem o gate foi afrouxado.

Um único re-run do job de integração foi disparado para distinguir flake de regressão — a
distinção já estava feita localmente; o re-run apenas a confirma no ambiente do CI. Se o mesmo
teste falhar de novo no re-run, é mais que flaky e a investigação de #132 vira bloqueante.
