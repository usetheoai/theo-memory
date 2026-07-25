# Review: system-llm-eval (M21)

**Date:** 2026-07-25
**Reviewers (spawned agents):** 3 adversarial specialists (architecture/isolation, tests/non-vacuity, cross-validation/eval-honesty) + orchestrator manual verification.
**Verdict:** READY_TO_MERGE

## Consolidated findings

All three specialists returned **READY_TO_MERGE**. Zero BLOCKER, zero HIGH. Findings (all LOW/MEDIUM/INFO) were addressed in fix commit `a482d3c` before release.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| M21-EVAL-01 | MEDIUM | Ambiguous fixtures satisfy the count-gate but are scored by no tier; README overstated their non-vacuity contribution | FIXED — README + `golden.ts` now state ambiguous fixtures are documentation-only ground truth (reserved for a future LLM-measured consumer); non-vacuity credited to hard + negative only. |
| (orchestrator) | MEDIUM | CHANGELOG M21 entry referenced `#136` (an unrelated release PR) | FIXED — corrected to `(M21)` (the roadmap milestone). |
| F5-arch | LOW | `--stage <typo>` filtered to empty → gate passed vacuously (dev-only path, not in CI gate) | FIXED — `main()` now throws `unknown --stage` naming the known stages (fail-closed, Princípio 3) + regression test added (`run.test.ts`). |
| F2-xval | LOW | `eval.yml` LLM-measured step reran the entire test suite | FIXED — now targets only the measured tests via vitest path filter. |
| F2-arch / F3-arch | LOW | Stage runners import shared fixtures via `../../../../../tests/...`; latent TS6059 under a hypothetical standalone `tsc` | ACCEPTED — documented plan-T2.1 decision (shared test data; moving it breaks existing integration tests). No standalone tsc gate exists (consistent with `packages/mcp`). |
| F1-xval | LOW | Consolidation LLM-free score is 1.0 by construction (structurally vacuous gate) | ACCEPTED — honestly disclosed in 3 places (run.ts, README F-M5 caveat, benchmark doc); real signal is the key-gated LLM-measured tier. |
| F3-xval | INFO | `--update-baseline` reseeds with no gate (baseline-as-theatre) | ACCEPTED — mitigated by README "PR justification" + seeded-regression tests proving the gate mechanism; not CI-reachable. |

## Positive verifications (independently confirmed by ≥2 reviewers + orchestrator)

- **D1 isolation clean both directions** — no published package imports `packages/eval`; eval imports only `@usetheo/memory`'s declared public surface.
- **Regression gate genuinely fail-closed** — seeded drop below `baseline−ε` throws `RegressionError`; boundary inclusive; unknown/missing stage + missing/corrupt baseline all fail-closed with typed errors.
- **Eval honest by construction** — committed baseline `llm-free.json` is byte-identical to the live deterministic run (not hardcoded); `main()` exits non-zero on regression (empirically proven: raised baseline → exit 1); metric computation runs the real `CompromiseEntityExtractor`; no CI-reachable bypass flag.
- **Extraction golden non-vacuous** — 16 cases (9 hard / 4 negative / 3 ambiguous); a `negative` fixture declaring entities is rejected at load (schema superRefine); injected zero-extractor drops to 0.
- **LLM-measured tier honest** — `describe.skipIf(!hasLlmKey())` skips without a key; fails loudly (no try/catch swallow) with a key present but a failing call.
- **Publish fenced** — `"private": true` + Docker-only publish workflow + self-checking guard test.

## Quality gates (orchestrator-run)

- `pnpm --filter @usetheo/memory-eval test` → 22 passed, 1 skipped (LLM-measured tier, honest SKIP).
- `pnpm --filter @usetheo/memory-eval eval` → matrix + `Gate: PASS`, exit 0.
- Seeded regression → exit 1 (gate fires).
- `npm test` (full contract suite) → 177 files, 1365 tests passed, no type errors (migration broke nothing).
- `npm run typecheck` → exit 0.
- `/code-quality` → PASS_WITH_CAVEATS (89; 31 no-network symbol-fab soft-floors, HARD=0).
- `npm run lint` → BLOCKED by a pre-existing environmental breakage (`brace-expansion` override from #123, in ESLint's own config-array/minimatch), independent of M21; eval package glob is not in the lint scope.

## Handoff decision

READY_TO_MERGE → `/release` (develop → main PR + semver tag). Plan carries `milestone_id: M21` → post-merge flips ROADMAP.md M21 `[ ]` → `[x]`.
