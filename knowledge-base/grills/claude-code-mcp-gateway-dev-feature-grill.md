---
slug: claude-code-mcp-gateway-dev
milestone_id: M7
date: 2026-07-21
generated_by: roadmap-feature
status: completed
---

# Focused grill — claude-code-mcp-gateway-dev (M7)

## Q1 — What is this feature and why NOW?

**Answer:** Correct integration via the Theo MCP Gateway on dev.

Today's activation of the M6 kit revealed the live integration is on the wrong
architecture: the MCP was registered as **stdio** (Postgres + OpenAI credentials on every
client) and the hooks point at the **raw REST with no authentication**. The correct design
is documented in `theo-workspace/dev/traefik/dynamic.yml:79-91` — `/mcp` → Theo MCP
Gateway, which performs MCP-aware auth and injects the downstream credential (Model B).
Urgency: the global Claude Code memory is *already* wired to an endpoint that accepts
unauthenticated writes from the public internet.

## Q2 — Which milestones must be `[x]` first?

**Answer:** **M5 + M6.**

M6 shipped the kit + batch endpoint that this milestone reconfigures; M5 is the CD pipeline
that any gateway/BFF redeploy rides. Both are `[x]`, so M7 is immediately eligible.

## Q3 — Verifiable Definition of Done

**Answer (verbatim, owner):** *"QUERO SOTA LEVEL A MELHOR FORMA DE USAR O CLAUDE CODE EM
NOSSO SISTEMA NAO IMPORTA O ESFORÇO! ISSO É UMA ORDEM SEM WORKAROUNDS"*

Derived into the milestone's DoD: (1) a discovery blueprint establishes the SOTA Claude Code
integration surface from primary sources + ≥2 real OSS implementations, with rejected
alternatives in an ADR — nothing assumed; (2) gateway-only data path with exactly ONE secret
on the client; (3) fail-closed proven at the edge with real evidence; (4) tenant isolation
proven e2e; (5) a new instance on a different project works with ONE command; (6) no
workaround left in the path (kit dialect fixed properly; no client on the unauthenticated
endpoint); (7) an automated regression guard.

## Q4 — Top 2 NEW risks

**Answer (verbatim, owner):** *"EU NAO ME IMPORTO COM O RISCO VOCE NAO DEVE FAZER ALGO
INSEGURO E FAANG LEVEL SE O THEO-MEMORY NAO FUNCIONA COM O CLAUDE CODE ELE É UM PRODUTO
MORTO"*

Interpretation recorded in the milestone: **schedule/effort risk is accepted; insecure
shortcuts are not.** The two material risks are captured as (1) dependency on the
Theo MCP Gateway — a delegated track owned by another team, and (2) the broken credential
supply chain in dev (`theo_api_keys` empty despite a UI-minted key).

## Out-of-scope cross-check

Ran against `ROADMAP.md § Explicitly out of scope` (graph-DB backend; wrapping competitors
as a data-adapter; maintained-on-write entity summaries). **No overlap** — this milestone is
transport/auth wiring for an existing capability, not a new memory capability.

## Evidence gathered during the grill (all first-hand this session)

| Finding | Evidence |
|---|---|
| theo-memory REST **is** up to date on dev | `/v1/version` → `develop-95693dc` (the session's last commit) |
| theo-cloud BFF deploy is **behind** `develop` | `cmd/main.go:915-917` has `POST /v1/memory/{remember,recall,reflect}`; the deployed BFF returns **404** on them while `/v1/memory/skills` returns 401 (exists) |
| The dev REST accepts **unauthenticated** reads AND writes from the public internet | 201 with no `Authorization` header and with an invalid token, from an arbitrary IP → issue #101 |
| The user's `theo_live_*` key does not exist in the deployed store | `sha256` lookup → 0 rows; `theo_api_keys` → `0 total, 0 active` |
| MCP scope binding works via env | `THEOMEM_MCP_DEFAULT_USER_ID` → `recall` executed ("No memories matched") instead of `MissingScopeError` |
| The kit cannot reach the gateway by config alone | `theo-lib.mjs` builds `${url}/v1/recall`; the gateway expects `/v1/memory/recall` — the M6 log's "single config knob" claim was wrong |
| The `/mcp` edge route exists on dev | `POST https://app-dev.usetheo.dev/mcp` → **405** (not 404); local edge → **502** (gateway service down locally) |
