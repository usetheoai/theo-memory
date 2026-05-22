# Followups — memory-contract-v0-0

Scope-creep observations captured during the /implement halt-loop but DEFERRED to avoid mid-task scope expansion. Apply to next plan revision OR a follow-up cycle-plan.

| # | Observed during | Description | Recommended owner |
|---|---|---|---|
| F1 | T0.3 (iter 3) | Added `jiti ^2.7.0` as devDep (transitive ESLint 9 requirement for loading `.ts` config files). Not in plan's `## Dependencies § New` table. Rule 9: only viable solution — `jiti` is the canonical TS config loader endorsed by ESLint upstream; alternatives (`tsx`, `ts-node`) are heavier and not designed for ESLint config loading. Owner: next plan revision or v0.1 deps refresh. |
| F2 | T0.3 (iter 3) | Lint script uses `--no-error-on-unmatched-pattern` to tolerate the pre-types phase (only `_placeholder.ts` exists which is ignored). Flag becomes a no-op once T2.1+ ship real files; consider removing in T4.1 or later if all `src/core/**/*.ts` are guaranteed lintable. Owner: T4.1 review or v0.1. |
| F3 | T0.2 (iter 2) | `src/core/_placeholder.ts` is a workaround for `tsc TS18003` (no inputs). Should be removed by the first T2.x task that lands real `.ts` content. Owner: T2.1. |
