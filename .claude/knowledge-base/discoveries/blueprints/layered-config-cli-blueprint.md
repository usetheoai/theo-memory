---
slug: layered-config-cli
milestone_id: M25
kind: discovery-blueprint
date: 2026-07-26
verdict: SHIPPABLE
references:
  - .claude/knowledge-base/references/mem0/cli/python/src/mem0_cli/config.py (mem0 config CLI + precedence)
  - packages/cli/src/cli.ts (our commander CLI; run-*.ts per subcommand)
  - packages/cli/src/run-keys.ts (existing subcommand shape to mirror)
  - .claude/knowledge-base/adrs (ADR D4 precedent — secrets env-only)
---

# Blueprint — M25 Layered config + `themory config` CLI

## Prior art (measured, not assumed)

**mem0** (`cli/python/src/mem0_cli/config.py`): a single JSON file at `~/.mem0/config.json`, documented
precedence **CLI flags > env > config file**. Simple `json` load/save. No source-attribution, no secret
masking — mem0's config is not security-hardened. We go further (source-attribution + secret discipline).

**memsearch**: the cross-validation cited `config.py:357` (layered deep-merge) but the clone lacks that
file at that path; not load-bearing — mem0 is the primary reference and its shape is clear.

**Our CLI** (`packages/cli/src/`): commander (`cli.ts`) with one `run-<verb>.ts` per subcommand
(run-remember/recall/forget/reflect/import/reextract/migrate/health/server/keys). M25 adds
`run-config.ts` + wires it in `cli.ts`, mirroring the existing shape exactly (no new pattern).

**Config libs**: NONE installed (`packages/cli` deps = agent-core + otel only). See ADR-1.

## The design (5-layer resolution, deep-merge, source-attributed)

Precedence (lowest → highest; later wins):

| # | Layer | Source |
|---|---|---|
| 1 | `defaults` | in-code constant map |
| 2 | global file | `~/.themory/config.json` |
| 3 | project file | `./.themory.json` (cwd-anchored) |
| 4 | env | `process.env` (the ~13 keys below) |
| 5 | CLI flags | explicit `--key value` on the invocation |

`resolveConfig(layers): { value: Record<string,string>, source: Record<string,layerName> }` — a pure
deep-merge that ALSO records, per key, which layer supplied the winning value (the DoD's "show the
source"). Deep-merge is a small recursive object merge (config is flat string→string today, but the
merge is object-safe for forward-compat).

## Config surface (measured — the keys)

Non-secret (file/env/flag configurable): `THEOMEM_PG_URI`, `OPENAI_CHAT_MODEL`, `OPENAI_BASE_URL`,
`THEMORY_BASE_URL`, `THEMORY_CORS_ORIGIN`, `THEMORY_OIDC_ISSUER`, `HOST`, `PORT`, `NODE_ENV`,
`EMBEDDING_DIM`, `THEMEMORY_REQUIRE_CREDENTIAL`, `THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE`,
`THEMEMORY_SKIP_MIGRATIONS`.

Secrets (env-only; masked in `list`; `set` REFUSES to write them to a file): any key matching
`/KEY|SECRET|TOKEN|PASSWORD|BOOTSTRAP/i` — measured hits: `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`GOOGLE_API_KEY`, `VOYAGE_API_KEY`, `THEMEMORY_API_KEY`, `THEOMEM_MIGRATE_TOKEN`,
`THEMORY_OIDC_CLIENT_SECRET`, `THEMORY_ADMIN_BOOTSTRAP_TOKEN`.

## The CLI surface

- `themory config init` — writes a commented `./.themory.json` skeleton (non-secret keys only) + a note
  that secrets stay in env. Refuses to overwrite an existing file (EC).
- `themory config set <key> <value>` — writes to `./.themory.json`. REFUSES a secret key (exit non-zero,
  clear message: "secret keys are env-only — set the <KEY> environment variable instead").
- `themory config get <key>` — prints the resolved value + its source layer (secret → masked).
- `themory config list` — every resolved key: `key = value  (source: <layer>)`, secrets masked as `••••`.

## ADRs

### ADR-1 — hand-rolled resolver, NOT cosmiconfig/conf (Rule 9 examined, not violated)
Generic config libs (cosmiconfig, conf, rc) load+merge files but do NOT (a) attribute the SOURCE layer
per key, nor (b) mask/refuse secrets — both are M25 DoD requirements. Wrapping a lib to add these is more
code than a ~40-line pure resolver + a secret predicate. So a bounded hand-rolled resolver is the minimal
correct thing (not reinventing a wheel — building exactly the DoD's contract, which no lib provides).
Rejected: cosmiconfig (no source-attribution/masking), conf (stateful singleton, wrong shape).

### ADR-2 — precedence env > file (mem0 parity + safety)
Env overrides files (layer 4 > 2/3), matching mem0 (env > file) — a deployed env var (e.g. an injected
`THEOMEM_PG_URI` in a container) must win over a stale committed `.themory.json`. CLI flags win over all
(layer 5) — an explicit `--pg-uri` on the command is the most deliberate signal. Rejected: file > env
(would let a stale file silently override a deployment — the R2 risk).

### ADR-3 — secrets NEVER written to a file, env-only (ADR D4 precedent)
`config set` on a secret key fails fast; `config list`/`get` mask secret VALUES. Prevents the R1 leak
(a committed `.themory.json` with a plaintext API key). Non-negotiable (Rule 8 + security).

## Coverage Corner 1 — Integration Tests
CLI round-trip vs a temp HOME/cwd: `config init` writes the file; `config set k v` persists; `config get k`
resolves + shows source; `config list` masks secrets; `config set OPENAI_API_KEY x` FAILS. Plus ≥1 real
consumer (`themory server` / factory) resolving `THEOMEM_PG_URI` through `resolveConfig`.

## Coverage Corner 2 — Dependencies
Zero new runtime deps (ADR-1). Reuses `node:fs`, `node:path`, `node:os` (homedir) + commander (installed).

## Coverage Corner 3 — Tools
vitest (unit: precedence/deep-merge/source-attribution/secret-predicate) + integration (CLI round-trip vs
temp dirs). The M25 eval typecheck gate (C1) + `/code-quality` + `/review`.

## Coverage Corner 4 — Techniques
Pure resolver (deep-merge + source-map) — deterministic, unit-testable without I/O. Secret predicate as a
pure function. File I/O isolated to thin load/save helpers (DIP-friendly; tests inject temp paths).
