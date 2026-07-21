# Discovery Plan: Claude Code ⇄ theo-memory via the Theo MCP Gateway (dev)

> **Version 1.0** — This discovery establishes, from primary specifications and working
> implementations, the state-of-the-art way to wire every Claude Code instance to theo-memory
> through the Theo MCP Gateway on the dev environment. Sources in scope are the Claude Code and
> MCP specifications (web), the `theo-cloud` / `theo-workspace` gateway sources (in-repo), the
> live dev deployment (probe + SSH), and at least two OSS implementations of gateway-fronted
> multi-tenant MCP. The expected output is a blueprint that resolves M6's Unresolved Question #1
> (the edge host/path accepting a `theo_live_*` key) and specifies the client wiring end-to-end.

**Slug:** `claude-code-mcp-gateway-dev`
**Owner:** paulohenriquevn
**Created:** 2026-07-21
**Time budget:** 6h (per-source breakdown in ADR D1)

## Context

M6 shipped the Claude Code kit and closed with one blocker, stated plainly in
`knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md`:

> **⚠️ OPEN QUESTION (blocks go-live, not the plan):** the PRODUCTION edge host/path was NOT
> externally verifiable … **Resolve the prod edge host/path that accepts a `theo_live_*` key with
> the team before wiring the hooks/MCP.**

That question stayed open, and the kit was activated anyway on 2026-07-21. Live verification this
session produced the evidence below.

| Observation | Evidence |
|---|---|
| The dev REST accepts unauthenticated reads AND writes from an arbitrary internet IP | `POST 165.227.121.20:8080/v1/remember` → 201 with no `Authorization` header and with an invalid token → issue #101 |
| The MCP was registered as stdio, placing Postgres and OpenAI credentials on every client | `claude mcp add … -- node …/cli.js mcp` with `THEOMEM_PG_URI` + `OPENAI_API_KEY` |
| Configuration alone cannot point the kit at the gateway | `docs/claude-code-kit/hooks/theo-lib.mjs` builds `${url}/v1/recall`; the gateway path is `/v1/memory/recall` |
| A `/mcp` edge router exists and is the documented correct surface | `theo-cloud/theo-workspace/dev/traefik/dynamic.yml:79-91` — `PathPrefix(/mcp)` → `theo-mcp-gateway:18090`, "the gateway IS the MCP-aware auth … injects it downstream" |
| The `/mcp` route answers on dev, contract unverified | `POST https://app-dev.usetheo.dev/mcp` → 405 |
| The credential supply chain is broken on dev | `theo_api_keys` → `0 total, 0 active`, despite a dashboard-minted key |

Governing rules: `.claude/rules/cycle-discover.md`, `.claude/rules/discover-blueprint-golden-rule.md`,
and the M7 entry in `ROADMAP.md`.

## Objective

Determine the state-of-the-art wiring that lets every Claude Code instance reach theo-memory
through the Theo MCP Gateway on dev, holding exactly one scoped secret on the client.

- [ ] All seven research questions answered with resolvable citations (allowlisted URL, `file:line`, or a recorded request/response transcript)
- [ ] All four coverage corners populated in the blueprint
- [ ] At least one ADR proposing the integration design, with its rejected alternatives named
- [ ] M6 Unresolved Question #1 resolved, or its owner and missing artifact named precisely
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `docs.claude.com` / `docs.anthropic.com` (web, allowlisted) | Claude Code MCP + settings documentation | Primary specification for the client surface; the M7 DoD requires primary sources |
| `modelcontextprotocol.io` (web, allowlisted) | Transports + authorization specification | Normative source for transport revision and the remote-auth model |
| `github.com` (web, allowlisted) | Repositories implementing gateway-fronted multi-tenant MCP | The M7 DoD requires ≥ 2 real implementations |
| `theo-cloud/theo-workspace/dev/traefik/` | `dynamic.yml` | Declares the `/mcp` router, its service, and the absence of middlewares |
| `theo-cloud/theo-cloud/internal/` | `auth/scope.go`, `routes/api_keys.go`, `routes/forward_auth.go` | The credential lifecycle and the ForwardAuth contract |
| Live dev deployment | `app-dev.usetheo.dev`, droplet `165.227.121.20` | Deployed behaviour is established by probing, never by inference |
| `docs/claude-code-kit/` (this repo) | `hooks/`, `install.sh`, `README.md` | The client artifact this milestone corrects |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| The local stack (`localhost:8090`, host theo-memory `:18081`) | The owner scoped M7 to the dev environment; local is a debugging aid, never the deliverable |
| `knowledge-base/references/graphiti`, `.../mem0` | Memory engines, not Claude Code integrations — no bearing on the transport/auth question |
| The hooks-versus-MCP question | Settled by M6 ADR-1 (hooks-first hybrid) across two independent frames; this discovery extends it to transport, it does not re-open it |
| The migration tool | Shipped in M6 |
| Production (non-dev) hosts | M7 targets dev only |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Gateway contract and credential lifecycle: 3h (Q3, Q7). Client specification:
1.5h (Q1, Q2). Breadth — spec + OSS: 1.5h (Q4, Q5, Q6).

**Rationale:** Q3 and Q7 are the two blocking unknowns; a hard blocker in either invalidates the
design work that follows. Spending the first half of the budget there surfaces a blocker on day
one instead of after the breadth research is sunk.

**Alternatives considered:** equal split across the seven questions (rejected — treats a blocking
unknown and a breadth question as equally urgent); breadth-first (rejected — risks producing a
polished design against a gateway that turns out to be undeployed).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty after three
attempts with different query variants, mark the question BLOCKED with reason "Fase A exhausted"
and continue. Never pad with hotspots from another question's scope.

**Stop condition — per source (mandatory):** When a source's budget is exhausted with questions
still pending, mark those BLOCKED with reason "budget exhausted" and continue to the next source.
When every remaining question is either `done` or honestly `blocked`, emit
`<promise>BLUEPRINT_BLOCKED</promise>` — never `BLUEPRINT_COMPLETE` from a state with blocked
questions.

**Anti-pattern:** Fabricating a Fase B answer to close a question whose Fase A was exhausted.
Honest BLOCKED with a reason is required (Unbreakable Rule 3).

**Consequences:** A gateway that turns out to be undeployed blocks Q3 within the first 3h, and
the blueprint records the owning team rather than designing an insecure fallback.

### D2 — Investigation depth

**Decision:** Read specification pages end-to-end for Q1, Q2, and Q4. For in-repo sources, read
each cited symbol in full context rather than grepping for its name. For deployed behaviour,
capture the complete request and response including headers.

**Rationale:** The failure this milestone corrects came from concluding a contract from a status
code. Full headers and full symbol bodies are what distinguish an established fact from a guess.

**Consequences:** Slower per question; every deployed-behaviour claim carries a transcript.

### D3 — Primary sources gate the design

**Decision:** Every transport and authorization claim cites the Claude Code documentation or the
MCP specification.

**Rationale:** The in-repo kit README is the artifact under suspicion — its "single config knob"
claim was already falsified by this session's table test.

**Alternatives considered:** Trusting the kit README (rejected — demonstrably wrong); trusting
the M6 blueprint alone (rejected — it explicitly deferred this question).

**Consequences:** A question whose primary source is unreachable is BLOCKED rather than answered
from memory.

### D4 — Deployed behaviour is verified, never inferred

**Decision:** The gateway contract is established by probing the dev deployment and reading the
deployed artifact, not by reading `dynamic.yml` alone.

**Rationale:** `dynamic.yml` in `theo-workspace/dev/` describes the LOCAL edge, and the deployed
BFF is already known to lag `develop` (it serves `/v1/memory/skills` but 404s on
`/v1/memory/recall`, which exists at `theo-cloud/theo-cloud/cmd/main.go:916`).

**Consequences:** Q3 requires live access; without it, Q3 is BLOCKED, not assumed.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Which MCP transports does Claude Code support, and does the HTTP transport accept a **static** `Authorization` header or mandate an OAuth flow? | tools | `docs.claude.com`, `docs.anthropic.com` | WebFetch the Claude Code MCP page; locate the transport and header sections | Read both sections end-to-end, including any auth caveat | Table: transport → CLI flag → auth mechanism → constraint, with URLs |
| Q2 | What is Claude Code's configuration precedence, and which scope makes an MCP server plus hooks apply to **all** instances of one user? | tools | `docs.claude.com`, `docs.anthropic.com` | WebFetch the settings and MCP-scope pages | Read the precedence table and each scope definition | Ordered precedence list + the exact scope for global reach, with URLs |
| Q3 | What is the Theo MCP Gateway's wire contract on dev — path, method, handshake, auth header, tenant resolution — and what is its deployed state? | tools | `theo-workspace/dev/traefik/dynamic.yml`, `theo-cloud` gateway source, live dev | Probe `app-dev.usetheo.dev/mcp` capturing full headers; `docker ps` over SSH to enumerate the deployed services | Read the gateway's request handler; record the complete handshake transcript | Request/response transcript naming the answering hop + the resolved contract |
| Q4 | What does the MCP specification mandate for remote-server authorization, and which transport revision is current? | techniques | `modelcontextprotocol.io` | WebFetch the transports and authorization pages | Read the normative requirements, including any static-token guidance | Normative summary + the transport revision each side must speak |
| Q5 | How do at least two real OSS projects expose a remote, multi-tenant MCP server behind a gateway? | techniques | `github.com` | WebSearch for gateway-fronted multi-tenant MCP servers; shortlist candidates | Read each repository's auth path and its test for that path | Two or more named repos with `file:line` citations, plus rejected candidates and why |
| Q6 | Which assertions must an end-to-end test make for a gateway-fronted MCP integration? | tests | `theo-cloud` e2e suite, the Q5 repositories | Grep `theo-cloud` for `TestEdgeForwardAuthTenantIsolationE2E`; locate the equivalent tests in the Q5 repos | Read each test end-to-end | Assertion list a regression guard must satisfy, with citations |
| Q7 | What is the lifecycle of a dashboard-minted `theo_live_*` — mint, persist, validate — and why is `theo_api_keys` empty on dev? | deps | `theo-cloud/theo-cloud/internal/routes/api_keys.go`, `.../auth/scope.go`, live dev DB | Read the mint handler and the validation query; inspect the deployed table over SSH | Exercise the dashboard mint flow and observe whether the row persists | Root cause: creation defect versus environment reset, with evidence |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q6 | Covered |
| Dependencies | Q7 | Covered |
| Tools | Q1, Q2, Q3 | Covered |
| Techniques | Q4, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Edge cases absorbed (`/discover-edge-cases`, 2026-07-21)

- **EC-1 — Q1 is pivotal (HIGH).** An OAuth-only HTTP transport collapses the
  `theo_live_*`-as-bearer design. *Acceptance:* Q1 is answered before any design work, and states
  explicitly whether a static header is supported. *Owner:* this discovery.
- **EC-2 — Attribute the 405 to a specific hop (HIGH).** The status alone could come from
  Cloudflare, Caddy, Traefik, or the gateway. Concluding "the route exists" from it repeats the
  error this milestone corrects. *Acceptance:* Q3 records full response headers and names the
  answering hop. *Owner:* this discovery.
- **EC-3 — SSE is superseded in the MCP spec (MEDIUM).** A gateway speaking legacy SSE against a
  client expecting Streamable HTTP fails in a way that resembles an auth error. *Acceptance:* Q4
  states the revision each side implements; Q3 records the actual handshake. *Owner:* this discovery.
- **EC-4 — Quality bar for OSS evidence (MEDIUM).** Two demos prove nothing. *Acceptance:* each
  cited repository shows a real auth path and a test exercising it; toy examples are recorded as
  rejected with the reason. *Owner:* Q5.
- **EC-5 — Q3 depends on another team (HIGH).** The Theo MCP Gateway is a delegated track.
  *Acceptance:* if it is not deployed on dev, Q3 is BLOCKED naming the owning team and the missing
  artifact; the discovery substitutes no insecure fallback. *Owner:* gateway team.
- **EC-6 — The mint flow writes to the owner's account (LOW).** *Acceptance:* any key minted
  during discovery is recorded and revoked at the end; its secret never enters a committed file.
- **EC-7 — Documentation origin may differ (LOW).** *Acceptance:* a fetch failure on
  `docs.claude.com` is retried on `docs.anthropic.com` before the question is declared blocked.

## Halt-loop Checkpoints

A question moves to `done` only when all of the following hold:

1. Its answer cites a resolvable source — an allowlisted URL, a `file:line`, or a recorded
   request/response transcript.
2. Every claim about deployed behaviour carries live evidence; source-only inference is insufficient.
3. Claims about the client surface cite the Claude Code documentation or the MCP specification (D3).

A question moves to `blocked` only with a stated reason and a named owner. Silent skipping is
forbidden.

## Acceptance Criteria

- All seven questions are `done` or `blocked` with a named owner.
- Every citation resolves: `Path.exists` for files, allowlisted domain for URLs.
- All four coverage corners are populated in the blueprint.
- At least one ADR records the chosen integration design together with its rejected alternatives.
- M6 Unresolved Question #1 is resolved, or its owner and the missing artifact are named precisely.

## Global Definition of Done

`/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS per
`.claude/rules/discover-blueprint-golden-rule.md`. Both hard caps apply: all four coverage corners
non-empty, and zero fabricated citations.
