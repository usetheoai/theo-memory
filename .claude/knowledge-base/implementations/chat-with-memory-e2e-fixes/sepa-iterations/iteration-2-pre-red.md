# SEPA iter 2 pre-RED T1.1+T1.2 — MODE=VERBOSE

CRITICAL: 0 (EC-3 surfaced as HALT-candidate) · MAJOR: 5 · MINOR: 5

## Decisions absorbed by main session
- **EC-3 (empirical 0.6 unhedged):** Option (a) — proceed with 0.6 as-planned. T3.1 verdict validates; v1.2 plan + escalation if D4 still FAIL (plan T3.1 § Acceptable variance documents the 0.55/0.50 fallback path).

## Implementation checklist (per SEPA MAJORs)
- Validation = FALLBACK pattern (not 400-reject): `typeof === 'number' && Number.isFinite && >= 0 && <= 1 ? body.X : DEMO_DEFAULT_CLUSTER_THRESHOLD`.
- Boundaries `0` and `1` INCLUSIVE per EC-5 (`>= 0 && <= 1`, NOT `> 0 && < 1`).
- ATOMIC stage: BOTH files in ONE `git add` + ONE `git commit`.
- `DEMO_DEFAULT_CLUSTER_THRESHOLD = 0.6` module constant above ConsolidateBody.
- UI literal `0.6` carries `// DEMO showcase tuning per ADR D1` inline comment.
- `ConsolidateBody` extended with `clusterThreshold?: number`.
- No paper names. No console.log. No vitest test files.

Authorized to proceed to GREEN.
