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
