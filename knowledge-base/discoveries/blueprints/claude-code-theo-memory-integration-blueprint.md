---
slug: claude-code-theo-memory-integration
kind: blueprint
date: 2026-07-20
status: SHIPPABLE_WITH_CAVEATS
sources: 3 parallel research frames (Claude Code mechanics · theo-cloud gateway auth + import surface · OSS/community patterns) — all cited inline
---

# Blueprint — Global Claude Code ⇄ theo-memory integration + migration

**Goal it grounds:** make Claude Code (all instances, globally) use theo-memory (hosted) as its
persistent memory, with reliable auto-capture/auto-recall, PLUS a one-shot migration of Claude
Code's native file-memory → theo-memory. Placement (owner decision): **M6 in theo-memory
(server-side) + a global Claude Code kit** under `~/.claude`.

## The core finding (SOTA consensus, verified by 2 independent frames)

**Hooks beat MCP tools for reliable auto-memory. MCP tools are model-invoked → the model forgets
to call `remember`/`recall`. Hooks are deterministic → they fire regardless of the model.** Every
system that achieves reliable auto-memory (claude-mem, the reference project, REDACTED's plugin) uses Claude Code
**hooks**; the pure-MCP systems (OpenMemory, REDACTED, REDACTED) are all model-invoked and unreliable for
capture. Sources: `code.claude.com/docs/en/hooks`, `docs.claude-mem.ai/hooks-architecture`,
`REDACTED.ai/blog/claude-code-memory` (admits its plugin only "injects a decision rubric… lets the
agent decide"), `latenode.com/blog/memory-mcp-server-explained` ("models don't reliably invoke the
memory-saving tools"), `dev.to/gonewx` (the Stop-hook-blocks-exit forcing pattern).

**→ Architecture decision: hybrid, hooks-first.** Hooks are the deterministic spine; the remote MCP
server is an opportunistic/explicit complement. Both send RAW text; theo-memory's **server-side LLM
extraction** distills the facts, so the hooks stay fast and dumb.

## Coverage Corner 1 — Integration architecture (the hooks + MCP wiring)

**Hooks (global `~/.claude/settings.json` — already has 3 hooks → MERGE, never clobber):**

| Hook | Matcher | Role | Mechanism |
|---|---|---|---|
| `SessionStart` | `startup\|resume` | **auto-RECALL** | POST `/v1/recall` (project-scoped) → inject top-K via `hookSpecificOutput.additionalContext` (or plain stdout on SessionStart). Silent since CC 2.1.0. Keep `timeout` tight. |
| `UserPromptSubmit` | (none — always fires) | per-turn recall | read `prompt` from stdin → semantic recall → inject the few most relevant. Non-blocking; NEVER exit-2 (erases the prompt). |
| `Stop` | — | **auto-REMEMBER** | `async:true`; read `last_assistant_message`/transcript → POST `/v1/remember` (raw text; server extracts). Optionally exit-2 to force-write before exit (community pattern; not vendor-documented). |
| `PreCompact` | — | flush-before-forget | persist working memory before context is compacted away. |

Exact injection field: `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`
(exit 0). A native `http` hook type also exists (POST directly, `allowedEnvVars` for the token).
Source: `code.claude.com/docs/en/hooks`.

**Remote MCP (explicit surface, global `--scope user`):**
`claude mcp add --transport http --scope user theo-memory <EDGE>/mcp --header "Authorization: Bearer theo_live_…"`
→ exposes `remember`/`recall`/`forget`/`reflect`/`explain_recall` for deliberate use. Config lands
in `~/.claude.json`. Source: `code.claude.com/docs/en/mcp`.

**Namespacing (global-memory pitfall — context pollution + security boundary):** recall scoped by
PROJECT (from `cwd`) + optional `shared`/`personal` tiers, to stop project B's memories bleeding
into project A. Two options in theo-memory's tier model: (a) `metadata:{project}` + recall filter,
or (b) map project → a scope id. Isolation is ALSO the security boundary (workspace-scoped).
Sources: `dev.to/anajuliabit` (namespace strategies), `REDACTED.ai/blog/multi-agent-memory-systems`.

## Coverage Corner 2 — Dependencies

- **No new theo-memory runtime deps.** Server-side M6 = a new REST route (reuses Hono + zod + the
  core `remember` path — `infer:false` verbatim store already exists).
- **The global kit** (`~/.claude/hooks/*.sh` + the migration script): stdlib only — `curl` for the
  HTTP calls, `jq`/node for JSON, standard shell. Migration parser: node/python (frontmatter + YAML).
  No new dependency graph (parsimony: rungs 2-4).
- **Auth:** reuses the shipped `theo_live_*` API-key path (Stripe-shape, `ApiKeyAuthVerifier` +
  `theo_api_keys`) — no new auth mechanism.

## Coverage Corner 3 — Tools & auth (client → edge)

**Credential:** `Authorization: Bearer theo_live_<base64url(32)>` with scopes
`memory:read,memory:write,memory:delete`. Minted from the dashboard (`POST /v1/api-keys`,
session-JWT-gated, secret shown once). The Traefik `memory-edge` (`dynamic.yml:31-36`,
`PathPrefix(/v1/memory)`) validates via ForwardAuth (`/internal/authz/forward`), mints a per-tenant
downstream key (least-privilege), **strips the client key** (CWE-441, Del-then-set), and rewrites
`/v1/memory/(.*)` → theo-memory `/v1/$1`. Upstream, `requireScopeOnPrincipal` enforces per-verb
scope. `workspace_id == tenant_id`, resolved from the credential. Sources:
`theo-cloud/internal/routes/forward_auth.go:80-140`, `theo-cloud/theo-workspace/dev/traefik/dynamic.yml`,
`packages/api/src/server/auth/api-key-verifier.ts`.

**⚠️ OPEN QUESTION (blocks go-live, not the plan):** the PRODUCTION edge host/path was NOT
externally verifiable. `app-dev.usetheo.dev` is the dashboard SPA behind Caddy — `/v1/memory/*`
there returns the SPA / a Caddy 404, NOT the authenticated memory edge. The `theo_live_*` + Traefik
`/v1/memory/*` topology was confirmed only in LOCAL dev (`:8090`). The same-origin BFF
(`/v1/dashboard/memory/*`) wants a Kratos **session JWT** (browser login), unsuitable for a headless
client. **Resolve the prod edge host/path that accepts a `theo_live_*` key with the team before
wiring the hooks/MCP.**

## Coverage Corner 4 — Migration techniques (Claude Code memory → theo-memory)

**Source (the payload):** **487 `*/memory/*.md` files across 77 projects (~410 nodes)** under
`~/.claude/projects/<slug>/memory/`. Node schema: frontmatter `name`, `description`,
`metadata.type` **OR** flat `type` (parser MUST accept both), body with `**Why:**`/`**How to apply:**`,
**`[[wikilinks]]` in 250 files** (→ theo-memory `entity_edges` with provenance). `MEMORY.md` is a
derivable index — do not migrate. `type` distribution: project ~244, feedback ~99, reference ~46,
user ~7. CLAUDE.md files are INSTRUCTIONS, not memory rows — out of scope.

**ETL pipeline (per the OSS/SOTA consensus):**
1. **Parse** node (both frontmatter variants + wikilinks-as-edges).
2. **Scrub secrets/PII (MANDATORY, security-critical)** — memory files are a known secret-leak
   vector; pattern-scan + redact API keys / tokens / PII BEFORE persist. No memory leaves the
   machine un-scrubbed. Sources: OWASP AI Agent Security Cheat Sheet, `REDACTED.ai/blog/ai-memory-security-best-practices`.
3. **Map:** `description`→ memory text; `type` → tier/tag; `metadata.originSessionId` → provenance;
   wikilinks → entity edges; add `metadata:{source:'claude-code', project, file, node_type}`.
4. **Store raw (skip extraction):** `POST /v1/remember { infer:false, … }` — the facts are already
   atomic; LLM re-extraction is for messy conversation, not a curated corpus (`options.ts:14-20`
   documents `infer:false` as "Useful for migration / batch import").
5. **Idempotent by construction:** the composite UPSERT `(workspace_id, hash, user_id, session_id,
   agent_id)` bumps `confirmation_count` + returns `rejectedAsDuplicate=true` on re-run — re-imports
   never double-insert (`pgvector-store.ts:426-464`). (Caveat: dedup key is `hash(text)`;
   `metadata`/`category` frozen on first write.)
6. **Dry-run + review (owner requirement):** default = parse + scrub + emit a report (what would
   import, what was scrubbed, dedup preview) → human approves → commit. Git-diff of the report is
   the audit surface.

**The GAP → M6 server-side deliverable:** there is **NO batch endpoint** — only single-item
`POST /v1/remember`, and the **30-writes/60s** per-token rate limit makes one-request-per-fact
migration of thousands infeasible (hours / 429s). M6 must add `POST /v1/remember/batch` (array body,
`infer:false`-capable, batch-aware rate-limit), `memory:write`. All per-item semantics already exist
at the core layer; only the batched HTTP surface is missing. Source:
`packages/api/src/server/middleware/rate-limit.ts:106-125`, exhaustive grep (no batch verb).

## ADRs

- **ADR-1 — Hooks-first hybrid (not MCP-only).** Rejected: MCP-tool-only (model forgets to call).
  Rejected: hooks-only (loses the deliberate/manual surface). Chosen: hooks for the deterministic
  auto 90% + MCP for explicit exploration. Evidence: unanimous SOTA (frames 1+3).
- **ADR-2 — Migrate via `infer:false` raw-store, not re-extraction.** Rejected: re-run LLM
  extraction (cost + the facts are already atomic + non-deterministic). Chosen: verbatim store +
  server dedup. Evidence: `options.ts:14-20`, REDACTED v3 raw-import patterns.
- **ADR-3 — Batch endpoint is the enabling server-side piece.** Rejected: raise the rate limit +
  client-side throttle (fragile, slow, per-process limiter). Chosen: `POST /v1/remember/batch`.
- **ADR-4 — Auth via the shipped `theo_live_*` edge key, dashboard-minted.** Rejected: session-JWT
  BFF (needs browser login, not headless). Rejected: per-user OIDC (more setup — deferred).

## Drawbacks & Risks

1. **Prod edge host unconfirmed** (Corner 3) — HIGH. Mitigation: resolve with the team; the plan's
   go-live task is gated on it; local dev works today for validation.
2. **Secret leakage in migration** — HIGH. Mitigation: mandatory scrub stage + dry-run review; no
   un-scrubbed persist.
3. **Global context pollution** — MEDIUM. Mitigation: project namespacing on recall (Corner 1).
4. **Auto-remember noise / cost** (every Stop → a remember) — MEDIUM. Mitigation: server-side
   extraction + confirmation_count dedup; salience filter in the Stop hook; `async` fire-and-forget.

## Unresolved Questions

1. Production edge host/path for `/v1/memory/*` accepting `theo_live_*` (team).
2. Per-project namespacing mapping in theo-memory's user/session/agent tiers (metadata-filter vs a
   scope id) — a plan-time design decision.
3. Secret-scrub ruleset (which patterns) — security-critical; needs a concrete allow/deny list.

## M6 scope (two coordinated pieces)

- **Server-side (theo-memory repo, gates the milestone):** `POST /v1/remember/batch` (array,
  `infer:false`, provenance metadata, batch-aware rate-limit) + integration test + docs.
- **Global kit (`~/.claude`, companion — NOT theo-memory src):** `SessionStart`/`UserPromptSubmit`/
  `Stop`/`PreCompact` hooks + the remote MCP registration + the migration tool (parser + scrub +
  dry-run + batch-import) + auth setup docs.
