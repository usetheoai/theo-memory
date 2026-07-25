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
js-yaml) are cleared.** The residual 1 high (postcss, dev via vite) + 5 moderate are **outside
#123's scope and tracked separately** — this milestone's DoD is the 4 runtime + 3 HIGH targets only.
Note (honesty, `/review` F4): some residuals ARE runtime-reachable (`@opentelemetry/core` is a
direct runtime dep; `body-parser`/`protobufjs`/`mongoose` are runtime-transitive) — they are simply
not in #123's scope, not "unreachable". They get their own follow-up.

The Before→After HIGH count went 6 → 1 (5 removed): 3 were the #123 targets (brace-expansion ×2,
js-yaml); the other 2 were stale transitive HIGH (old `brace-expansion@1.1.15`/`5.0.6` +
`balanced-match` chains) that the lockfile regeneration dropped alongside the override.

### js-yaml override note (`/review` F3)

`"js-yaml": ">=4.3.0"` resolves to **js-yaml@5.2.2** (a major-5 jump — 5.x dropped YAML merge-key
support). This is **intentional and safe here**: js-yaml is consumed ONLY by devDependencies
(`@apidevtools/swagger-parser` in `openapi.test.ts` + eslint), so it is NOT in the runtime bundle,
and the full contract suite (which runs `openapi.test.ts`) passes green under js-yaml 5.2.2.
