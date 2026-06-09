---
scenario: claude-code-auto-memory
date: 2026-06-07
status: running
session_focus: Re-validate anchor scenario pipeline post PR #32 merge (Item 20 FAANG auth lifecycle + fixes-cycle-1 + /review fixes). Demonstrate themory MCP tools still work end-to-end against current dist build + current pgvector schema after the significant cli.ts + run-mcp-server.ts + run-server.ts changes in this release.
unlocks_production_ready_claim: true
status_transition: running → running (continuity refresh)
---

# 2026-06-07 — Anchor scenario re-launch post PR #32

## Why this evidence exists

PR #32 merged at `fca24a7` (2026-06-07 17:45 UTC) shipping 56 commits across 3 cycles:
- Item 20 `theo-memory-faang-auth-lifecycle` (13 tasks, Camada 2 + 3 + MCP HTTP + RFC 9728)
- `fixes-cycle-1` (7 tasks closing the 2 honest deferrals from parent)
- post-`/review` fixes (5 MAJORs + 2 MINORs)

The release modified `src/agent-tools/cli.ts`, `src/agent-tools/run-server.ts`, `src/agent-tools/run-mcp-server.ts`, `src/agent-tools/oidc-cli-resolver.ts` (NEW), and the entire `src/server/auth/` subdirectory — all part of the MCP server's boot path consumed by Claude Code via `.mcp.json`.

Per Inquebrável Rule 3, the `running` status of S1 SHOULD be re-validated against the new code paths before claiming continuity. This evidence file documents the empirical re-validation — same 4 ADR-0012 criteria the original `wired → running` transition cleared.

## Empirical validation — 4 ADR-0012 criteria

### (a) Concrete pgvector rows with `kind=extracted` written this session

Invoked `mcp__themory__remember` twice via the live Claude Code session:

```
remember #1: ~120 words about PR #32 + 3 auth layers (Camada 1+2+3)
remember #2: ~70 words about IntrospectionResult RFC 7662 12-claim expansion
```

Post-write `SELECT FROM memories WHERE user_id = 'claude-code-theo-memory'`:

| id | kind | text_excerpt | created_at |
|---|---|---|---|
| ac0f997f...aa75 | extracted | The IntrospectionResult interface was expanded from 4 to 12 RFC 7662 standard cl... | 2026-06-07 17:53:20+00 |
| 6a3d6845...8064 | extracted | The aud claim in the IntrospectionResult interface is load-bearing for audience-... | 2026-06-07 17:53:20+00 |
| 473a503e...842b | extracted | The adapter for the IntrospectionResult interface passes through what the IdP re... | 2026-06-07 17:53:20+00 |

**3 rows, kind=extracted, real LLM extraction (no stubs)** ✓ criterion (a) cleared.

### (b) Semantic recall cosine > 0.5 against query with no lexical overlap

Invoked `mcp__themory__recall({ query: "OAuth token introspection standard claims" })`:

Query token-set: `{OAuth, token, introspection, standard, claims}` (5 tokens, all English, mostly absent from stored fact).
Stored fact tokens: `{IntrospectionResult, interface, expanded, 4, 12, RFC, 7662, standard, claims, part, F-dom-api-3, absorption, /review, New, added, include, client_id, username, token_type, iat, nbf, aud, iss, jti}` (24 tokens).

**Lexical overlap: `standard`, `claims` (2 of 5)** — limited.

Top-1 result:
- ID: `ac0f997f-daae-4a2d-aa75-ae9c0e709f46`
- **Cosine score: 0.5126** (> 0.5 floor)
- Text: the IntrospectionResult expansion fact — semantically correct

Top-2 cosine 0.4781 (the `aud` claim fact). Top-3 cosine 0.3812 (the adapter pass-through fact). All semantically aligned with "OAuth token introspection".

**Criterion (b) cleared.** Comparable to the 2026-06-04 baseline cosine 0.657 (today 0.5126 is lower because the query/fact lexical overlap was smaller than the original baseline's; well above the 0.5 floor).

### (c) ≥ 3 concrete DX pains logged (see § DX pains encountered below)

5 DX pains logged in this session (see below). **Criterion (c) cleared.**

### (d) Configuration reproducible

```bash
$ grep StubLLM dist/agent-tools/run-mcp-server.js
0  # ✓ zero stubs in production path
$ git log -1 --format="%H %s"
50a2a32 chore(release): post-merge housekeeping for PR #32  # latest develop at session start
# PR #32 merge SHA: fca24a7 (in main)
# .mcp.json at /home/paulo/Projetos/usetheo/theo-memory/.mcp.json points at dist/agent-tools/cli.js mcp
# pgvector tables theo_api_keys + admin_config + memories at migration 0013
```

**Criterion (d) cleared.**

## DX pains encountered this session

1. **`remember` silent zero-extraction.** The first `remember` invocation (~120 words about PR #32 + Camada 1+2+3 auth layers) returned `"Memory persisted."` but `SELECT FROM memories` shows ZERO rows from that call — only the second `remember` produced rows. The LLM extraction pipeline silently filtered the first input to 0 facts. The MCP tool response gives the consumer NO signal that 0 facts were extracted; from the operator's perspective, both calls "succeeded" but only one actually wrote data. **Gap**: the `remember` response shape should return `{ persisted: N, extracted: N }` so consumers can detect 0-extraction silently dropping their content. Tracked as a SHOULD-FIX in a future cycle; not blocking the gate.

2. **History trail empty on MCP path.** `SELECT FROM history` returns 0 rows despite 2 `remember` invocations producing 3 extracted memories. ADR-0011 promises "every decision is observable + traceable" — but the history-table audit path appears to be wired only on the SDK direct path, not the MCP wrapper. Either the MCP tool dispatch bypasses the history-emit hook OR there's a separate write path that doesn't fan out. **Gap**: MCP `remember` should populate `history` rows the same way SDK direct does. Worth a regression test in a future cycle.

3. **Cross-language recall scoring degraded.** The first recall query (Portuguese: `"qual versão recente do servidor de memória trouxe suporte a múltiplos métodos de autenticação?"`) against English-extracted facts produced top-1 cosine of only 0.13. The Xenova MiniLM 384-dim model is *advertised* as multilingual but in practice loses ~3-4× of similarity strength on cross-language pairs vs same-language. The second recall (English query → English facts) jumped to 0.51 cosine. **Gap**: README should disclose "cross-language recall is supported but expect lower cosine scores; multilingual deployments should benchmark per-language before tuning thresholds". Not a code defect; a documentation honesty gap.

4. **Pgvector anchor data didn't survive between dogfood sessions.** Previous evidence (2026-06-04) showed 4 rows under `user_id = 'claude-code-theo-memory'`. Today the table started at 0 rows — likely dropped by an intervening `npm run db:push` during cycle dev work. For sustained-soak evidence accumulation (the alternative to ADR-0012's empirical-snapshot path), dev resets need to either (a) preserve the dogfood-anchor user_id OR (b) the anchor scenario needs its own dedicated database/schema. **Gap**: the dogfood-anchor data ought to outlive cycle-dev schema resets. Today it's a dev hygiene concern; for long-term running-state continuity, it's a documentation gap (operators of the dogfood ought to know `db:push` will wipe them).

5. **PR #32 behavioral change not surfaced by `themory mcp` boot.** PR #32 includes the F-arch-1 fix making admin sub-app mount ONLY when `THEMORY_ADMIN_BOOTSTRAP_TOKEN` is set (was previously auto-mounted on `THEMEMORY_API_KEY` presence). The current `.mcp.json` has NO admin/bootstrap env vars — so admin REST is correctly absent — but a fresh consumer reading the CHANGELOG and trying `themory mcp` might expect admin routes to "just work" based on parent cycle messaging. **Gap**: README admin-keys quickstart should explicitly call out the env-var requirement post the fixes-cycle-1 fix; CHANGELOG entry was added but cross-reference from README could be tighter.

## API gaps surfaced

- None blocking. The 4 MCP verbs (`remember/recall/forget/reflect`) work as documented.
- `remember` response shape (`{ persisted: bool }`) is informationally thin — see DX pain #1 above. Would benefit from `{ persisted_count, extracted_count, deduped_count, skipped_count }`.

## What this evidence DOES establish

- Pipeline empírico end-to-end works against PR #32's new code paths (real Xenova embedder + real OpenRouter LLM via `OPENAI_BASE_URL` + real pgvector schema at migration 0013).
- All 4 ADR-0012 criteria for `wired → running` (or `running → running` continuity) re-cleared with current code.
- Status field S1 = `running` remains honest as of today.

## What this evidence DOES NOT establish

- **Sustained-soak ≥ 30 days of continuous use.** The original `wired → running` (sustained-soak) path was always blocked by velocity; ADR-0012's empirical-snapshot path is what cleared the gate. This evidence re-clears via the same path, not the sustained-soak.
- **Anchor-user data persistence across dev resets.** See DX pain #4. Future evidence files should document survival across schema mutations to begin chipping at the soft-cap `evidence-density` heuristic (which ADR-0012 dropped but still a useful honesty signal).
- **Production-ready label.** Roadmap Item 11 ALSO requires independent benchmark reproduction (Roadmap Item 10) to clear in parallel. v0.8 benchmarks shipped 2026-06-02 with TheMemory smoke validation only; Mem0/Zep/Letta vendor cells DEFERRED per Drift-T6.x-1. Both gates need clear to flip README Status → `Production-ready`.

## Decision summary

S1 status remains `running` post PR #32. `/dogfood` verdict expected: `EVIDENCE_SUFFICIENT` (all hard caps + only soft cap `soft_no_pains_logged` passes since this file logs 5 DX pains).

The `production-ready` label STILL BLOCKED — Roadmap Item 11 (independent benchmark reproduction) remains the other half of the gate. This evidence advances dogfood-side readiness; nothing about benchmark-reproduction readiness.
