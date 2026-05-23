# Discovery Plan: v0.3 — Agent tools (MCP)

> **Version 1.1** — Investigate how to expose `@usetheo/memory`'s `remember` / `recall` / `forget` / `reflect` verbs as MCP (Model Context Protocol) tools for `@usetheo/sdk` agents. Roadmap Item 4. Reference projects: `referencia/letta/` (full MCP client/server implementation — primary), `referencia/mem0/` (MCP plugin shape only — secondary), `referencia/langmem/` (LangGraph BaseStore tool pattern — tertiary). Plus prior_art on the MCP spec itself + the sibling `@usetheo/sdk` tool-provider contract. The blueprint will inform `/to-plan v0-3-agent-tools-mcp` by locking: (a) transport choice (stdio vs SSE vs streamable-HTTP), (b) tool schema shape + validation pattern, (c) cross-tool state isolation strategy, (d) integration surface with `@usetheo/sdk`, (e) test pyramid for JSON-RPC roundtrip + malformed payload rejection.
>
> **Version 1.1 changelog (2026-05-23):** Absorbed 2 MUST FIX + 3 SHOULD TEST + 2 DOCUMENT items from `.claude/knowledge-base/reviews/v0-3-agent-tools-mcp-edge-cases-2026-05-23.md`. Added ADR D6 declaring infra prerequisites (`discover-web-allowlist.txt` + `snapshots/` dir per cycle-discover.md v1.1 § Downstream changes #4 + #11 — NOT YET shipped at cycle level, so v0-3 itself ships them as prerequisites). Updated halt-loop checkpoints for Q2/Q3/Q5/Q7 with explicit pre-flight assertions (EC-3 URL lock, EC-4 empty-init skip, EC-5 broadened mem0 grep). Updated ADR D4 with SHA-stamping of `../theokit-sdk/` HEAD (EC-7). Q3 borderline corner classification documented inline (EC-6).

**Slug:** `v0-3-agent-tools-mcp`
**Owner:** TheMemory v0.3 cycle-discover
**Created:** 2026-05-23
**Time budget:** 7h (per-project breakdown in ADR D1)

## Context

Roadmap Item 4 (CLAUDE.md § Macro roadmap, currently Planned). v0.2 PR-A shipped 2026-05-23 (PR #11) — `@usetheo/memory/theokit` subpath ergonomics gap closed; binding auto-scopes from `ctx.session.userId`. Now the next subpath `@usetheo/memory/agent-tools` exposes the same verbs as **function-callable MCP tools** so `@usetheo/sdk` agents can invoke memory ops via JSON-RPC.

**The MemGPT/Letta lesson (per CLAUDE.md § Roadmap Item 4 verbatim):** "Function-calling-driven memory ops (lesson from MemGPT/Letta) **without inheriting the agent-loop lock-in**". Letta ties the function-calling pattern to its own SyncServer agent runtime; TheMemory v0.3 must port the pattern (tool schema declaration + side-effect isolation + JSON-RPC transport) WITHOUT requiring consumers to adopt the Letta-shaped agent loop.

**Acceptance criteria from CLAUDE.md Roadmap Item 4 (verbatim):**
> MCP server boots; `tools/list` returns exactly 4 tools with stable names. End-to-end via `@usetheo/sdk` agent: each verb invoked successfully with valid payload; schema validation rejects malformed payloads with structured error. JSON-RPC trace test confirms no cross-tool state leakage.

**Compliance scope:** plan honors `architecture.md` (DIP — `src/agent-tools/` will depend on `src/core/` ONLY, per § 3 boundary already declared), `testing.md` (TDD pyramid — JSON-RPC roundtrip lives at integration tier), `dogfood-golden-rule.md` (no production-ready claims), `discover-blueprint-golden-rule.md` (cite blueprint as source).

## Objective

Produce a blueprint that lets `/to-plan v0-3-agent-tools-mcp` lock: transport choice, tool schema declaration pattern, cross-tool state isolation strategy, `@usetheo/sdk` integration surface, and test pyramid. The blueprint MUST surface enough technical depth that a TDD-disciplined implementation can land WITHOUT a second round of investigation.

Success criteria for the blueprint:

- [ ] All 8 research questions answered with citations to `referencia/` OR `../theokit-sdk/` OR a snapshot of the MCP spec
- [ ] Cross-cutting comparison table populated for Letta vs Mem0 vs LangMem (per-project MCP/tool-exposure shape)
- [ ] Recommendations section provides at least one concrete decision proposal per research question (e.g., "ADOPT @modelcontextprotocol/sdk stdio transport" / "REJECT Letta's tool sandbox pattern because…")
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `referencia/letta/` | `letta/functions/mcp_client/` + `letta/services/mcp/` (10 transport-specific files: stdio_client.py, sse_client.py, streamable_http_client.py, fastmcp_client.py, base_client.py, oauth_utils.py, server_side_oauth.py, types.py, __init__.py) + `letta/functions/function_sets/` + `letta/services/tool_executor/` + `letta/services/tool_sandbox/` + `tests/mcp_tests/` (5 files: test_mcp.py, test_mcp_schema_validation.py, test_schema_validator.py, weather/weather.py, __init__.py) | Primary precedent — full MCP client implementation across all 3 standard transports, schema validation patterns, tool exposure mechanisms, AND test discipline |
| `referencia/mem0/` | `mem0-plugin/skills/mem0-mcp/SKILL.md` (1 file only — MCP plugin SHELL doc) | Secondary — minimal precedent. Mem0 has NO Python MCP server code in this clone; only a plugin pointer. Confirms positioning gap (MCP exposure is not Mem0's strength) |
| `referencia/langmem/` | `src/langmem/knowledge/tools.py` (530 LoC — tool exposure for LangGraph BaseStore) | Tertiary — NOT MCP-shaped per se, but documents how to expose memory ops as function-callable tools to an agent framework. Useful contrast for "MCP vs framework-native tools" decision |
| `../theokit-sdk/packages/sdk/` + `packages/memory-*` adapters | TS source under `src/` (consumer-side: what does `@usetheo/sdk` expect from a memory tool-provider?) | Required for prior_art Q8 — determines the contract `@usetheo/memory/agent-tools` MUST satisfy to plug into existing SDK consumers |
| MCP spec (online) | <https://spec.modelcontextprotocol.io> (latest spec via WebFetch) | Required for prior_art Q7 — official transport options, tool naming requirements, schema validation contract. Snapshot per cycle-discover.md v1.1 |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `referencia/letta/letta/agent.py` + agent-loop modules | Agent-loop lock-in is EXPLICITLY what we're avoiding per CLAUDE.md Roadmap Item 4. We borrow Letta's TOOL exposure pattern, NOT its agent runtime. |
| `referencia/letta/letta/server/rest_api/` | HTTP API for agent operations — orthogonal to MCP. v0.2 cycle-discover Q2 already mapped Letta's HTTP server shape. |
| `referencia/mem0/server/` + `mem0-ts/` | HTTP server + TS SDK — irrelevant to MCP exposure. v0.2 cycle-discover Q1 covered them. |
| `referencia/langmem/src/langmem/{graphs,knowledge/extraction.py,knowledge/graph_rag.py,prompts,reflection.py,short_term}` | Reflection / knowledge-graph specific (v0.4 deferral); not MCP-shaped |
| `referencia/*/build/`, `dist/`, `.venv/`, `node_modules/` | Build artifacts |
| `referencia/langmem/.git/` | Read-only zone per `.claude/hooks/boundary-check.sh` |
| Cross-project agent runtimes (Letta agent loop, LangGraph runtime) | We expose tools; we don't own the runtime that calls them |

## ADRs

### D1 — Time budget + stop conditions

**Decision:**
- `referencia/letta/`: 3h (primary — 10 client files + 5 test files + tool executor/sandbox)
- `referencia/mem0/`: 1h (secondary — likely thin; 1 SKILL.md file)
- `referencia/langmem/`: 1h (tertiary — tools.py only, 530 LoC)
- MCP spec WebFetch + snapshot: 1h (prior_art)
- `../theokit-sdk/`: 1h (prior_art for consumer contract)
- **Total: 7h**

**Rationale:** Letta has the FULL MCP implementation (3 transports + OAuth + schema validation + tests) so it carries the most question budget. Mem0 has only a SKILL.md pointer — its time budget is for honest "what's NOT here" documentation (positioning insight: Mem0 didn't bet on MCP exposure). LangMem informs the "MCP vs framework-native tools" decision via contrast.

**Alternatives considered:**
- Equal 2h split per project — REJECTED (wastes budget on Mem0's missing-MCP surface)
- Single-project deep-dive on Letta only — REJECTED (loses the prior_art delta + sibling SDK contract)
- 10h budget with deeper Letta dive — REJECTED (Letta's agent-loop is out-of-scope per CLAUDE.md; deeper dive would risk scope creep into agent runtime territory)

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (e.g., grep pattern → ast-grep kind → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots from another question.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions still pending, mark all remaining questions for that project as BLOCKED with reason "budget exhausted" and continue. Letta is the only project where this is likely to fire (3h is tight for 4 questions covering MCP + function sets + tool sandbox).

**Consequences:**
- Letta receives 4 of 8 questions (50% of budget on 50% of question count — proportional)
- Mem0 receives 1 question; expected outcome is honest "minimal precedent" doc
- LangMem receives 1 question informational
- prior_art receives 2 questions (MCP spec + SDK contract) — non-`referencia/` corner per v1.1 5-corner contract

### D2 — Investigation depth: client OR server OR both?

**Decision:** Both. Letta has MCP **client** implementations (consuming external MCP servers). Our v0.3 goal is to ship an MCP **server** (exposing memory verbs). The transports + schema patterns are SYMMETRIC (both client and server use them); inspecting Letta's client code teaches us what tool-provider authors must produce on the server side.

**Rationale:** MCP is a bidirectional protocol — client/server symmetry on transport + schema. Letta's stdio_client.py reading patterns directly inform what our stdio_server would write. Their `test_mcp_schema_validation.py` covers BOTH directions.

**Alternatives considered:**
- Only investigate server-side patterns elsewhere — REJECTED (no other ref project has MCP server code; would force us to invent the contract)
- Use official @modelcontextprotocol/sdk source as the only reference — DEFERRED to Q2 (we investigate its API surface, but Letta's higher-level usage patterns are richer)

**Consequences:**
- Q4 (Letta technique) covers transport + schema bidirectionally
- The blueprint will explicitly mark "Letta's CLIENT pattern X ↔ our SERVER pattern Y" mapping

### D3 — prior_art corner activated per cycle-discover.md v1.1

**Decision:** Adopt the v1.1 5-corner coverage matrix (tests/deps/tools/techniques/**prior_art**) per `cycle-discover.md` v1.1. Q7 (MCP spec) + Q8 (`@usetheo/sdk` tool-provider contract) live in the prior_art corner.

**Rationale:** v0.3 is the first cycle-discover invocation since cycle-discover.md was bumped to v1.1 (which added the prior_art corner as the 5th). MCP is a SPECIFICATION — investigating only `referencia/` would miss the canonical contract. `@usetheo/sdk` is a sibling project (NOT in `referencia/`) — investigating only `referencia/` would miss the integration consumer.

**Alternatives considered:**
- Defer prior_art to v0.4 — REJECTED (MCP spec is load-bearing for ANY tool schema decision; deferring would force "we'll figure it out later" anti-pattern)
- Treat MCP spec as a "tools" corner question — REJECTED (tools corner is for build/test/lint tooling per template; spec is a CONTRACT)

**Consequences:**
- `/discover-execute` will need WebFetch for Q7 + snapshot under `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/{sha256}.md` per cycle-discover v1.1 contract
- `/discover-confidence` v1.1 (when shipped — currently lagging per cycle-discover.md § Downstream changes) will check the snapshot hash + allowlist domain
- **Honest deviation surfaced:** the discover-plan SKILL.md itself still says "four-corner" (per cycle-discover.md § Downstream changes required #5: "discover-plan SKILL.md + template — declare prior_art questions in plan; require source field" — NOT YET SHIPPED). This plan honors the v1.1 CONTRACT (5 corners) per the locked policy: "This file is the contract; the 11 downstream items are the implementation. The contract is normative even if any single downstream file lags." Logged followup F-discover-plan-skill-update at end of plan.

### D4 — `../theokit-sdk/` path held to same `Path.exists()` standard as `referencia/`

**Decision:** Every `../theokit-sdk/{...}` citation in this plan + the blueprint MUST pass `Path.exists()`. Same fabrication-prevention discipline as `referencia/` paths per `discover-blueprint-golden-rule.md`.

**Rationale:** discover-confidence's `check_reference_citations.py` (per cycle-discover v1.1 § Downstream wiring) will eventually check both. Until then, honesty (Inquebrável Rule 3) requires the same hygiene manually.

**Alternatives considered:** rely on grep-only validation — REJECTED (paths can become stale between discover-plan write and discover-execute consumption).

**Consequences:** plan's Fase A column for Q8 explicitly lists `../theokit-sdk/packages/sdk/src/` paths to validate before /discover-execute runs.

**v1.1 EC-7 absorption — SHA stamping:** `../theokit-sdk/` is a sibling working-tree (NOT a `--depth 1` clone like `referencia/`). To prevent silent invalidation between /discover-execute write and /discover-confidence read, the blueprint produced by /discover-execute MUST include the SHA of `../theokit-sdk/`'s HEAD at investigation time (`git -C ../theokit-sdk rev-parse HEAD`) as an audit-trail signal in the blueprint header. If the SHA differs between Q8's Fase B reads and the blueprint write, the investigator marks Q8 BLOCKED with reason "sibling-repo state shifted mid-investigation".

### D5 — Skip Mem0 deep-dive; document the absence as positioning insight

**Decision:** Mem0 receives only 1 question (Q5 — "what's the shape of Mem0's MCP plugin?"). If Fase A confirms only `SKILL.md` exists (no Python code), Q5's answer is "Mem0 ships MCP exposure as a PLUGIN POINTER — outsources to an external MCP server (likely community-built); no first-party MCP server in the Python codebase". This IS the answer, not a Fase A failure.

**Rationale:** Negative-space finding has positioning value: confirms TheMemory v0.3's first-party MCP server is a competitive differentiator vs Mem0's plugin-only approach.

**Alternatives considered:** allocate more Mem0 time looking for hidden MCP code — REJECTED (1 file in `referencia/mem0/` is conclusive; deeper search would be padding).

**Consequences:** blueprint's cross-cutting comparison will document "Mem0: NO first-party MCP server (plugin-only)" as a feature, not a gap.

**Refined per v1.1 EC-5 absorption:** the `find -path '*mcp*'` pattern may miss Python files implementing MCP under a non-MCP-named file (e.g., `tools_server.py`). Halt-loop checkpoint Q5 (below) now runs a SECOND pass: `grep -rln 'tools/list\|tools/call\|@modelcontextprotocol\|JSONRPCRequest' referencia/mem0 --include="*.py"`. Zero hits from BOTH passes locks the negative-space conclusion harder.

### D6 — Infra prerequisites for prior_art corner (absorbs EC-1 + EC-2)

**Decision:** Before `/discover-execute v0-3-agent-tools-mcp` can run Q2 (npm WebFetch) or Q7 (MCP spec WebFetch), TWO infra prerequisites MUST be in place:

1. **`.claude/rules/discover-web-allowlist.txt`** exists with at minimum these 4 entries (one per line, inline rationale per the cycle-discover.md v1.1 convention):
   - `npmjs.com  # added for v0-3-agent-tools-mcp Q2 (deps audit of @modelcontextprotocol/sdk)`
   - `anthropic.com  # added for v0-3-agent-tools-mcp Q7 (MCP spec landing page)`
   - `spec.modelcontextprotocol.io  # added for v0-3-agent-tools-mcp Q7 (canonical MCP spec)`
   - `modelcontextprotocol.io  # added for v0-3-agent-tools-mcp Q7 (fallback if spec subdomain redirects)`
2. **`.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/`** dir exists (created via `mkdir -p` as halt-loop pre-flight step).

**Rationale:** Cycle-discover.md v1.1 declared the 5-corner contract with `prior_art` BUT § Downstream changes required #4 (allowlist NEW FILE seed) + #11 (snapshots dir gitignore confirmation) are NOT YET SHIPPED at the cycle infra level. v0-3 is the FIRST cycle-discover invocation to exercise prior_art — it ships these prerequisites itself rather than blocking on a separate infra PR.

**Alternatives considered:**
- (A) Block v0-3 cycle until a separate `chore(cycle-discover): seed allowlist + snapshots infra` PR ships — REJECTED (creates serial bottleneck; allowlist with 4 entries is trivially small; safer to bundle within the invocation that uses it)
- (B) Lazy-create on first WebFetch failure with retry — REJECTED (silently hides the configuration gap; violates Inquebrável Rule 3 explicit-honesty)
- (C) Selected: explicit pre-flight ADR + halt-loop driver `mkdir -p` step + manual allowlist seeding before /discover-execute

**Consequences:**
- The 4 allowlist entries become canonical — future v0.4+ discoveries reuse them (and `discover-web-allowlist.txt` accumulates entries over time per cycle-discover.md v1.1 § Cross-references)
- `.claude/knowledge-base/discoveries/snapshots/` MUST be confirmed committed to git (NOT gitignored — per cycle-discover.md v1.1 § Downstream change #11 expectation)
- The halt-loop driver for v0-3 needs an iteration-0 / pre-flight step verifying both prerequisites exist before iterating questions
- Followup F-cycle-discover-infra-shipped (logged at plan tail) — when cycle-discover.md v1.1 § Downstream changes finally ship as a dedicated PR, retire this ADR's prerequisite block (file already exists; mkdir is idempotent)

## Research questions

8 questions across 5 corners (1+1+1+3+2). Sweet spot per cycle-discover.md v1.1 budget (5-10 total, max 3 per corner, min 1 per corner).

| # | Corner | Project | Question | Fase A method (broad map) | Fase B method (deep read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | tests | letta | How does Letta test (a) MCP server boots + `tools/list` shape, (b) malformed payload rejection with structured error, (c) cross-tool state isolation? Which fixtures (e.g., `weather/weather.py`) does the suite use? | `Read referencia/letta/tests/mcp_tests/test_mcp.py` + `Read referencia/letta/tests/mcp_tests/test_mcp_schema_validation.py` + `Read referencia/letta/tests/mcp_tests/test_schema_validator.py` (3 files; combined ~?LoC) | For each test pattern found, document the assertion shape + fixture wiring + any pytest marks (`@pytest.mark.asyncio`, `skipif`, etc.) | Table: per-test (file:line) → what's asserted → fixture used → applicability to TheMemory's 4-tool surface |
| Q2 | deps | npm registry (prior_art via WebSearch) | What is the official `@modelcontextprotocol/sdk` Node SDK surface? Server vs client API shape? Stdio vs HTTP/SSE transports available? Dep tree size + license? Latest stable version? | WebSearch `@modelcontextprotocol/sdk npm` + WebFetch `npmjs.com/package/@modelcontextprotocol/sdk` → snapshot at `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/{sha256}.md` | Read snapshot + npmjs.com tarball metadata via WebFetch (deps + license + maintainer info) | Decision-table: server entry point, server lifecycle methods, transport options (with stability tier per spec), dep count, peer-dep requirements |
| Q3 | tools | letta + langmem | How is the tool-provider code SHIPPED? Letta's `letta/services/mcp/` exports + entry-point shape; LangMem's `src/langmem/knowledge/tools.py` as a Python module — what's the build/test/distribute toolchain expectation for each? **v1.1 EC-6 corner note:** Q3's angle is *distribution / packaging signal* (tools), NOT *algorithm* (techniques) — Q4 covers algorithm separately. /discover-confidence may flag as borderline; blueprint ADR note will justify. | `Read referencia/letta/letta/services/mcp/base_client.py` (153 LoC — primary; `__init__.py` is EMPTY (0 LoC) per v1.1 EC-4 pre-check, SKIP) + `Read referencia/langmem/src/langmem/knowledge/tools.py` (lines 1-80 for module-level structure) | Inspect packaging signals (`pyproject.toml` install hints if present in same dir; export surface; test discovery patterns) | Comparison table: Letta MCP surface entry-point vs LangMem tool entry-point — what's exposed, what's internal. Informs TheMemory's `src/agent-tools/index.ts` shape |
| Q4 | techniques | letta | How does Letta expose memory ops as function-callable tools via MCP? Tool schema declaration pattern (decorator? config? code-gen?). Side-effect isolation per tool call (sandbox via `tool_sandbox/`)? Transport choice — stdio vs SSE vs streamable-HTTP — when used? | `Read referencia/letta/letta/services/mcp/stdio_client.py` + `Read referencia/letta/letta/services/mcp/sse_client.py` + `Read referencia/letta/letta/services/mcp/streamable_http_client.py` + `Read referencia/letta/letta/services/mcp/fastmcp_client.py` (4 transport files) + `Read referencia/letta/letta/functions/mcp_client/types.py` (type contract) | Section-by-section, document: (i) tool schema field set (name/description/inputSchema/outputSchema?), (ii) per-transport setup boilerplate, (iii) error propagation pattern (Python exception → MCP error response), (iv) any state-isolation idioms (per-call context, per-session memory). Map each finding to a "TheMemory server-side equivalent" candidate. | Per-transport decision-table + tool-schema field-set reference + recommended transport for v0.3 (with rejected alternatives) |
| Q5 | techniques | mem0 | Does Mem0 ship first-party MCP server code? What's `referencia/mem0/mem0-plugin/skills/mem0-mcp/SKILL.md`'s shape — does it point to external code or document a plugin contract? Positioning implication: is MCP exposure Mem0's strength or gap? | `Read referencia/mem0/mem0-plugin/skills/mem0-mcp/SKILL.md` + `find referencia/mem0 -name "*.py" -path "*mcp*"` (verify no hidden Python) | Synthesize whether Mem0 ships first-party MCP server: yes/no + evidence. If no, document the absence as a positioning data point. | Boolean (yes/no with citation) + competitive insight paragraph for blueprint cross-cutting comparison |
| Q6 | techniques | langmem | How does LangMem expose memory ops as TOOLS (not MCP — LangGraph-native `BaseStore` tool pattern)? Operation-per-tool granularity (one tool per verb? batched?). Schema declaration mechanism. Contrast with Letta's MCP approach: same problem, different abstraction. | `Read referencia/langmem/src/langmem/knowledge/tools.py` (530 LoC — full file) | Identify the tool declaration entry points, schema validation approach, error shape. Tabulate against Letta's MCP-shaped equivalent. | Comparison table: LangMem framework-native tool pattern vs Letta MCP pattern — trade-offs (portability/coupling/discoverability). Recommendation: ADOPT MCP per CLAUDE.md Item 4 rationale (framework-agnostic exposure) with justification |
| Q7 | prior_art | MCP spec (WebFetch + snapshot) | What does the **official MCP specification** mandate for tool exposure? Stable tool naming requirements? Schema validation contract (JSON Schema flavor)? Transport options + their stability tier? Server lifecycle (initialize / list / call / shutdown)? | WebSearch `Model Context Protocol specification` (allowlist domain: anthropic.com, modelcontextprotocol.io) + WebFetch top result → snapshot at `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/{sha256}.md` | Read snapshot section-by-section. Extract: protocol version, tool message shapes (tools/list, tools/call), error code taxonomy, transport spec links | Spec-summary cheat-sheet for blueprint's "What MCP mandates vs what consumers can choose" decision matrix |
| Q8 | prior_art | `@usetheo/sdk` (sibling project) | What does `@usetheo/sdk` expose for tool-provider integration? Where would a v0.3 `@usetheo/memory/agent-tools` plug in? What's the contract — peer-dep on `@modelcontextprotocol/sdk`? OR sdk-native tool-provider interface? Are there sibling `packages/memory-*` adapters that already speak MCP? | `Read ../theokit-sdk/packages/sdk/package.json` + `Read ../theokit-sdk/packages/sdk/src/index.ts` (or barrel equivalent) + `find ../theokit-sdk/packages -maxdepth 2 -type d -name "*mcp*"` + `Read ../theokit-sdk/packages/memory-mem0/src/adapter.ts` (existing memory adapter shape as reference) | Identify: (i) does sdk import `@modelcontextprotocol/sdk` already? (ii) does any sibling package register tools at runtime? (iii) what's the MemoryAdapter contract — does `@usetheo/memory/agent-tools` extend it OR live alongside? | Integration-contract spec: where `@usetheo/memory/agent-tools` plugs in + which interfaces it must satisfy + which existing sibling packages it should NOT duplicate |

### Per-question source field (per cycle-discover.md v1.1 prior_art corner introduction)

| # | Source kind | Source identifier |
|---|---|---|
| Q1 | `referencia/letta` | local |
| Q2 | web (npm registry) | `npmjs.com/package/@modelcontextprotocol/sdk` (snapshot required) |
| Q3 | `referencia/letta` + `referencia/langmem` | local |
| Q4 | `referencia/letta` | local |
| Q5 | `referencia/mem0` | local |
| Q6 | `referencia/langmem` | local |
| Q7 | web (MCP spec) | `spec.modelcontextprotocol.io` OR `anthropic.com/news/model-context-protocol` (snapshot required) |
| Q8 | `../theokit-sdk/` (sibling repo) | local (D4 holds same fabrication-prevention standard as referencia/) |

## Coverage Matrix

| Q | Corner | Project / Source | Method | Status |
|---|---|---|---|---|
| Q1 | tests | letta | Read 3 test files in `referencia/letta/tests/mcp_tests/` | mapped |
| Q2 | deps | npm registry | WebSearch + WebFetch + snapshot of `@modelcontextprotocol/sdk` npmjs page | mapped |
| Q3 | tools | letta + langmem | Read MCP `__init__.py` + `base_client.py` + langmem `tools.py:1-80` | mapped |
| Q4 | techniques | letta | Read 4 transport client files + `mcp_client/types.py` | mapped |
| Q5 | techniques | mem0 | Read `mem0-plugin/skills/mem0-mcp/SKILL.md` + find verification | mapped |
| Q6 | techniques | langmem | Read full `src/langmem/knowledge/tools.py` (530 LoC) | mapped |
| Q7 | prior_art | MCP spec | WebFetch spec.modelcontextprotocol.io + snapshot | mapped |
| Q8 | prior_art | `../theokit-sdk/` | Read sdk package.json + barrel + memory-mem0 adapter + find for mcp | mapped |

**Coverage: 8/8 questions mapped (100%).** All 5 corners populated (tests=1 / deps=1 / tools=1 / techniques=3 / prior_art=2). Within per-corner cap (max 3). v1.1 EC absorptions mapped to halt-loop checkpoints (pre-flight + per-Q3/Q5/Q7 inline), not to new questions — scope discipline held.

## Halt-loop checkpoints

For `/discover-execute v0-3-agent-tools-mcp`, intermediate state that MUST hold before marking a question DONE:

- **Pre-flight (iteration 0) — v1.1 EC-1 + EC-2 absorption (MUST FIX → blocking):**
  - [ ] `.claude/rules/discover-web-allowlist.txt` exists AND contains `npmjs.com` + `anthropic.com` + `spec.modelcontextprotocol.io` + `modelcontextprotocol.io` (per ADR D6)
  - [ ] `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/` dir exists (created via `mkdir -p` if absent)
  - [ ] `git -C ../theokit-sdk rev-parse HEAD` recorded in progress JSON as `sibling_sdk_head_sha` (per ADR D4 v1.1 SHA-stamping)
  - If ANY check fails: HALT with reason "infra prerequisite missing per ADR D6"; do NOT proceed to question iteration

- **Q1:** at least 1 test pattern transcribed verbatim into blueprint § Coverage Corner 1 with citation `referencia/letta/tests/mcp_tests/<file>:<line>`. Fixture file (`weather/weather.py` or other) cited if referenced.

- **Q2:** snapshot file exists at `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/{sha256}.md`. Hash verified. Snapshot content includes: dep count, peer-dep list, license, latest version, server-API entry-point name. URL must match an allowlist entry (per ADR D6 prerequisite).

- **Q3:** comparison table populated in blueprint § Coverage Corner 3 with one row per project (letta + langmem) + 3 dimensions (entry-point / export surface / packaging signal). **v1.1 EC-4 checkpoint:** Q3 SKIPS reading `referencia/letta/letta/services/mcp/__init__.py` (empty file, 0 LoC); Q3's Letta column draws solely from `base_client.py`.

- **Q4:** per-transport row populated in blueprint § Coverage Corner 4 with citations to all 4 transport files. Decision-table column declares 1 recommended transport for v0.3 (stdio is the likely answer per MCP spec).

- **Q5:** blueprint cross-cutting comparison includes "Mem0 first-party MCP server: yes/no" row. Honesty discipline — if `find` returns zero Python files, that's the answer, NOT a Fase A failure. **v1.1 EC-5 checkpoint:** Q5's find pass MUST be paired with a secondary grep pass: `grep -rln 'tools/list\|tools/call\|@modelcontextprotocol\|JSONRPCRequest' referencia/mem0 --include="*.py"`. The negative-space conclusion ("Mem0 has no first-party MCP server") requires BOTH passes to return zero hits.

- **Q6:** blueprint § Coverage Corner 4 includes LangMem-vs-Letta tool-pattern delta table.

- **Q7:** snapshot of MCP spec landing page exists with verified hash. Cheat-sheet appears in blueprint § prior_art subsection. **v1.1 EC-3 checkpoint:** Q7 MUST lock a single canonical URL BEFORE writing the snapshot. Decision rule: if WebSearch returns both `spec.modelcontextprotocol.io` and `anthropic.com/news/model-context-protocol` (and/or others), pick the FIRST result whose HTML `<title>` contains the literal `Model Context Protocol Specification`. Log the locked URL in progress JSON's `Q7.locked_url` field BEFORE writing the snapshot. Snapshot filename hash is computed over `{locked_url}\n---\n{fetched-content}` per cycle-discover.md v1.1 contract.

- **Q8:** blueprint declares whether `@usetheo/memory/agent-tools` should (a) peer-dep `@modelcontextprotocol/sdk` (b) implement `@usetheo/sdk` MemoryAdapter interface (c) both (d) neither. ADOPT/REJECT/DEFER verdict per cycle-discover.md v1.1 § Rule 9 verdict requirement. Citations to `../theokit-sdk/{path}` MUST be reachable AT THE SHA recorded in pre-flight (per ADR D4 v1.1 SHA-stamping).

## Acceptance Criteria

- [ ] All 8 research questions have status `done` OR `blocked` (with reason) in `.progress-v0-3-agent-tools-mcp.json` after halt-loop
- [ ] Every `referencia/{project}/{path}` cited in blueprint exists via `Path.exists()` (no fabricated paths)
- [ ] Every `../theokit-sdk/{path}` cited in blueprint exists (D4 holds same standard)
- [ ] Every URL cited has a corresponding `snapshots/v0-3-agent-tools-mcp/{sha256}.md` file
- [ ] All 5 coverage corners (tests/deps/tools/techniques/prior_art) populated with non-placeholder content
- [ ] Blueprint § ADRs has ≥ 1 ADR (likely 4-6: transport, schema, isolation, sdk-integration, test-pyramid)
- [ ] Blueprint § Recommendations provides 1+ concrete proposal per question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] All Acceptance Criteria above satisfied
- [ ] `/discover-confidence` invoked + verdict ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`
- [ ] No hard caps triggered (no fabricated citations, all 5 corners populated)
- [ ] If verdict = SHIPPABLE_WITH_CAVEATS: caveats listed honestly in the blueprint's Halt-loop progress section
- [ ] If verdict < SHIPPABLE_WITH_CAVEATS: re-run `/discover-improve v0-3-agent-tools-mcp` per cycle-discover chain

## Followups logged (not part of this plan, but surfaced for honesty)

| # | Item | Why deferred |
|---|---|---|
| F-discover-plan-skill-update | Update `.claude/skills/discover-plan/SKILL.md` from "four-corner" to "five-corner" per cycle-discover.md v1.1 § Downstream changes required #5. Update template to require per-question `Source` field. | This v0-3 plan honors the v1.1 CONTRACT (5 corners) ahead of the SKILL.md catching up (per cycle-discover.md "the contract is normative even if any single downstream file lags"). The SKILL.md update should ship as a separate `chore(skills): bump discover-plan to v1.1 5-corner contract` PR after v0-3 cycle-discover completes (proves the 5-corner shape works end-to-end first). |
| F-discover-confidence-prior-art-checker | Extend `check_research_coverage.py` to recognize the 5th `prior_art` corner. Extend `check_reference_citations.py` to validate URL allowlist + snapshot hash per cycle-discover.md v1.1 hard gates. | Currently only 4 corners checked. Until shipped, `/discover-confidence` on this blueprint will report `prior_art` corner as "not detected" — manual review will substitute. Logged as cycle-discover.md v1.1 § Downstream changes required #7. |
| F-cycle-discover-infra-shipped | When `chore(cycle-discover): seed allowlist + snapshots infra` PR finally lands, retire ADR D6's prerequisite block (allowlist file already exists; `mkdir -p` is idempotent). v0.4+ discoveries inherit the seeded allowlist + dir for free. | v0-3 ships the prerequisites itself per D6 because v0-3 is the FIRST cycle-discover invocation post-v1.1 bump. Future invocations accumulate on top. Logged as cycle-discover.md v1.1 § Downstream changes required #4 + #11. |

## v1.1 edge-case absorption summary

Status of edges from `.claude/knowledge-base/reviews/v0-3-agent-tools-mcp-edge-cases-2026-05-23.md`:

| # | Severity | Absorption |
|---|---|---|
| EC-1 (allowlist missing) | MUST FIX | ✓ Absorbed via ADR D6 (prerequisite block + pre-flight checkpoint) |
| EC-2 (snapshots dir missing) | MUST FIX | ✓ Absorbed via ADR D6 (same prerequisite block; halt-loop driver runs `mkdir -p` pre-flight) |
| EC-3 (Q7 URL not locked) | SHOULD TEST | ✓ Absorbed via Q7 halt-loop checkpoint (HTML `<title>` rule + `progress.Q7.locked_url` log) |
| EC-4 (Q3 empty `__init__.py`) | SHOULD TEST | ✓ Absorbed via Q3 Fase B update (SKIP the empty file; rely on `base_client.py`) + Q3 halt-loop checkpoint |
| EC-5 (D5 find pattern too narrow for Mem0) | SHOULD TEST | ✓ Absorbed via D5 refinement + Q5 halt-loop checkpoint (paired grep pass on JSON-RPC literal markers) |
| EC-6 (Q3 borderline corner) | DOCUMENT | ✓ Inline note in Q3 row (tools vs techniques angle justification) |
| EC-7 (sibling SDK SHA pin) | DOCUMENT | ✓ Absorbed via ADR D4 refinement (SHA stamping at investigation time + Q8 halt-loop checkpoint) |

## Related

- Cycle rule: `.claude/rules/cycle-discover.md` (v1.1 — adds 5th `prior_art` corner)
- Golden rule: `.claude/rules/discover-blueprint-golden-rule.md`
- Companion v0.2 cycle-discover output: `.claude/knowledge-base/discoveries/blueprints/v0-2-theokit-binding-blueprint.md` (8/8 questions, 5 ADRs, SHIPPABLE_WITH_CAVEATS 89/100)
- Companion v0.2 plan: `.claude/knowledge-base/plans/completed/v0-2-theokit-binding-plan.md` (1347 LoC; demonstrates the chain quality bar v0-3 should match)
- Roadmap entry: CLAUDE.md § Macro roadmap Item 4
- Architecture rule consumed: `.claude/rules/architecture.md § 3` (DIP — `src/agent-tools/` SHALL import from `src/core/` ONLY; boundary-check.sh will need to add the guard when `src/agent-tools/` lands)
- Testing rule consumed: `.claude/rules/testing.md § Pyramid` (JSON-RPC roundtrip lives at integration tier; unit tests cover schema validation logic in pure form)
