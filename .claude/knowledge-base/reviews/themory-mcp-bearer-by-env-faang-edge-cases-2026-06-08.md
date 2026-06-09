# Edge Case Review — themory-mcp-bearer-by-env-faang

Data: 2026-06-08
Tasks analisadas: 8 (T1.1, T1.2, T2.1, T2.2, T3.1, T4.1, T5.1, T5.2, T6.1)
Edge cases encontrados: 9 (MUST FIX: 2, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX

### EC-1: Whitespace-only `THEMEMORY_API_KEY` auto-flips to HTTP silently
- **Task afetada:** T2.1 + T2.2
- **Família:** Input
- **Cenário:** Operator sets `export THEMEMORY_API_KEY="  "` (typo, partial paste, leftover from shell history). Current pseudo-code at T2.1 checks `apiKey !== undefined && apiKey !== ''` — whitespace string passes both checks → Tier-3 fires → HTTP+api-keys auto-selected → `ApiKeyAuthVerifier` queries Postgres with whitespace token → 401 from every request.
- **Impacto:** Operator confusion (server boots HTTP unexpectedly; every Bearer call 401s). Indistinguishable from real auth failure.
- **Fix sugerido:** treat whitespace-only as absent. Replace check with `apiKey !== undefined && apiKey.trim() !== ''` in BOTH `resolveTransport` Tier-3 AND `resolveAuthMode` Tier-3.

### EC-2: `RunMcpServerOptions` is publicly re-exported; `@internal` annotation alone may leak via type-only imports
- **Task afetada:** T4.1 step 2
- **Família:** Integration / boundary
- **Cenário:** Plan says T4.1 will export `resolveTransport` + `resolveAuthMode` with `@internal` JSDoc; verifies `src/agent-tools/index.ts` does NOT re-export. But `@internal` is a TYPEDOC convention, not an enforcement — anyone outside the module CAN still import these helpers because they're named exports. If a future consumer (or even a sibling source file) imports them, the precedence matrix becomes load-bearing public surface — restricting future refactor.
- **Impacto:** Locks in private-to-module helpers as quasi-public; violates SRP + DIP discipline at composition root (architecture.md § 3).
- **Fix sugerido:** Do NOT export the helpers. Instead, export a thin `resolveMcpModes(opts): { transport, authMode }` wrapper function that returns BOTH resolved values — that one IS the (still-internal-by-convention) testing surface. The wrapper composes the two private helpers and is the only thing tests + production code import. T4.1's matrix tests call `resolveMcpModes` instead of the individual helpers. Cleaner boundary; private helpers remain truly private.

## SHOULD TEST

### EC-3: Garbage `THEOMEM_MCP_TRANSPORT` value (operator typo)
- **Task afetada:** T4.1
- **Teste sugerido:** `test_resolve_transport_garbage_env_falls_through_to_tier_3` — set `THEOMEM_MCP_TRANSPORT=streamablehttp` (no hyphen, common typo). Tier-2 condition fails (`'streamablehttp' !== 'streamable-http'`), so Tier-3 evaluates: if `THEMEMORY_API_KEY` also set → http; else stdio. Lock the fall-through.

### EC-4: Garbage `THEOMEM_MCP_AUTH` value (operator typo)
- **Task afetada:** T4.1
- **Teste sugerido:** `test_resolve_auth_mode_garbage_env_falls_through_to_tier_3_or_default` — set `THEOMEM_MCP_AUTH=apikeys` (no hyphen). Tier-2 fails; Tier-3 evaluates based on transport + `THEMEMORY_API_KEY` presence.

### EC-5: `THEMEMORY_API_KEY` with surrounding whitespace `" theo_live_xxx "` (operator copy-paste)
- **Task afetada:** T2.1 + T2.2 (post-EC-1 fix)
- **Teste sugerido:** `test_themory_api_key_with_surrounding_whitespace_is_trimmed_and_treated_as_present` — assert `THEMEMORY_API_KEY=" theo_live_xxx "` → Tier-3 fires (trimmed value non-empty). Companion to EC-1 fix.

### EC-6: Stderr disclosure log fires on EVERY MCP boot in test suite — pollutes output
- **Task afetada:** T3.1
- **Teste sugerido:** When tests for OTHER functionality call `runMcpServer({...})` (e.g., in `handlers.test.ts`), stderr gets noise. Should be silenceable via `THEOMEM_MCP_QUIET=1` env (matches Princípio 3 — operator-opt-out but default-on). Q3 in plan asked this; answer should be YES for test ergonomics. Add SHOULD-TEST: `test_themory_mcp_quiet_env_suppresses_stderr_disclosure`.

## DOCUMENT

### EC-7: Q1 resolution — do NOT require double-env opt-in
- **Risco aceito:** Plan ADR D1 keeps Tier-3 = `THEMEMORY_API_KEY` presence alone. If operator sets the env for REST use AND happens to have `themory mcp` invocation somewhere, auto-flip fires. Mitigation: stderr disclosure (ADR D3) + README warning (T5.1 R4 mitigation). Cost of double-opt-in (requiring also `THEOMEM_MCP_HTTP_HOST`) > benefit; the warning is the right gate. Document in ADR D1 Consequences.

### EC-8: PG-unreachable + env-driven HTTP path → server boots and ApiKeyAuthVerifier construction defers PG hit until first request
- **Risco aceito:** Failure scenario 1 in plan is OK-as-designed: `ApiKeyAuthVerifier` constructor doesn't query PG; first auth request does. So MCP boots fine even when PG is down; first `tools/call` returns 401-ish. This matches Item 20 behavior. Document explicitly: "PG-unreachable failure mode is deferred to first request, not boot." Acceptable for Inquebrável Rule 8 fail-fast-at-boundary (boundary = first request, not boot).

### EC-9: `examples/chat-with-memory/.env` reference
- **Risco aceito:** Plan T5.1 doesn't mention updating `examples/chat-with-memory/.env.example` to show `THEMEMORY_API_KEY` for the new Mem0-DX path. Since that example is a demo (not consumer guide), skipping in this cycle is OK. Document as follow-up if/when examples need to demonstrate uniform auth.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 1 (EC-1) | 1 (EC-5) | 0 |
| T2.2 | 2 | 1 (EC-1) | 1 (EC-5) | 0 |
| T3.1 | 1 | 0 | 1 (EC-6) | 0 |
| T4.1 | 3 | 1 (EC-2) | 2 (EC-3, EC-4) | 0 |
| T5.1 | 1 | 0 | 0 | 1 (EC-9) |
| T6.1 | 1 | 0 | 0 | 1 (EC-8) |
| Unresolved Q1 | 1 | 0 | 0 | 1 (EC-7) |

**Veredicto:** PLANO PRECISA DE AJUSTE (2 MUST FIX) — absorvendo no plano v1.1 antes de seguir.
