---
slug: layered-config-cli
milestone_id: M25
created_at: 2026-07-26
goal: Deliver layered config resolution + `themory config` CLI, measured by green unit + integration tests and one real consumer resolving THEOMEM_PG_URI via the resolver.
---

# Plan — M25 Layered config + `themory config` CLI

## Goal

Deliver a 5-layer config resolver (defaults → global file → project file → env → CLI flags) with
per-key source-attribution + secret discipline, plus `themory config init/set/get/list`, measured by:
unit tests (precedence, source-attribution, secret predicate) + an integration CLI round-trip + one real
consumer (`createServer`/factory) resolving `THEOMEM_PG_URI` through the resolver — all green.

## Context

M25 closes the clearest mem0-parity gap (mem0's CLI has config, ours does not) and the lowest
cross-validation dimension (Configuration 2.5/5). Grounded in blueprint `layered-config-cli` (SHIPPABLE)
and the grill DoD. mem0's shape: `~/.mem0/config.json`, precedence flags > env > file. We extend it with
per-key source-attribution + secret masking (mem0 does neither).

## Baseline Context

### Files that will be touched

| File | LoC today | Why it exists / change |
|---|---|---|
| `packages/core/src/domain/config/resolve.ts` | (NEW) | Pure resolver: deep-merge N layers → {value, source} per key |
| `packages/core/src/domain/config/secrets.ts` | (NEW) | Pure `isSecretKey(key)` + `maskSecret(value)` |
| `packages/core/src/infrastructure/config/load.ts` | (NEW) | `loadConfig()` — reads global + project files + env, composes via resolve.ts |
| `packages/core/src/index.ts` | ~ | Add `@usetheo/memory/config` subpath export (resolve + loadConfig + isSecretKey) |
| `packages/core/package.json` | ~ | `exports["./config"]` → dist |
| `packages/cli/src/run-config.ts` | (NEW) | `themory config init/set/get/list` (mirrors run-keys.ts shape) |
| `packages/cli/src/cli.ts` | ~ | Wire the `config` subcommand |
| `packages/api/src/server/*` OR `packages/core/.../factory.ts` | ~ | Real consumer: resolve `THEOMEM_PG_URI` via `loadConfig` |

### Config surface (measured)

Non-secret keys: `THEOMEM_PG_URI, OPENAI_CHAT_MODEL, OPENAI_BASE_URL, THEMORY_BASE_URL,
THEMORY_CORS_ORIGIN, THEMORY_OIDC_ISSUER, HOST, PORT, NODE_ENV, EMBEDDING_DIM,
THEMEMORY_REQUIRE_CREDENTIAL, THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE, THEMEMORY_SKIP_MIGRATIONS`.
Secret keys (predicate `/KEY|SECRET|TOKEN|PASSWORD|BOOTSTRAP/i`): `OPENAI_API_KEY, GEMINI_API_KEY,
GOOGLE_API_KEY, VOYAGE_API_KEY, THEMEMORY_API_KEY, THEOMEM_MIGRATE_TOKEN, THEMORY_OIDC_CLIENT_SECRET,
THEMORY_ADMIN_BOOTSTRAP_TOKEN`.

### Glossary
- **Layer** — one config source (defaults/global/project/env/flags); higher index wins.
- **Source-attribution** — per resolved key, which layer supplied the winning value (for `get`/`list`).
- **Secret key** — a key whose value must never be written to a file; env-only; masked in output.

### Architecture boundaries
Per `architecture.md`: the pure resolver + secret predicate are DOMAIN (no I/O). `loadConfig` (reads
files/env) is INFRASTRUCTURE. The CLI (interface) + server (interface) consume `loadConfig`. Core exposes
`@usetheo/memory/config`; api + cli depend on core (allowed direction).

## Prior Art & Related Work
- Blueprint `layered-config-cli` (`.claude/knowledge-base/discoveries/blueprints/`).
- mem0 `cli/python/src/mem0_cli/config.py` (JSON file + flags>env>file precedence).
- `packages/cli/src/run-keys.ts` — the subcommand shape to mirror.
- the env-only-secrets precedent (CLAUDE.md Item 20 auth lifecycle) (secrets env-only) — CLAUDE.md Item 20.

## ADRs

### ADR-1 — hand-rolled resolver, not cosmiconfig/conf
Generic libs merge files but do NOT attribute the source layer per key nor mask/refuse secrets — both are
M25 DoD requirements. A ~40-line pure resolver + secret predicate is less code than wrapping a lib to add
them. Alternatives rejected: **cosmiconfig** (no source-attribution/masking), **conf** (stateful
singleton, wrong shape for a pure resolver). Rule 9 examined — not a reinvented wheel; it is exactly the
DoD's contract, which no lib provides.

### ADR-2 — precedence env > file, flags > env (mem0 parity + safety)
Env (layer 4) overrides files (2/3) so a deployed env var wins over a stale committed `.themory.json`
(mitigates R2). CLI flags (layer 5) win over all — the most deliberate signal. Alternative rejected:
**file > env** (a stale file silently overriding a deployment — the exact R2 risk).

### ADR-3 — secrets never written to a file, env-only
`config set <secret>` fails fast; `list`/`get` mask secret values. Alternative rejected: **allow secrets in
file with a warning** — one committed key is a breach (R1); Rule 8 + security forbid it.

## Dependency Graph
```
T1 (pure resolve) ─┐
T2 (secrets pure) ─┼─→ T3 (file load/save) ─→ T4 (loadConfig compose) ─→ T5 (CLI) ─→ T6 (real consumer wiring)
```
T1, T2 parallelize; T3 depends on none (temp-dir I/O) but feeds T4; T4 depends on T1+T2+T3; T5 on T4; T6 on T4.

## Phase 1 — Core resolver (domain, pure)

### T1.1 — `resolveConfig(layers)` deep-merge + source-attribution
#### Why this step
The core mechanism: merge ordered layers into a final `{value, source}`. Pure → deterministic, the
bottleneck of correctness. Reasoning: source-attribution (ADR-1) is why we hand-roll — a junior reading
`get`/`list` must see which layer won.
#### Files to edit
- `packages/core/src/domain/config/resolve.ts` (NEW), `resolve.test.ts` (NEW)
#### TDD
- `test_later_layer_wins`: `resolveConfig([{k:'a'},{k:'b'}], names)` → value.k==='b', source.k===layer2name.
- `test_source_attribution_per_key`: mixed layers → each key's source is the highest layer that set it.
- `test_deep_merge_nested_objects`: nested object keys merge (forward-compat), not replace.
- `test_empty_layers_yield_empty`.
#### Concurrency tests
(none — single-threaded; pure logic + file I/O, no shared mutable state)
#### Acceptance criteria
Pure (no fs/env/Date import); later layer wins; per-key source recorded; deterministic.

### T1.2 — secret predicate + mask
#### Why this step
Secrets must never leak (R1). A pure `isSecretKey` + `maskSecret` used by both the CLI (refuse/mask) and
tests. Reasoning: ADR-3 — the security line; pure so it is trivially testable + reusable.
#### Files to edit
- `packages/core/src/domain/config/secrets.ts` (NEW), `secrets.test.ts` (NEW)
#### TDD
- `test_secret_key_detected`: OPENAI_API_KEY, THEMEMORY_API_KEY, THEMORY_OIDC_CLIENT_SECRET, X_TOKEN, X_PASSWORD, X_BOOTSTRAP → true.
- `test_non_secret_key`: THEOMEM_PG_URI, OPENAI_CHAT_MODEL, HOST, PORT → false.
- `test_mask_hides_value`: `maskSecret('sk-123')` → `••••` (no original chars leak).
#### Concurrency tests
(none — single-threaded; pure logic + file I/O, no shared mutable state)
#### Acceptance criteria
Predicate matches `/KEY|SECRET|TOKEN|PASSWORD|BOOTSTRAP/i`; mask reveals nothing; pure.

## Phase 2 — Load + compose (infrastructure)

### T2.1 — file load/save helpers (global + project)
#### Why this step
Read `~/.themory/config.json` (global) + `./.themory.json` (project); save to project. Isolated thin I/O
so `loadConfig` stays composable + testable via injected paths. Reasoning: DIP (`architecture.md`) — I/O
at the edge; a malformed file must fail LOUD (typed error), never silently.
#### Files to edit
- `packages/core/src/infrastructure/config/load.ts` (NEW), `load.test.ts` (NEW)
#### TDD
- `test_reads_global_and_project`: temp HOME + temp cwd with files → both parsed.
- `test_missing_files_are_empty_not_error`: no files → `{}` (not throw).
- `test_malformed_json_throws_typed`: bad JSON → typed `ConfigParseError` naming the file (negative case).
- `test_save_writes_project_file`: save {k:v} → `./.themory.json` contains it.
#### Failure scenarios
- **Malformed config file** (external I/O): `JSON.parse` throws → wrap in `ConfigParseError(path, cause)`; test asserts the typed error + path.
- **Unreadable/permission-denied file**: surfaced as a typed error, not a silent empty.
#### Concurrency tests
(none — single-threaded; pure logic + file I/O, no shared mutable state)
#### Acceptance criteria
Missing→{}, malformed→typed error naming the file, save round-trips; global + project both read.

### T2.2 — `loadConfig(opts?)` composes all 5 layers
#### Why this step
The public entry: assemble defaults + global + project + env + flags → `resolveConfig`. Env maps the ~13
keys; flags optional. Reasoning: this is what consumers call; ADR-2 precedence realized here.
#### Files to edit
- `packages/core/src/infrastructure/config/load.ts`, `packages/core/src/index.ts` (+ `@usetheo/memory/config` export), `packages/core/package.json` (exports)
#### TDD
- `test_env_overrides_project` (ADR-2): project file sets PG_URI=A, env sets B → resolved B, source='env'.
- `test_flag_overrides_env`: flags {PG_URI:C} → resolved C, source='flags'.
- `test_secret_from_env_only`: env OPENAI_API_KEY present → resolved + source='env'; a project file with OPENAI_API_KEY is IGNORED for secrets (never loaded from file).
#### Concurrency tests
(none — single-threaded; pure logic + file I/O, no shared mutable state)
#### Acceptance criteria
5-layer precedence correct; `@usetheo/memory/config` subpath resolves (smoke import); secrets never sourced from files.

## Phase 3 — CLI + consumer

### T3.1 — `themory config init/set/get/list`
#### Why this step
The operator surface (the mem0-parity gap). Mirrors `run-keys.ts`. Reasoning: DoD bullet 2 + 4; `set`
refuses secrets (ADR-3), `get`/`list` show source + mask.
#### Files to edit
- `packages/cli/src/run-config.ts` (NEW), `packages/cli/src/cli.ts`, `packages/cli/src/__tests__/config.test.ts` (NEW)
#### TDD (integration, temp HOME/cwd)
- `test_init_writes_commented_skeleton` + refuses to overwrite existing.
- `test_set_persists_to_project_file`; `test_set_secret_key_refused` (exit ≠ 0, message says env-only, file NOT written).
- `test_get_shows_value_and_source`; `test_list_masks_secrets` (secret value never printed).
#### Concurrency tests
(none — single-threaded CLI; no shared mutable state.)
#### Acceptance criteria
All 4 verbs work; `set` refuses secrets; `list`/`get` mask + show source; wired in `cli.ts` (help lists `config`).

### T3.2 — real consumer resolves `THEOMEM_PG_URI` via `loadConfig`
#### Why this step
DoD bullet 3: prove the resolver is not an island. `themory server`/factory resolves the DB URI through
`loadConfig` (env still wins, back-compat). Reasoning: wiring triad — a caller exercises the resolver end-to-end.
#### Files to edit
- `packages/cli/src/run-server.ts` OR `packages/core/.../factory.ts` (whichever owns THEOMEM_PG_URI default)
#### TDD
- `test_server_resolves_pg_uri_via_loadConfig`: with only env set → same URI as before (back-compat); with a project file + no env → file value used.
#### Concurrency tests
(none — single-threaded; pure logic + file I/O, no shared mutable state)
#### Acceptance criteria
The consumer reads `THEOMEM_PG_URI` through `loadConfig`; existing env-only deployments behave identically (back-compat regression test green).

## Coverage Matrix
| Requirement (DoD) | Task |
|---|---|
| deep-merge defaults→global→project→env→flags, precedence tested | T1.1, T2.2 |
| `themory config init/set/get/list` + show source | T3.1 |
| ≥1 real consumer via loadConfig | T3.2 |
| secrets: list masks, set refuses to file, env-only | T1.2, T3.1, T2.2 |
| unit + integration tests + CHANGELOG | T1–T3 + Final Phase |

## Drawbacks & Risks
| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| R1 secret leakage (committed `.themory.json` with a key) | HIGH | `set` refuses secret keys (T3.1); `list`/`get` mask (T1.2); `init` writes non-secret skeleton + note | impl |
| R2 precedence confusion (file silently overrides env) | MED | env > file (ADR-2); `get`/`list` always show the source layer (T3.1) | impl |
| New core subpath export adds a surface | LOW | smoke-import + bundle-isolation gate; C1 typecheck covers it | impl |

## Unresolved Questions
- Should `config set` also support the global file (`--global`)? Deferred — project-file `set` covers the DoD; a `--global` flag is a trivial follow-up if requested (YAGNI now).

## Failure scenarios
- **Malformed `.themory.json`** → `ConfigParseError` naming the file (T2.1), never a silent empty.
- **`$HOME` unset** (rare CI) → global layer treated as empty (no throw); test covers.

## Global DoD
- `pnpm build` + `pnpm typecheck` + eval-not-applicable; core typecheck clean; `pnpm lint` 0 warnings.
- New files ≤ 300 LoC (hook gate); pure domain files have no I/O import.
- CHANGELOG `[Unreleased]` updated (Rule 6).
- `/code-quality` verdict ∉ {FAIL_HARD, INVALID}.
- All T1–T3 tests green (unit + integration vs temp dirs).

## Final Phase — Integration Validation
Full chain green (build/typecheck/lint/test) + the CLI round-trip integration test + the back-compat
consumer regression test. THE GOAL TEST: `themory config` round-trip works end-to-end AND `themory server`
resolves `THEOMEM_PG_URI` via `loadConfig` with env still winning. Milestone flips `[x]` only when all
five DoD bullets are green with evidence.
