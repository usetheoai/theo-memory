# Deps Audit: deps-and-stale-dist-guard (M20)

**Date:** 2026-07-25 · **Mode:** plan-bound · **Verdict:** PASS_WITH_CAVEATS · **Caps:** []

## Summary
- Este plano É o dep-audit remediation: upgrade hono ≥4.12.27 + node-server ≥2.0.5 (resolve 4 runtime advisories), overrides brace-expansion ≥1.1.16 + js-yaml ≥4.3.0 (resolve 3 HIGH transitivos).
- Todos os alvos têm patched version na registry; upgrades semver-compatíveis exceto node-server (major, gated pela suíte per ADR D1).
- Nenhuma dep NOVA de produto; só bumps + overrides transitivos (Regra 9).

## Verdict
PASS_WITH_CAVEATS — o node-server major bump carrega risco de breaking, mitigado pela suíte de integração como gate (ADR D1). Proceder.
