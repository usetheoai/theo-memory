# SEPA — Iteration 7 / Task T6.1 / Phase Pre-RED

## Plan recap
- T6.1 = observational validation gate. 7 sentinel checks. No code change unless gate FAILs.

## Findings
- [CRITICAL] dist is stale — `grep -c "resolveMcpModes\|trim() !== ''" dist/agent-tools/run-mcp-server.js` → 0. MUST `npm run build` BEFORE Smoke A/B.
- [CRITICAL] Smoke A `head -3` budget too small — real boot stderr has 3-6+ lines (real-providers + Xenova + migrations) before disclosure. Use `grep -E "transport=streamable-http"` over full stderr.
- [CRITICAL] `themory mcp` is long-running server — `head -3` only closes stdout pipe; child keeps writing stderr + holding port. Use `timeout 10 ...` envelope.
- [CRITICAL] Smoke C requires real ankane/pgvector + provisioned theo_live_* row. DEFERRABLE — mark as `DEFERRED-INFRASTRUCTURE-NOT-AVAILABLE` if container down, not FAIL.
- [MAJOR] Smoke A/B need THEOMEM_PG_URI + OPENAI_API_KEY env present — `assertEnvOrExit` hard-fails at L181 before transport resolution.
- [MAJOR] Baseline drift — current 1189/1191 not plan's 1175 literal. Goal is "no regression vs current baseline".

## Recommended action
- Execute strict order: npm test → typecheck → lint → BUILD (mandatory) → Smoke A → Smoke B → Smoke C
- Smoke A/B: `timeout 10 sh -c 'env... node dist/agent-tools/cli.js mcp 2>&1' | grep -E "<pattern>"`
- Smoke C: defer if container down; document as DEFERRED-NOT-FAIL
- No code change in Pre-RED. If gate FAILs after build refresh: surface BLOCKED, don't false-PASS.
