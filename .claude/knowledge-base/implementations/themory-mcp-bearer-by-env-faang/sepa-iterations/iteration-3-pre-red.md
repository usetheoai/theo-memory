# SEPA — Iteration 3 / Task T2.2 / Phase Pre-RED

## Findings
- [MAJOR] Replace line 176 callsite with `resolveMcpModes(options ?? {})` destructure, NOT raw `resolveAuthMode` call — EC-2 single-export discipline
- [MAJOR] Tier-3 transport guard CRITICAL — pass already-resolved `transport`, not `options?.transport` raw
- [MAJOR] `resolveMcpModes` MUST be `@internal` + NOT re-exported from `src/agent-tools/index.ts`
- [MAJOR] Test #6 isolation: `vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_xxx')` in test body BEFORE asserting `auth: 'none'` opt-out works
- INFO Test #6 is regression-guard (already passes pre-impl due to line 195 `mode === 'none'` short-circuit); load-bearing RED tests are T1.1 #1+#5

## Verdict
GO — implement resolveAuthMode + resolveMcpModes per pseudo-code; test #6 added as regression guard
