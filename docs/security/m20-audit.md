# M20 dependency audit — before / after (#123)

`pnpm audit` on `develop`, 2026-07-25.

## Before

| Severity | Count |
|---|---|
| critical | 0 |
| high | 6 |
| moderate | 9 |
| low | 2 |

The 4 runtime advisories targeted by #123:
- `hono` — 3 moderate (API-gateway v1 adapter drop; hono/jsx per-request context; JSX escaping XSS).
- `@hono/node-server` — moderate path-traversal in `serve`/`serveStatic`.

The 3 HIGH transitive targeted:
- `brace-expansion` ×2 (DoS via exponential/unbounded expansion) — via `eslint>minimatch` (dev).
- `js-yaml` (quadratic via merge-key chains) — via `@apidevtools/swagger-parser`.

## Action

- `hono` bumped to `^4.12.32` (patched ≥4.12.27) in `packages/api` + root.
- `@hono/node-server` bumped `^1.x → ^2.0.11` (patched ≥2.0.5) in `packages/api` + root, and forced
  globally via `pnpm.overrides` `"@hono/node-server": "^2.0.5"` to reach the transitive 1.19.14
  instance pulled by `@usetheo/memory-mcp`.
- `pnpm.overrides` += `"brace-expansion": ">=5.0.8"` (patched) + `"js-yaml": ">=4.3.0"`.

The v1→v2 node-server major bump is proven non-breaking by the REST server integration suite:
**47/47 pass** (`tests/integration/auth/*`) against real `ankane/pgvector:v0.5.1`. ADR D1's
allowlist fallback was therefore NOT needed.

## After

| Severity | Count |
|---|---|
| critical | 0 |
| high | 1 |
| moderate | 5 |
| low | 2 |

**All 4 runtime advisories (hono ×3 + node-server) and all 3 HIGH transitive (brace-expansion ×2,
js-yaml) are cleared.** The residual 1 high + 5 moderate are dev/build-tooling advisories outside
#123's scope (not runtime-reachable) — tracked separately, not part of this milestone's DoD.
