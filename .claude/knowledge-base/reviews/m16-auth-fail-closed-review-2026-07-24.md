# Review: M16 — identidade fail-closed (#121, #84, #102)

**Date:** 2026-07-24
**Reviewer:** 1 adversarial security agent (Staff-level), briefed to find the bypass, not bless the diff
**Findings:** 3 actionable (1 HIGH inert-guard, 1 HIGH live-primitive, 1 MEDIUM wrong-failure-direction) + 1 attack-tried-nonexistent
**Verdict:** READY_TO_MERGE (all actionable findings closed with tests that fail without the fix)

The review was run on a slice I believed complete. It was not — the agent broke two of the
milestone's own claims. This is the same lesson as M15's `/review`, from the other side: unit
tests green does not mean the control is wired, and a fix's stated premise can be false.

## Finding 1 — HIGH — the #84 fail-closed guard was inert in production

`withBearerAuth` had the OIDC fail-closed gate (`requireCredential === true` → 401), and the
unit tests passed — but only because they constructed `withBearerAuth(..., { requireCredential:
true })` by hand. No production caller set it: `resolveBearerAuth` in `run-mcp-server.ts` built
the options bag without ever reading `THEMEMORY_REQUIRE_CREDENTIAL`. Only the REST surface read
the env. So an operator running `themory mcp --auth oidc` with the env set got the old
default-workspace leak, guard notwithstanding.

**Closed** (`07e5c27`): `resolveBearerAuth` now reads the same env via the same
`parseRequireCredentialEnv` the REST surface uses, and a test proves the value reaches the
built options.

## Finding 2 — HIGH — "workspace-level credential" is not "trusted gateway"

My #121 fix keyed header-trust on `principal.userId == null`, with the rationale "a
workspace-level credential is the gateway topology". The agent showed this is false: an operator
can mint an unbound (workspace-level) key — a documented, normal mint — and use it directly
against `--auth api-keys`, the one topology the CLI itself offers. That key resolves `userId:
null`, so `attachUser` was skipped and `X-Theo-User-Id` won again. The bearer of any
workspace-level key could act as any user in the workspace — #121 reopened through a wider door.

**Closed** (`83df2a7`): header-trust now requires an explicit, auth-derived signal —
`markGatewayTrusted`, set only when the credential carries `memory:platform-admin`, the scope
that only the theo-cloud gateway credential holds. A workspace-level key used directly cannot
pick a user via a header; a scope-required call fails closed instead.

## Finding 3 — MEDIUM — wrong failure direction on a malformed principal

A key row with `user_id = ''` (a user-bound key with corrupt data, reachable by direct write or
a migration backfill) resolved to `userId: ''`, which the gate treated as "no user" → fell
through to header-trust. For a security control the safe direction on ambiguous data is reject,
not trust-the-client.

**Closed** (`83df2a7`): three explicit states — non-empty string → identity from credential;
`null` → workspace-level (header only under gateway); `''` → malformed → 401, mirroring the
existing blank-workspace EC-1 reject. An integration test with a real verifier and a corrupt
row asserts the 401.

## Finding 4 — none — api-key→OIDC interleaving

Attack tried: a `theo_live_`-shaped token that attaches a workspace and then falls through to
OIDC. It does not exist — every terminal state in the valid-shape api-key branch ends in
`return`; the only fall-through to OIDC is the shape-mismatch branch, which attaches nothing.
Correctly structured; recorded so the next reviewer need not re-derive it.

## #102 — closed as infra, not repo code

The `app-dev` 401 is a split-brain between the store that mints keys (k3d) and the store that
validates `/v1/memory/*` (compose, empty). The validating code (`lookupAPIKey`) lives in
`theo-cloud`, not this repo; `grep` for it in `packages/**` returns nothing, and `app-dev`
returns 401 even for an invented key. The fix is environment topology, out of theo-memory's
scope. Closed with the diagnosis; the sync work belongs in the infra repo.

## Quality gates

| Gate | Result |
|---|---|
| `/code-quality` (repo-wide) | PASS, score cap 100, zero hard caps |
| MCP contract suite | 187 passed |
| auth integration (real verifier + Postgres) | 4 passed — incl. #121 repro and Finding 3 |
| wiring triad | PASS on all 4 new symbols (attachUser, userFromRequest, markGatewayTrusted, isGatewayTrusted) |
| lint / typecheck | 0 errors, 0 warnings |

## Handoff

READY_TO_MERGE. The two headline claims that the review undercut are both now genuinely true:
#84's control is wired to a production caller, and #121's residual workspace-level surface is
closed behind an auth-derived gateway signal. Every fix has a test that fails without it.
