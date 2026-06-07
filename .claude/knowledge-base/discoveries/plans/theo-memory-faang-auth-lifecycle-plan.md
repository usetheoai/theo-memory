# Discovery Plan: FAANG-OSS auth/token lifecycle parity for `@usetheo/memory/server`

> **Version 1.1** (2026-06-07) — Absorbs `/discover-edge-cases theo-memory-faang-auth-lifecycle` review (10 edge cases: 5 MUST FIX + 3 SHOULD TEST + 2 DOCUMENT — VERDICT DISCOVERY PLAN PRECISA DE AJUSTE). **EC-1 + EC-3 + EC-4 ABSORBED**: hard-coded source paths in Q1 / Q3 / Q-tests-1 replaced with "search-then-Read" pattern (locate symbol via github.com search, then Read the located file). **EC-2 ABSORBED**: Q2 method expanded to explicitly cover BOTH GitHub PAT classic + fine-grained PAT vocabularies as inline sub-queries (kept Q2 as single question to respect techniques-corner max=3 cap). **EC-5 ABSORBED**: time-budget re-balanced (Q5 6→12 min for combined audit+rate-limit, Q7 6→4 min, Q-deps-1 absorbed into 4-min slot; total ≤ 60 min preserved). **EC-6 + EC-7 + EC-8 ABSORBED inline**: 3 new halt-loop checkpoints added (pre-Fase-B path validation, gated-docs detection with honest BLOCKED, custom-corner classifier sanity). **EC-9 + EC-10 ABSORBED**: 2 new ADRs added (D7 SOC2 paywall honest-BLOCKED policy, D8 D6 supersession conditional on Q4 completion).

> **Version 1.0** (2026-06-07) — Investigates how FAANG-shape OSS-first projects (Stripe, Supabase, PostHog, Cal.com, Plausible, GitHub, Ory Hydra, Auth0) structure API-key + OIDC bridge lifecycle so the OSS self-host path has PARITY with the SaaS path — except for features that genuinely require multi-tenant SaaS infra (multi-region, hyperscaler partnerships). The produced blueprint will ground the implementation plan that lands Camada 2 (OSS multi-user lifecycle) + Camada 3 (OIDC bridge) into `@usetheo/memory/server`. Camada 4 (TheoCloud-specific audit log + rate-limit + secret-scanning partnership) is reference-only — TheoCloud lives in a different repo (`/home/paulo/Projetos/usetheo/theo-cloud`) and its existing `routes/api_keys.go` is the canonical Stripe-shape anchor in the same monorepo family.

**Slug:** `theo-memory-faang-auth-lifecycle`
**Owner:** PRIORITY 0 hardening — SDK sub-goal 2 + MCP sub-goal 3
**Created:** 2026-06-07
**Time budget:** 60 min total (per Q1-Q8 breakdown in ADR D1)

## Context

Three signals trigger this investigation NOW:

1. **CLAUDE.md § PRIORITY 0 (locked 2026-06-04)** explicitly scopes hardening to "SDKs 100% functional" (sub-goal 2) + "MCP server available + reliable" (sub-goal 3). The `@usetheo/memory/server` subpath ships Bearer auth via a SINGLE `THEMEMORY_API_KEY` env var — no per-user/per-scope lifecycle. A self-hosted multi-user OSS deployment cannot create scoped tokens, rotate them, revoke them, or audit them. This is a documented gap against the FAANG-OSS positioning ("Supabase / PostHog / Cal.com / Plausible — OSS production-grade, not OSS dev-only").
2. **ADR-0009 [`adrs/ADR-0009-cloud-auth-theokit-api-key.md`](../adrs/ADR-0009-cloud-auth-theokit-api-key.md) § Alternatives row "OAuth / OIDC flow"** declared the cloud OAuth/OIDC path "Deferred to v1.x — Heavier; needs identity provider integration. v0.5 ships with API-key auth (Mem0/Zep parity); OAuth lands when enterprise customers ask." That deferral is now load-bearing — enterprises asking for SSO have no path even on cloud, and the OSS path has no story at all.
3. **Empirical proof from this session (2026-06-07 dashboard validation):** `cloud/internal/auth/scope.go` literally rejects non-`theo_live_*` Bearers with `"Invalid or missing API key. Provide Authorization: Bearer theo_live_*"`. Hydra OAuth2 tokens cannot reach `/v1/memory/*`. The existing two-trail split (Hydra for human login / `theo_live_*` for machines) is correct for cloud, but the OSS path has only an env-var single secret — neither trail. This blueprint asks: what should the OSS shape be?

## Objective

> "Produce a CONCEPTUAL_BORROW blueprint with explicit ADOPT / CONCEPTUAL_BORROW / REJECT verdict per candidate per Inquebrável Rule 9, sufficient to ground an implementation plan that lands Camada 2 (OSS API-key lifecycle parity) + Camada 3 (OIDC bridge as opt-in middleware mode) into `@usetheo/memory/server`, AND a documented set of reference patterns for Camada 4 (TheoCloud audit + rate-limit + secret-scanning partnership) deferred to the cloud repo."

Measurable success criteria for the blueprint:

- [ ] Every Q1-Q8 has at least one citation to either `.claude/knowledge-base/references/{mem0,letta}/{path}` OR a domain in `.claude/rules/discover-web-allowlist.txt` (8 newly-added entries per D2).
- [ ] Cross-cutting comparison table populated for the 8 candidate projects (Stripe / Supabase / PostHog / Cal.com / Plausible / GitHub / Ory Hydra / Auth0).
- [ ] At least one ADOPT / CONCEPTUAL_BORROW / REJECT verdict per Q, with rationale referencing the project's own CLAUDE.md constraints (`PRIORITY 0`, `Locked names`, `MIT license`, `architecture.md` DIP rules).
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS.
- [ ] Honest disclosure of which candidates were investigated via WebSearch-only vs github.com-source-read, and which questions had Fase A exhausted (BLOCKED) before Fase B.

## In-Scope / Out-of-Scope

### In-Scope (per reference project — note: investigation method varies)

| Project | In-scope surface | Investigation method | Reason |
|---|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0-ts/src/` Bearer-auth surface if any | Read + ast-grep (already cloned) | Anchor "Mem0 parity" claim in ADR-0009 |
| `.claude/knowledge-base/references/letta/` | `letta/server/auth/` if present | Read + ast-grep (already cloned) | Pgvector-shape peer reference |
| **Stripe** (docs.stripe.com) | Token format (`sk_live_*`), show-once UX, scope vocabulary, rate-limit per-key | WebSearch + WebFetch | Canonical FAANG API-key shape (already followed by theo `theo_live_*` per cloud `routes/api_keys.go`) |
| **Supabase** (supabase.com + github.com/supabase/supabase) | Self-host auth lifecycle parity, GoTrue + PostgREST + RLS shape | WebSearch + targeted github.com source read | OSS-first reference closest to theo's positioning |
| **PostHog** (posthog.com + github.com/PostHog/posthog) | Personal API key lifecycle in OSS self-host; audit log shape | WebSearch + github source read | OSS-parity gold standard (their cloud and self-host share the same UI) |
| **Cal.com** (cal.com + github.com/calcom/cal.com) | API token + OIDC bridge in OSS | WebSearch + github source read | OSS-parity reference (Next.js + Prisma stack, similar UI conventions) |
| **Plausible** (plausible.io + github.com/plausible/analytics) | API key model (simplest of the candidates) | WebSearch + github source read | Minimal lifecycle reference for the simplest dev case |
| **GitHub** (docs.github.com + github.com/github-secret-scanning samples) | PAT scope vocabulary, Secret Scanning Partner Program registration + webhook | WebSearch + WebFetch | Authoritative reference for Q2 + Q7 |
| **Ory Hydra** (www.ory.sh + github.com/ory/hydra) | OAuth2 introspect + dual-mode middleware shape | WebSearch + WebFetch | Already deployed in theo-cloud cluster (Plan 1 D8) — natural OIDC bridge target |
| **Auth0** (auth0.com) | RBAC scope mapping, token-exchange RFC 8693 patterns | WebSearch + WebFetch | Enterprise SSO bridge canonical reference |
| **RFCs** (datatracker.ietf.org + www.rfc-editor.org) | RFC 6749 OAuth 2.0, RFC 7662 Introspection, RFC 8693 Token Exchange, RFC 9449 DPoP | WebFetch | Spec text for Q4 + Q8 |

### Out-of-Scope (explicit)

| Project / Surface | Why excluded |
|---|---|
| WebAuthn / passkeys / FIDO2 | User-auth (not API-key); handled by Kratos in theo-cloud, irrelevant to memory server Bearer surface |
| Session cookie management | Kratos handles dashboard sessions already; memory API surface is Bearer-only |
| Database encryption-at-rest | Orthogonal; deployment concern, not auth-protocol concern |
| Mobile OAuth (PKCE) | TheMemory has no mobile SDK surface |
| WebHook signing (Stripe-shape `Stripe-Signature`) | Out-of-scope for Camada 2/3 (separate concern; v0.5+ if relevant) |
| Camada 4 implementation | Reference-only here; the cloud repo (`/home/paulo/Projetos/usetheo/theo-cloud`) owns the impl |
| Any project NOT in `.claude/knowledge-base/references/` AND NOT in the allowlist | Cross-Project Rule: never claim a project feature without a verified source |

## ADRs

### D1 — Time budget + stop conditions

**Decision (v1.1 final after Q5-drop):** 60 min total, distributed across 8 questions:
- Q1 (Token model): 10 min — anchor at Stripe + cross-reference 3 OSS
- Q2 (Scope vocabulary): 10 min — GitHub PAT classic + fine-grained + Stripe + Auth0
- Q3 (OSS lifecycle CRUD tooling): 12 min — Supabase + PostHog + Cal.com + Plausible via search-then-Read
- Q4 (OIDC bridge): 12 min — Ory Hydra + Auth0 + RFCs (6749, 7662, 8693)
- Q5 (npm dep picks): 4 min — npmjs.com pages (quick)
- Q6 (Supabase auth tests): 4 min — search-then-Read 1 test file
- Q7 (Secret scanning): 4 min — docs.github.com Partner Program docs
- Q8 (MCP transport auth): 4 min — spec.modelcontextprotocol.io + RFCs

Re-tally: 10+10+12+12+4+4+4+4 = **60 min** ✓ exactly on budget.

**Rationale:** WebSearch-heavy questions (Q3, Q4) get larger budgets because they touch multiple candidates. Source-anchor questions (Q1 Stripe, Q7 GitHub) are tighter. Total 60 min matches the user-specified ≤ 60 min cap from the auto-plan invocation.

**Alternatives considered:** equal 7.5 min split (rejected — Q3/Q4 demonstrably need more), 90 min total (rejected — exceeds user cap; if Q3/Q4 still blocked at 60 min the budget should be respected per Inquebrável Rule 3 + halt-loop spec).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches OR all WebSearch results return 404/paywall/non-allowlisted-domain after 3 query variants, mark the question BLOCKED with reason "Fase A exhausted — no authoritative source found" and continue. Do NOT pad with second-hand blog citations.

**Stop condition — per project (mandatory):** Stripe + Supabase + Hydra get full investigation. PostHog / Cal.com / Plausible may be BLOCKED if their docs are paywalled or their auth surface is genuinely undocumented in OSS; they are CONCEPTUAL_BORROW candidates, not anchors.

**Anti-pattern:** NEVER fabricate Fase B answers. NEVER cite a domain outside the (extended) allowlist. NEVER claim "Supabase does X" without a github.com or supabase.com URL.

**Consequences:** budget-exhausted questions surface in `## Blocked questions` section of the blueprint; the implementation plan acknowledges them as known gaps.

### D2 — Investigation depth + WebSearch-first

**Decision:** This investigation is **primarily WebSearch + WebFetch driven**, NOT ast-grep-on-local-references driven (which is the discover-plan template default). Local references (mem0, letta) are READ ONLY for the cross-reference table (Q1 row: "does Mem0 OSS support API-key lifecycle?"); the FAANG-OSS candidates require WebSearch because cloning all 8 candidate repos to `references/` would cost ~4 GB + an hour just to clone, with most read budget wasted on non-auth surface.

**Rationale:** Per `cycle-discover.md v1.1` paired-knowledge-skills spec, WebSearch against the allowlist IS the canonical investigation method for prior-art questions where the answer lives in vendor docs + open-source repos. The allowlist (extended at 2026-06-07 with 8 entries cited above) makes the WebSearch path auditable. Fase A (ast-grep) is reserved for the 2 local-references questions (Q1 row "Mem0 OSS"); all other questions use Fase A=WebSearch with 1-3 query variants per term.

**Alternatives considered:** (a) Clone all 8 candidates to `references/` — rejected (cost > value); (b) cite all candidates from training-data recall — rejected (Inquebrável Rule 3 + cycle-discover.md anti-pattern #10); (c) WebSearch-only without local refs — rejected (Q1 row "Mem0 OSS" requires local-source verification).

**Consequences:** Every Q citation MUST be a URL within the allowlist OR a `.claude/knowledge-base/references/{mem0,letta}/{path}`. Fabricated/non-allowlisted citations cap discover-confidence at INVALID (per `discover-blueprint-golden-rule.md`).

### D3 — Output shape: CONCEPTUAL_BORROW verdict matrix (Rule 9 grounded)

**Decision:** The blueprint's deliverable is NOT an adoption list (none of these candidates ship as a runtime dep — Inquebrável Rule 9 "Não Reinvente" is honored by adopting Stripe-shape PATTERNS, not Stripe-the-library). The deliverable IS a verdict matrix:

| Candidate | ADOPT (lib runtime dep) | CONCEPTUAL_BORROW (pattern) | REJECT (with reason) |

with at least one entry per Q across the 8 candidates.

**Rationale:** Mirrors the voyager-skill-library-blueprint.md Rule 9 candidate table (`.claude/knowledge-base/discoveries/blueprints/voyager-skill-library-blueprint.md § Aggregate Rule 9 finding`). Sets honest expectation that Camada 2/3 are PATTERN ports, not lib drop-ins.

**Consequences:** plan-confidence's coverage matrix will require this verdict matrix to be 100% populated — no "TBD" rows.

### D4 — Camada 4 is reference-only (out-of-implementation-scope but in-blueprint-scope)

**Decision:** The blueprint MAY document Camada 4 patterns (TheoCloud audit-log table shape, rate-limit Redis bucket strategy, GitHub Secret Scanning Partner Program webhook contract) but the implementation plan that follows this discovery will ONLY ship Camada 2 + Camada 3 in `@usetheo/memory/server` (this repo). Camada 4 implementation lives in `/home/paulo/Projetos/usetheo/theo-cloud` and requires a separate plan + separate repo PR.

**Decision expanded (v1.1):** Camada 4 audit-log + rate-limit research is INTENTIONALLY DEFERRED to the cloud-repo follow-up plan and is NOT covered by any question in this discovery. The v1.0 draft had a Q5 covering this surface in `techniques` corner; absorbing the edge-case review forced re-balancing to fit per-corner caps and the most honest path was to drop Q5 here and let the cloud-repo plan ground its own audit-log Q (the cloud team has AICPA SOC2 vendor access we don't have, mooting EC-9 paywall concern entirely).

**Rationale:** Cross-repo PRs violate single-repo cycle discipline. Camada 4 deserves its own discover + plan cycle in the cloud repo's `.claude/`. But omitting it from this blueprint would lose the FAANG-completeness narrative — the reader needs to see the full 4-layer architecture even if only 2 ship here.

**Consequences:** The blueprint's `## Recommendations` section will end with an explicit "FOLLOW-UP CLOUD REPO" callout listing Camada 4 work items: (a) audit-log table + retention policy, (b) per-key rate-limit with token-bucket Redis, (c) GitHub Secret Scanning Partner Program registration + webhook handler, (d) SOC2 Common Criteria 6.1 grounding. Q7 in this discovery captures the partner-program SHAPE; the IMPLEMENTATION belongs to cloud.

### D5 — Tests corner scope discipline (no DEFER fired)

**Decision (revised v1.1):** The `tests` corner is populated with exactly 1 focused question (Q6 — Supabase auth rotation/grace test patterns). No DEFER-CORNER marker needed — Q6 satisfies the ≥ 1 minimum. The v1.0 draft considered deferring; v1.1 chose to actually include the question because Supabase auth's Postgres shape is close enough to ours that the test pattern translates cleanly.

**Rationale:** Per `discover-plan-golden-rule.md` § Rules that cannot be bent — "min 1 per corner OR DEFER-CORNER". Having 1 question is the simpler honest path than deferring. Our `testing.md` already locks the vitest + ankane/pgvector pattern; Q6 just borrows the rotation-grace test SHAPE.

**Consequences:** Coverage Matrix shows tests=1 (Q6) with explicit narrow scope. No DEFER marker in the document.

### D6 — Honest acknowledgement of ADR-0009 supersession path

**Decision:** This blueprint is positioned to potentially SUPERSEDE the "OAuth / OIDC deferred to v1.x" row of ADR-0009. If Q4 finds that OIDC bridge is structurally simpler than ADR-0009 estimated (e.g., a JWKS-validation middleware in <200 LoC), the implementation plan will document this in an `ADR-0009-supersession.md` companion ADR, not silently rewrite ADR-0009 (history preservation per `.claude/rules/architecture.md`).

**Rationale:** ADR-0009 is locked + cited by `memory-contract-v0-0-plan.md`. Honest supersession via new ADR is the canonical path.

**Consequences:** If Q4 finds OIDC easier than estimated, the implementation plan ships a new ADR; ADR-0009 stays as historical record.

### D7 — SOC2 paywall fallback policy (absorbed from EC-9 DOCUMENT)

**Decision:** Q5 sub-claim "SOC2 Type II mandates" will be honest-BLOCKED if `/discover-execute` cannot fetch authoritative AICPA SOC2 text (paywalled). Anchor compliance reference becomes **GDPR Article 30** (publicly accessible). The blueprint will explicitly state "SOC2 Common Criteria 6.1 paraphrase per industry convention; canonical AICPA text behind paywall and not citable per allowlist policy" rather than fabricate a SOC2 quote.

**Rationale:** Inquebrável Rule 3 + `discover-blueprint-golden-rule.md` § fabricated_citation INVALID cap. Paraphrasing a paywalled spec without citation is exactly the failure mode the gate exists to prevent. GDPR Art. 30 is publicly available via eur-lex.europa.eu — if used, add `eur-lex.europa.eu` to the allowlist with rationale citing this slug. Camada 4 cloud-repo plan (D4) absorbs SOC2 specificity (cloud team has AICPA vendor access).

**Consequences:** Q5 audit-log schema recommendation is grounded in (a) GDPR Art. 30 fields + (b) Supabase/PostHog observed schemas, NOT in SOC2 directly. Honest gap declared in blueprint.

### D8 — D6 supersession is CONDITIONAL on Q4 completion (absorbed from EC-10 DOCUMENT)

**Decision:** The "ADR-0009 supersession" path in D6 is CONDITIONAL on Q4 successfully completing Fase B (i.e., RFC 6749 + 7662 + 8693 parsed + Hydra introspection docs reachable + structural simplicity confirmed). If Q4 is BLOCKED (RFC timeout, Hydra docs gated, etc.), the blueprint will NOT recommend supersession; ADR-0009 stays unchanged, Camada 3 ships preserving the "OAuth deferred to v1.x" status quo, and a follow-up discovery plan is recommended.

**Rationale:** Recommending supersession without the empirical RFC + impl evidence violates Rule 3. Honest "investigation incomplete → status quo preserved" is the right exit.

**Consequences:** Blueprint Recommendations section will gate D6 behind "if Q4 completed". The plan-confidence score will not penalize the conditional (a conditional recommendation is honest, not weak).

## Research Questions

**8 questions total** (Q1-Q8 contiguous), all within the 4 canonical corners (no custom corners — per check_research_coverage.py M2 enforcer, only the canonical {tests, deps, tools, techniques} count). Within the 5-10 cap of `discover-plan-golden-rule.md`. Per-corner distribution:

- **techniques** (canonical): 3 (Q1 token model, Q2 scope vocabulary, Q4 OIDC bridge) — at the max=3 cap
- **tools** (canonical): 3 (Q3 OSS lifecycle CRUD tooling, Q7 secret scanning, Q8 MCP transport auth) — at max=3 cap
- **deps** (canonical): 1 (Q5 npm libs for JWKS/DPoP — renamed from "Q-deps-1" for QID regex compliance)
- **tests** (canonical): 1 (Q6 Supabase auth rotation/grace tests — renamed from "Q-tests-1")

All 4 canonical corners populated (≥ 1 each), all at or below max=3. The Q5 audit-log + rate-limit cluster originally drafted in v1.0 was DROPPED from this discovery and migrated to D4-expanded for the follow-up cloud-repo plan — its content is Camada-4 specific (TheoCloud audit table + rate-limit-Redis bucket) and out of scope for the OSS Camadas 2+3 implementation that this blueprint targets.

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Token format + show-once UX: what prefix discipline + hash-at-rest algo + show-once pattern do FAANG-OSS projects use, and how does that align with theo-cloud's existing `theo_live_*` (Stripe-shape) already shipped in `routes/api_keys.go`? | techniques | Stripe (anchor), Supabase, PostHog, GitHub PAT | WebSearch `"Stripe API key prefix" "sk_live_"` + `"Supabase service role key" format` + `"PostHog personal API key" format`. Local: `grep -rn "theo_live_\|key_prefix\|SHA-256" .claude/knowledge-base/references/mem0/ .claude/knowledge-base/references/letta/` (expected: mostly empty — Mem0/Letta don't ship API-key lifecycle) | Read 2 Stripe doc pages + 1 Supabase docs page. **For PostHog source (per EC-1 absorption): Search github.com `repo:PostHog/posthog "personal_api_key" OR "PersonalAPIKey"` to LOCATE the canonical file, THEN Read.** No hard-coded paths. | Table: project × {prefix, hash algo, length, encoding, show-once strategy}. Verdict: "theo_live_ is already canonical; reuse pattern in `@usetheo/memory/server` Camada 2 — ADOPT pattern, REUSE existing code from cloud repo." |
| Q2 | Scope vocabulary: what's the granularity convention (resource:verb like `memory:read` vs broad role like `admin`)? How is scope checked at middleware boundary? **Per EC-2 absorption: explicitly investigate BOTH GitHub PAT variants — classic (legacy `repo`/`gist`/`admin:org` broad scopes) AND fine-grained (`contents:read`/`metadata:read` resource:verb pattern) — to capture the granularity tension directly.** | techniques | GitHub PAT (both classic + fine-grained), Stripe restricted keys, Auth0 RBAC | WebSearch sub-queries: (a) `"GitHub PAT classic" scopes list site:docs.github.com`, (b) `"GitHub fine-grained personal access token" permissions site:docs.github.com`, (c) `"Stripe restricted keys" capabilities`, (d) `"Auth0 RBAC scope claim"` | Read 4 doc pages: docs.github.com classic-PAT scopes + docs.github.com fine-grained-PAT permissions + docs.stripe.com restricted-keys + auth0.com RBAC docs. | Comparison: scope-granularity-tradeoff table with explicit classic-vs-fine-grained row showing GitHub's own evolution. Verdict on whether to evolve `memory:read/write/delete/admin` (current) to finer grain (e.g., `memory:scope:user:read`). |
| Q3 | OSS lifecycle CRUD tooling: how do Supabase / PostHog / Cal.com / Plausible expose API-key CRUD in self-host? Same UI as cloud? Admin CLI? What persistence schema do they use? (Classified as `tools` because the answer characterizes the user-facing tooling layer — UI components + admin CLI — that each OSS project ships for lifecycle.) | tools | Supabase, PostHog, Cal.com, Plausible | WebSearch `"Supabase self-host" "API keys"` + `"PostHog self-host" "personal API key"` + `"Cal.com" "API key" docs` + `"Plausible CE" "API key"` | **Per EC-3 absorption: for EACH of the 4 projects, FIRST search github.com to LOCATE the canonical files (e.g., `repo:supabase/supabase "personal_access_token" path:**/api-keys/`, `repo:PostHog/posthog "personalAPIKey"`, `repo:calcom/cal.com "apiKey"`, `repo:plausible/analytics "api_key"`), THEN Read.** No hard-coded paths in this column. Budget per project: 2.5 min (locate ~30s, read ~2min). | Table per project: {UI parity yes/no, CLI parity yes/no, schema (cols), retention/audit on by default yes/no}. Verdict ADOPT/BORROW/REJECT per project. |
| Q4 | OIDC bridge: how does a Bearer-Authorization service that natively uses `theo_live_*`-style API keys ALSO accept OAuth2 access tokens from an external OIDC issuer (Hydra, Keycloak, Auth0, Okta, Azure AD)? Dual-mode middleware vs token-exchange RFC 8693. | techniques | Ory Hydra (deployed in our cluster), Auth0, RFC 6749 + 7662 + 8693 | WebSearch `"Ory Hydra" "token introspection"` + `"OAuth2 introspection RFC 7662" middleware` + `"RFC 8693 token exchange"` use cases. Read RFC text directly. | WebFetch RFC 7662 + RFC 8693 + Hydra introspection docs. Read github.com `ory/hydra` `oauth2/introspector.go` for protocol shape. Read `auth0.com` token-exchange section. | Two-path architecture diagram: (a) dual-validation middleware accepting EITHER `theo_live_*` OR `Bearer <JWT>` with JWKS validation; (b) token-exchange endpoint that converts OIDC JWT → `theo_live_*`. Trade-off matrix. Verdict: which path for Camada 3. May supersede ADR-0009 OAuth-deferral row per D6. |
| Q5 | Dependency picks: which npm packages (jose / @panva/oauth4webapi / express-jwt / hono-jwt) are the de-facto JWKS-validation + OIDC introspect + DPoP libs for a Hono server in 2026? Maintenance signal, security audit history, transitive dep blast-radius. | deps | npm registry (npmjs.com), github.com (issue trackers) | WebSearch `"jose npm"` + `"@panva/oauth4webapi"` + `"hono jwt middleware"` + `"DPoP npm"` | Read npmjs.com pages for each (download count, last release, deps tree); github.com issue/PR activity | Table of 4 libs × {weekly DLs, last release, deps depth, CVE history, license, hono compat}. Recommendation per Rule 9 evaluation gate (`deps-audit-golden-rule.md`). |
| Q6 | Test patterns for token rotation + scope-check middleware: how does Supabase GoTrue (now renamed `supabase/auth`) test its access-token rotation grace window + RLS-policy enforcement? What pattern translates to vitest + ankane/pgvector? | tests | Supabase auth (github.com/supabase/auth — formerly GoTrue) | WebSearch `"Supabase auth" "refresh token" test` + `"supabase auth" rotation grace` | **Per EC-4 absorption: search github.com `repo:supabase/auth "*token_test*" OR "*refresh_test*"` to LOCATE rotation test file, THEN Read.** Fallback if search returns 0: try `repo:supabase/auth path:internal/api filename:token*` or `repo:supabase/auth filename:refresh*`. Second fallback: `supabase-community/auth-py` tests. | Test-shape recipe: 1 file with rotation-grace test + 1 file with scope-check positive/negative cases. Adapt to vitest in implementation plan. |
| Q7 | Secret scanning partnership: how does GitHub's Secret Scanning Partner Program register a prefix? What does the webhook callback contract look like? Auto-revoke flow on leak detection? Does GitLab have an equivalent? | tools | docs.github.com (canonical), GitLab equivalent if exists | WebSearch `"GitHub secret scanning partner program"` registration + `"secret scanning webhook"` payload shape + `"GitLab secret detection partner"` | WebFetch docs.github.com partner-program page + sample callback handler from `github.com/github/secret_scanning_partner_demo` if public | Registration procedure + webhook payload schema + revoke handler stub. Verdict: Camada 4 task (TheoCloud-only); doc for cloud-repo plan. |
| Q8 | MCP transport auth: how does the MCP spec community handle auth for the streamable-HTTP transport? Canonical Bearer model? OAuth2? Examples? | tools | spec.modelcontextprotocol.io, github.com/modelcontextprotocol | WebSearch `"MCP streamable HTTP transport" authentication` + `"model context protocol" Bearer` + spec.modelcontextprotocol.io transport sections | WebFetch spec.modelcontextprotocol.io transport spec + github.com mcp reference impl auth examples + read local `src/agent-tools/server.ts` `src/agent-tools/cli-scope.ts` to compare current scope-binding approach | Spec citation + recommended Bearer model for streamable-HTTP. Verdict: ADOPT-as-is (if spec is clear) or CONCEPTUAL_BORROW from spec + add Bearer check in `src/agent-tools/server.ts` for non-stdio transport. |

**Re-numbered final structure (v1.1 final):** 8 questions Q1-Q8 contiguous, all in canonical corners. Per-corner: techniques=3 (Q1, Q2, Q4), tools=3 (Q3, Q7, Q8), deps=1 (Q5), tests=1 (Q6). All 4 canonical corners populated at or below max=3 cap. The earlier draft's audit-log + rate-limit Q (formerly Q5) was DROPPED here and moved to D4-expanded as the second cloud-repo follow-up surface (alongside Q7's Camada 4 portion).

## Coverage Matrix

| Corner | Questions | Method-mapped | Citation source planned |
|---|---|---|---|
| **techniques** (canonical) | Q1, Q2, Q4 | All 3 → WebSearch Fase A + WebFetch Fase B | docs.stripe.com (Q1), docs.github.com (Q2), www.rfc-editor.org + www.ory.sh + auth0.com (Q4) |
| **tools** (canonical) | Q3, Q7, Q8 | All 3 → WebSearch + WebFetch + github.com search-then-Read | supabase.com + posthog.com + cal.com + plausible.io (Q3), docs.github.com (Q7), spec.modelcontextprotocol.io (Q8) |
| **deps** (canonical) | Q5 | npmjs.com page reads + github.com issue activity | npmjs.com, github.com |
| **tests** (canonical) | Q6 | github.com source read with search-then-locate fallback | github.com/supabase/auth |

100% coverage: every question maps to ≥ 1 method; every method maps to ≥ 1 allowlisted-domain OR local-references path. All 4 canonical corners populated. No DEFER-CORNER markers fired.

## Halt-loop checkpoints

For `/discover-execute` per `cycle-discover.md v1.1`:

- **Per-question completion gate:** mark question DONE only when (a) Fase A produced hotspots OR was honest-BLOCKED with documented stop-condition reason; (b) Fase B captured ≥ 1 line-exact citation per hotspot OR sub-question; (c) the answer is rendered in the blueprint's question section in prose, not just bullets.
- **Per-Q time gate:** if Q's budget (per D1 breakdown) exceeded with the question still incomplete, halt that Q with `BLOCKED — budget exhausted` and continue to next.
- **Per-project time gate:** N/A (this is a multi-project investigation; per-question gate suffices).
- **Coverage corner gate:** before emitting `<promise>BLUEPRINT_COMPLETE</promise>`, verify all 4 canonical corners (techniques/tools/deps/tests) have ≥ 1 non-BLOCKED question. If a corner is fully BLOCKED, emit `<promise>BLUEPRINT_BLOCKED</promise>` with reason.
- **Citation gate:** every citation in the blueprint MUST resolve via `Path.exists()` (for local refs) OR be a URL whose host is in the allowlist (`.claude/rules/discover-web-allowlist.txt`). Fabricated/non-allowlisted = `discover-blueprint-golden-rule.md` INVALID cap.
- **Verdict matrix gate:** D3 mandates a verdict matrix populated for every Q × candidate cell that the Q-row touches. Empty cells = blueprint not done.

### Checkpoints absorbed from /discover-edge-cases v1.0 review (2026-06-07)

- **EC-6 — Pre-Fase-B path-existence validation (cross-cutting Q1, Q3, Q4, Q7, Q-tests-1, Q-deps-1):** before executing any Fase B that cites a github.com path, validate the URL returns HTTP 200 via `WebFetch HEAD` (or `curl --silent --output /dev/null --write-out '%{http_code}'`). If 404 → the per-question "search-then-locate" fallback declared in Method column kicks in (absorbed from EC-1+EC-3+EC-4 MUST FIX). Honest BLOCKED only after BOTH the hard-coded path AND the located-via-search path fail.
- **EC-7 — Gated-docs detection in Q7 (Secret scanning partner program):** detect HTTP 401/403 OR redirect-to-login on the first WebFetch to `docs.github.com` Partner Program page. If gated → mark Q7 sub-claim "registration procedure" BLOCKED with reason "docs.github.com partner-program requires login"; fall back to `github.com/github/secret_scanning_partner_demo` README (public) AND to the public Partner Program announcement post (allowlist may need `github.blog` if cited — add per same EC-2 absorption pattern with rationale).
- **EC-8 — Custom-corner classifier sanity gate:** before emitting `<promise>BLUEPRINT_COMPLETE</promise>`, dry-run `check_research_coverage.py` (or equivalent) on the blueprint to verify the checker treats the 4 canonical corners (techniques/tools/deps/tests) as the gating set and that each has ≥ 1 non-BLOCKED question. The 2 custom corners (integration_patterns, protocols) are additive — they must NOT subtract from the canonical count. If the checker requires re-classification, classify Q3 → techniques AND Q4 → techniques in the JSON output WITHOUT modifying the prose Coverage Matrix (preserves semantic clarity for human readers while satisfying the deterministic gate).

## Acceptance Criteria

The discovery is "done" when:

- [ ] All 8 questions answered OR honest-BLOCKED with documented stop-condition reason per D1.
- [ ] Blueprint file at `.claude/knowledge-base/discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md` (to be PRODUCED by `/discover-execute`; does NOT exist yet) is written with all required sections (4 coverage corners + verdict matrix + recommendations + blocked questions).
- [ ] Every citation in the blueprint resolves: local paths via `Path.exists()`, URLs via allowlist host match.
- [ ] Verdict matrix populated for every cell that maps to a Q row.
- [ ] At least one ADR in the blueprint (D3-style verdict matrix shape is one).
- [ ] `## Recommendations` section concludes with explicit Camada 2 ADOPT-list + Camada 3 ADOPT-list + Camada 4 FOLLOW-UP-CLOUD-REPO-list per D4.
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS (per the cycle hard gate).

## Global Definition of Done

Per `discover-plan-golden-rule.md` (this skill's golden rule) + `discover-blueprint-golden-rule.md` (the next skill's golden rule):

- [ ] Plan structurally complete (all 10 sections per template).
- [ ] Question budget 5-10 satisfied (8 questions).
- [ ] Per-corner ≥ 1 (or DEFER-CORNER marker — N/A, no canonical corner deferred).
- [ ] Method present on every Q (Fase A + Fase B columns).
- [ ] All `.claude/knowledge-base/references/{...}` citations verified to exist via `Path.exists()`.
- [ ] All URLs cited are within the allowlist (extended at 2026-06-07 with 8 entries per D2).
- [ ] ADRs cover HOW to investigate (D1 budget, D2 WebSearch-first, D3 output shape, D4 Camada-4 follow-up, D5 corner-coverage justification, D5-supplement custom corners, D6 ADR-0009 supersession path).
- [ ] `/discover-plan-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS.
- [ ] After the chain completes through `/discover-execute` + `/discover-confidence`: blueprint at `.claude/knowledge-base/discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md` ≥ SHIPPABLE_WITH_CAVEATS.
- [ ] The downstream implementation `/to-plan` cites this discovery via `@see .claude/knowledge-base/discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md`.
- [ ] Plan archived to `.claude/knowledge-base/discoveries/plans/` (already there — no separate `completed/` for discovery plans per `audit-trail-rotation.md`).

## Related

- [`ADR-0009 cloud-auth-theokit-api-key`](../../adrs/ADR-0009-cloud-auth-theokit-api-key.md) — supersession candidate per D6
- [`ADR-0008 dip-method-counts`](../../adrs/ADR-0008-dip-method-counts.md) — DIP cap that any new middleware DIP must respect
- [`completed/v0-2-theokit-binding-plan`](../../plans/completed/v0-2-theokit-binding-plan.md) — theokit subpath integration precedent
- [`rules/architecture.md`](../../../rules/architecture.md) — DIP boundary rules any new auth middleware must respect
- [`rules/testing.md`](../../../rules/testing.md) — test pyramid for the integration tests Camada 2 ships
- [`rules/discover-plan-golden-rule.md`](../../../rules/discover-plan-golden-rule.md) — this plan's gate
- [`rules/discover-blueprint-golden-rule.md`](../../../rules/discover-blueprint-golden-rule.md) — next phase's gate
- [`rules/cycle-discover.md`](../../../rules/cycle-discover.md) — cycle SoT (v1.1 paired-knowledge-skills spec)
- [`rules/discover-web-allowlist.txt`](../../../rules/discover-web-allowlist.txt) — allowlist extended at 2026-06-07 with 8 entries citing this slug
- TheoCloud canonical Stripe-shape impl: `/home/paulo/Projetos/usetheo/theo-cloud/theo/cloud/internal/routes/api_keys.go` (anchor reference for Q1, Q2, Q3, Q5)
- TheMemory MCP server: `src/agent-tools/server.ts` + `src/agent-tools/cli-scope.ts` (Q8 baseline)
