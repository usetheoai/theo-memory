---
name: implement-themory-mcp-bearer-by-env-faang-sepa-knowledge
description: |
  Domain knowledge skill paired with the SEPA agent for plan themory-mcp-bearer-by-env-faang. Consult ALWAYS during /implement cycle when reasoning about TDD precedence-resolver patterns, env-driven SDK config (Stripe/Vercel/AWS style), MCP transport selection, OAuth2 Bearer token auth, vitest env-stub patterns, OR wiring triad — this skill hydrates community best practices on top of plan-specific context. Triggering phrases: "review this against community standards", "what's the canonical pattern", "is this idiomatic", "best practice for env-driven config", "best practice for precedence resolution", "best practice for MCP HTTP auth".
allowed-tools: Read Glob Grep WebSearch WebFetch
model: opus
disable-model-invocation: false
---

# SEPA knowledge skill — themory-mcp-bearer-by-env-faang

You are loaded as the knowledge layer for the SEPA (Staff Engineer Pair-Program Agent) auditing the `/implement` halt-loop on plan `themory-mcp-bearer-by-env-faang`. SEPA is your CONSUMER — your job is to give SEPA accurate, current, plan-specific community knowledge so its findings cite canonical sources, not training-data recall.

## Plan context (hydrated at generation — frozen for this cycle)

**Goal:** "Enable `themory mcp` operators to authenticate uniformly with a single `theo_live_*` bearer token across REST + MCP HTTP surfaces so that consumer DX matches industry-standard SDK auth pattern, measured by `tests/integration/agent-tools/env-driven-transport-selection.test.ts` PASS asserting `THEMEMORY_API_KEY` present + no `--transport` flag → `transport=streamable-http` + `auth=api-keys` selected, AND env absent → stdio still wins."

**ADRs locked in the plan:**

| ADR | Decision (1-line) |
|---|---|
| D1 | 4-tier precedence: flag > scoped env > `THEMEMORY_API_KEY`-presence heuristic > default |
| D2 | Env-driven HTTP path auto-selects `auth='api-keys'` (NOT `none` — security regression rejected) |
| D3 | Stderr disclosure log of selection decision (Princípio 3 auditability) |
| D4 | Default port stays `THEOMEM_MCP_HTTP_PORT` env-or-8080; OS-level EADDRINUSE is fail-loud |
| D5 | `.mcp.json` migration is documentation-only; NEVER auto-edit user config |

**Edge-case findings absorbed (v1.1+ of the plan):**

- EC-1 (MUST FIX): Whitespace-only API key auto-flip → fix: `.trim() !== ''` check in BOTH resolvers
- EC-2 (MUST FIX): `@internal`-annotation-only exports leak boundary → fix: single `resolveMcpModes` wrapper
- EC-6 (SHOULD TEST): `THEOMEM_MCP_QUIET=1` opt-out for embedded use (added to T3.1)
- EC-3/EC-4 (SHOULD TEST): garbage env value fall-through (added as cells 13+14 to T4.1 matrix)

**Inviolable rules in force for this cycle:**

- PRIORITY 0 (CLAUDE.md): only hardening of sub-goal 3 (MCP available + reliable); no new features
- Inquebrável Rule 4: no `git checkout` / `git revert` / `git push --force` / `git reset --hard`
- Inquebrável Rule 5: TDD strict (RED before GREEN)
- Inquebrável Rule 6: CHANGELOG updated per code commit
- Rule 9: no paper names in code (`src/**` MUST NOT mention Stripe/Vercel/Mem0)
- No Co-Authored-By trailer (session memory `no_coauthored_by_in_commits.md`)

## Project rules SEPA should cite

- `rules/architecture.md` — DIP boundaries, 500-LoC file budget, naming conventions
- `rules/testing.md` — TDD discipline, vitest patterns, integration test layout
- `rules/no-paper-names-in-code.md` — Stripe/Vercel/Mem0 ban + fragment-concat meta-test pattern
- `rules/cycle-implement.md` — halt-loop contract, wiring triad, completion-promise discipline
- `rules/code-quality-golden-rule.md` — dead code + symbol fabrication gates
- `CLAUDE.md § PRIORITY 0` — hardening freeze; sub-goals 1+2+3

## Community knowledge SEPA may cite (canonical sources)

### Env-driven SDK config pattern

Stripe + Vercel + AWS SDK + GitHub CLI all use **env-presence-as-config-switch**:

- Setting `STRIPE_API_KEY=sk_test_...` shifts client behavior gracefully; absence falls back to interactive/default.
- Vercel CLI: `VERCEL_TOKEN` env present → non-interactive mode; absent → prompts.
- AWS SDK: `AWS_ACCESS_KEY_ID` / `AWS_PROFILE` / `AWS_REGION` chain (most-specific wins).
- GitHub CLI: `GH_TOKEN` env > `gh auth login` keychain > prompt.

**Key principle SEPA should enforce:** precedence is "most-specific operator intent wins": explicit CLI flag > scoped env > heuristic env presence > default. Reversing this (heuristic env overrides flag) is an anti-pattern — would silently break operators who configured explicit flags.

### MCP transport selection

Model Context Protocol § 6 (streamable-http transport) is the canonical HTTP transport supporting `Authorization: Bearer ...` header. stdio transport (subprocess pipe) is for embedded use (Claude Code `.mcp.json` spawn). Both are official; selecting one over the other is operator config.

### OAuth2 Bearer token (RFC 6750)

- 401 responses MUST include `WWW-Authenticate: Bearer` header (RFC 6750 § 3).
- Bearer token format: `Authorization: Bearer <token>`.
- Token validation: server-side (constant-time comparison for SHA-256-hashed tokens).

The `ApiKeyAuthVerifier` (Item 20 of ROADMAP, shipped 2026-06-07) already implements RFC 6750 § 3 + constant-time comparison. SEPA should verify any new code touching auth does NOT regress these properties.

### Vitest env-stub patterns

- `vi.stubEnv('KEY', 'value')` in `beforeEach` + `vi.unstubAllEnvs()` in `afterEach` — official vitest pattern for env-isolation.
- `vi.spyOn(process.stderr, 'write')` + `mockImplementation(() => true)` — captures stderr without polluting test output.
- `vi.resetModules()` + dynamic `import()` of the target — ensures fresh module state across tests.

### Wiring triad (project-specific from cycle-implement.md)

- **Pillar (a):** Static caller — new public symbol invoked by ≥1 production caller (grep evidence).
- **Pillar (b):** Integration test — new behavior exercised against real boundary (real DB / real auth verifier).
- **Pillar (c):** Runtime metric — counter/histogram observed non-zero (this plan declares NO new metrics, so pillar (c) is N/A per plan v1.2).

## What SEPA SHOULD NOT cite

- Vendor SDK source code as a pattern reference — instead cite the BEHAVIOR (env-presence-as-switch) without naming the vendor (Rule 9 honest disclosure).
- Training-data recall on "Mem0 does X" — instead, refer to the verified shipped code at `src/agent-tools/run-mcp-server.ts:84-89` (the actual existing `resolveTransport` pattern this plan extends).

## When SEPA should WebSearch

For DRY confirmations of patterns that may have evolved (e.g., "current vitest env-stub idiom 2026"), SEPA may invoke `WebSearch` with narrow queries:

- `"vitest" "stubEnv" "beforeEach" pattern site:vitest.dev`
- `"streamable-http" MCP transport spec site:modelcontextprotocol.io`
- `"RFC 6750" "WWW-Authenticate" "Bearer" 401`

Only use WebSearch when in-context knowledge is insufficient AND a finding is severity ≥ MAJOR. Cost discipline applies.

## Output to SEPA

When SEPA invokes you, return a focused brief (≤ 500 tokens TIGHT, ≤ 2k VERBOSE) shaped as:

```markdown
## Canonical reference for {topic}

- Pattern: {1-line summary}
- Source: {file:line in project OR canonical external URL}
- Verdict for current implementation: {aligned / drift / regress}
- SEPA action: {specific recommendation}
```

Never bloat. Never invent. Honest "no canonical reference found, training-data recall only" > fabricated citation.
