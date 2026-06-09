# SEPA — Iteration 2 / Task T2.1 / Phase Pre-RED

## Plan recap
- Extend `resolveTransport` with Tier-3 auto-flip: when `THEMEMORY_API_KEY` is set (non-empty after trim), return `'streamable-http'` per ADR D1.

## Findings
- [CRITICAL] EC-1 absorption: `.trim() !== ''` discipline REQUIRED. NEVER regress to `!== ''` alone (would treat "   " as present).
- [MAJOR] Tier-3 insertion position MUST BE between current Tier-2 (THEOMEM_MCP_TRANSPORT env L86-87) and `return 'stdio'` L88. Inserting before Tier-2 would break Test 3 regression guard.
- [MAJOR] Do NOT widen `resolveTransport` signature. Keep env-read inside (matches Tier-2 pattern + preserves SRP + test isolation via vi.stubEnv).
- [MAJOR] F3 followup R4 opt-out env: NOT mandated by T2.1. Log explicit rejection in commit body to close F3 without scope expansion.
- [MAJOR] Test 5 (auth_mode_is_api_keys) STAYS RED — DO NOT touch resolveBearerAuth in T2.1 (T2.2 territory).
- [INFO] Tier-2 shape at L86-87 matches plan baseline.

## Recommended action
- Insert Tier-3: `const apiKey = process.env['THEMEMORY_API_KEY']; if (apiKey !== undefined && apiKey.trim() !== '') return 'streamable-http';`
- Add JSDoc citing `@see ADR-D1` + `@see EC-1` before COMMIT
- Log R4 deferral rationale in commit body
