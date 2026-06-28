---
name: live-dogfood
description: Multi-modal live dogfooding harness that validates the REAL theo-cloud → theo-memory system across 100% of its surface — UX, API, MCP, and DX (CLI + SDK). Brings up (or refreshes) the live stack with a FRESH build, registers a real user, and drives a complete journey catalog through 5 drivers: browser (Chrome DevTools MCP — the human UX path), http (REST), mcp (a real MCP client over stdio/SSE/streamable-http), cli (themory subprocess), and sdk (import + round-trip). Covers journeys + edge cases + negative cases + cross-tenant isolation + the #77 scope-denial security checks. Writes dated dogfood evidence (a sibling scenario that feeds /dogfood — never the LOCKED anchor), updates a regression baseline, and emits a PASS/FAIL report. Use to validate the system end-to-end before a release, after touching auth/tenancy/scope, or on a schedule. Fully automated via Claude Code.
---

# Live Dogfood — validate the real system across every surface

Drives the **real** system end-to-end — browser → Traefik edge (`:8090`) → theo-cloud
(ForwardAuth + Model B broker) → theo-memory, plus the MCP server, the CLI, and the SDK —
exactly the way customers (and agents) consume it, then records the run as **dogfood
evidence**. This is not a hermetic Go e2e (`make e2e`) and not a demo test
(`/test-chat-with-memory`): it exercises the **live deployed surface** and the output is
production-readiness evidence + a regression delta.

**Multi-modal by design.** "As a human" is ONE modality (UX via Chrome MCP). MCP, CLI, and
SDK are machine/DX surfaces and are driven by their native client — not a browser. The
single source of truth for what runs is the journey catalog:

> **[`journeys/theo-memory.md`](./journeys/theo-memory.md)** — the 100%-surface catalog
> (32 REST routes · 9 MCP tools × 3 transports · ~10 CLI verbs · 8 SDK subpaths · 9 UX
> tabs + auth), each row tagged with its **modality** and **lens**, with a coverage ledger.

This skill is the **replication template** other `theo-data/**` capabilities copy (see
`theo-data/README.md` § 5). theo-memory is the reference target.

## The 5 drivers

| Modality | Driver | Surface |
|---|---|---|
| `browser` | Chrome DevTools MCP (snapshot→fill→click→assert+screenshot+network) | the human UX path (dashboard tabs + auth) |
| `http` | direct REST call (edge `:8090/v1/memory/*` or data plane `:18081/v1/*`) | the 32 REST routes + negative/security probes |
| `mcp` | a real MCP client over stdio / SSE / streamable-http vs `themory mcp` | native + OpenMemory tools, per-user isolation, transport auth |
| `cli` | `themory <verb>` subprocess, assert stdout/exit | the CLI verbs + flags + DX errors |
| `sdk` | `node -e` import + round-trip against a published subpath | the 8 `@usetheo/memory/*` subpaths |

## What it produces

1. `knowledge-base/dogfood/evidence/{date}-live-dogfood-{run}.md` — dated evidence with
   the project's frontmatter (feeds `/dogfood`; **sibling scenario**, see § Dogfood policy).
2. `knowledge-base/dogfood/baseline.json` — per-journey last outcome (regression baseline).
3. A consolidated PASS / PARTIAL / FAIL report with per-journey status + screenshots.

## Principles (non-negotiable)

- **Each row runs in its declared modality — never substitute.** A `browser` UX journey
  driven by `curl` is a FAIL of the skill's contract (it does not prove the human path).
  An `mcp` row MUST use a real MCP client (not an HTTP shim). A `cli` row MUST spawn the
  real `themory` binary. The modality IS the thing under test.
- **Cover both lenses** (`rules/testing.md` § 4.1): `edge` (extreme of a valid input) AND
  `negative` (invalid input → the *specific* typed error). A run with only happy journeys
  is half a suite.
- **Never fabricate evidence.** A row that fails is recorded as `outcome: fail` with the
  screenshot / response / stderr. Honest FAIL > false PASS (Unbreakable Rule 3).
- **Never print secrets** (minted keys, platform-admin key, cookies, JWTs) into the report.

## Dogfood policy (read before writing evidence)

- The anchor scenario **`claude-code-auto-memory` is LOCKED** (`knowledge-base/dogfood/
  manifest.md`) — it is Claude Code using TheMemory via MCP, a DIFFERENT scenario from
  this UI journey. **This skill MUST NOT write evidence under the anchor slug.**
- This skill writes a **sibling scenario** `dashboard-memory-journey`. Per the golden rule
  (`rules/dogfood-golden-rule.md` § 5), evidence `scenario:` may match the anchor OR a
  declared sibling. Before the first run, the operator declares the sibling in the manifest
  (a one-line row). The skill refuses to invent a new anchor or flip the anchor Status.

## Pre-conditions (Phase 0 verifies; refuse on failure)

1. Chrome DevTools MCP tools available (loaded via ToolSearch in Phase 0).
2. The live stack is reachable OR can be brought up:
   - edge `:8090` (theo-workspace Traefik), theo-cloud, kratos, dashboard, pg-cloud;
   - theo-memory data plane (host run, default `:18081`) + pg-themory + an LLM provider.
3. The themory image/build under test is **FRESH** — see Phase 0.3 (stale-build is the
   #1 false-confidence trap; `theo-data/README.md` § 6).
4. The Model B `memory:platform-admin` key is provisioned (the broker needs it to mint).

## Phase 0 — Pre-flight + bring up a FRESH stack

0.1 **Load Chrome MCP tools** via ToolSearch: `new_page`, `navigate_page`, `take_snapshot`,
    `take_screenshot`, `fill`, `fill_form`, `click`, `list_network_requests`, `wait_for`.

0.2 **Stack reachability.** Probe `GET http://localhost:8090/health` (BFF via edge) and
    `GET http://localhost:18081/v1/health` (themory). If down, bring up the live stack via
    the theo-workspace umbrella (`theo-cloud/theo-workspace`: `make up` / `make memory-up
    MODE=--host` per `docs/ONBOARDING.md § 4.B`). Never silently skip — report what you started.

0.3 **FRESH build (anti-stale).** If theo-memory source changed since the running themory
    image was built, rebuild and recreate ONLY the themory container:
    ```bash
    docker build -t themory-e2e:latest -f Dockerfile .
    docker compose -p theo-cloud-dev -f /path/docker-compose.dev.yaml up -d --no-deps --force-recreate themory
    ```
    Confirm `docker inspect …themory… --format '{{.Image}}'` matches the just-built id and
    `GET /v1/health` → 200. Pg-themory persists, so the minted platform-admin key survives.

0.4 **Model B provisioning.** Confirm theo-cloud holds `THEMORY_PLATFORM_ADMIN_KEY`. If the
    broker mint fails (502 "resolve per-tenant key: not found"), re-mint via the themory
    bootstrap token and recreate theo-cloud (mirrors `theo-cloud/tests/e2e/run.sh § 3.5`).

0.5 **Edge readiness.** `POST http://localhost:8090/v1/memory/recall` with NO auth MUST be
    denied (401/403) — proves Traefik + ForwardAuth are wired before any journey runs.

0.6 **Non-browser modality readiness** (skip a modality's rows + record SKIPPED if its driver
    is unavailable — never silently drop, never fabricate a pass):
    - `mcp` — `themory mcp` boots (stdio handshake responds) and `themory mcp --compat
      openmemory` exposes the SSE port; an MCP client lib is importable.
    - `cli` — the `themory` binary is on PATH (or `node dist/.../cli.js`) and `themory --help`
      exits 0 env-free.
    - `sdk` — the package builds / is importable (`node -e "require('@usetheo/memory')"` or the
      workspace `dist/`). If unbuilt, record the `sdk` rows SKIPPED with the reason.

## Phase 1 — A real user

1.1 Open a new isolated browser context. Navigate to `http://localhost:8090`.
1.2 If a session exists, you may reuse it for the primary user; for isolation journeys
    you MUST have two distinct identities.
1.3 **Register a fresh ephemeral identity** through the real register UI (the dashboard
    register page → Kratos). Use a time-nonce email (e.g. `dogfood+{epoch}@e2e.test`) so
    runs never collide. Kratos dev disables email verification → registration yields an
    active session. Capture the operator label for the evidence file.
1.4 Take a screenshot of the authenticated dashboard (proof of login).

## Phase 2 — Run the catalog (per modality)

Open **[`journeys/theo-memory.md`](./journeys/theo-memory.md)** — the 100%-surface catalog —
and execute EVERY row in its declared modality. Do NOT improvise the list; the catalog is the
contract and its ledger keeps coverage at 100%. Per modality:

- **`browser`** — Chrome MCP: `take_snapshot` → `fill`/`fill_form` → `click` → assert the
  result text + `list_network_requests` status; `take_screenshot` as evidence.
- **`http`** — call the REST route (edge `:8090/v1/memory/*` for the customer path, or the
  data plane `:18081/v1/*` directly for admin/negative/security probes). Assert status + body.
- **`mcp`** — start `themory mcp` (stdio) / `themory mcp --compat openmemory` (SSE), connect a
  real MCP client, `tools/list` then call the tool; assert the structured result + isolation.
- **`cli`** — spawn `themory <verb> …`; assert exit code + stdout (`--json` for parseable).
- **`sdk`** — `node -e` importing the subpath; assert the import resolves + the round-trip.

Order: run `browser` journeys first (they need the human session), then `http`, `mcp`, `cli`,
`sdk`; finish with the `§ F` cross-cutting isolation rows. Capture evidence for EVERY row
(screenshot for browser, response/exit for the rest). A `[CRIT]` row failing → run verdict `FAIL`.

For SECURITY rows, extract keys WITHOUT printing them: read `THEMORY_PLATFORM_ADMIN_KEY`
from the theo-cloud container env into a shell var; mint the read-only key via
`POST /v1/admin/keys {scopes:["memory:read"]}`. Never echo a key into the report.

## Phase 3 — Regression baseline

3.1 Load `knowledge-base/dogfood/baseline.json` (journey-id → last outcome). Absent ⇒ first run.
3.2 After Phase 2, diff: a journey that was `pass` and is now `fail` is a **REGRESSION**
    (flag it prominently). A new journey id is informational.
3.3 Write the updated baseline (only on a completed run; never on a half-run).

## Phase 4 — Evidence + report

4.1 Write `knowledge-base/dogfood/evidence/{YYYY-MM-DD}-live-dogfood-{nonce}.md` from
    `templates/evidence-template.md`:
    ```yaml
    ---
    scenario: dashboard-memory-journey   # sibling — NEVER claude-code-auto-memory
    date: YYYY-MM-DD
    status: running                      # only if the operator runs this for real
    operator: <name>
    outcome: pass | partial | fail
    summary: <one line — N/M journeys pass; regressions: …>
    ---
    ```
    Body: per-journey table (id, type, status, evidence pointer), screenshots list,
    regressions, the build sha/image id under test, exact repro commands.
4.2 Emit the console report: verdict (`PASS` all green / `PARTIAL` non-critical fails /
    `FAIL` any journey or isolation or security row failed), the regression list, and the
    evidence path. Recommend `/dogfood` next to re-score the gate.

## Stop conditions

- Stack cannot be brought up healthy after one retry → HALT; report the unhealthy service
  logs. Do not write a PASS evidence file.
- An `ISO-*` or `SEC-77-*` row fails → the run verdict is `FAIL` regardless of journeys
  (a leak or an authz hole is never "partial").
- Chrome MCP cannot reach the page → HALT (see `chrome-devtools-mcp:troubleshooting`).

## Anti-patterns

- **Validating a stale build.** Always Phase 0.3 — recreate themory with the fresh image
  before asserting anything (`theo-data/README.md` § 6).
- **Driving journeys via curl** instead of the browser — defeats "as a human".
- **Writing evidence under the LOCKED anchor** `claude-code-auto-memory` — use the sibling.
- **Fabricating a PASS** when a screenshot/network status disagrees — Rule 3.
- **Skipping isolation or the #77 security rows** — they are the heart of the flow's contract.
- **Printing secrets** (minted keys, platform-admin key, cookies) into the report — forbidden.

## Extensibility + replication

- Add a journey = add a row to the Phase 2 catalog + (optionally) a baseline id.
- Another `theo-data/**` capability copies this skill: keep Phases 0/1/3/4 verbatim,
  replace the Phase 2 catalog with that capability's UI journeys + its own
  `<cap>:read|write|delete` SECURITY rows, and point the edge path at `/v1/<cap>`. The
  data-plane contract is in `theo-data/README.md` / `theo-data/CLAUDE.md`.

## Cross-references

- Data-plane pattern (the contract under test): `theo-data/README.md`, `theo-data/CLAUDE.md`
- Dogfood gate (consumes this evidence): `.claude/skills/dogfood/` + `.claude/rules/dogfood-golden-rule.md`
- Hermetic counterpart (not human): `theo-cloud` `make e2e` / `make e2e-edge`
- Demo counterpart (not the real flow): `.claude/skills/test-chat-with-memory/`
- Chrome MCP: `chrome-devtools-mcp:chrome-devtools`, `chrome-devtools-mcp:troubleshooting`
- Edge wiring + bring-up: `theo-cloud/theo-workspace/docs/{adding-a-microservice,local-env-system-design}.md`
