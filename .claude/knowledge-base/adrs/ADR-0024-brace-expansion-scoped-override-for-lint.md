# ADR-0024 — Scoped brace-expansion override to unbreak lint, accepting a dev-only residual advisory (#138)

- **Status:** Accepted
- **Date:** 2026-07-25
- **Issue:** #138 (`npm run lint` fully broken by the `brace-expansion >=5.0.8` override from #123)
- **Supersedes (partially):** the blanket `pnpm.overrides["brace-expansion"] = ">=5.0.8"` introduced in #123 (`4aabd7a`)

## Context

#123 added a blanket `pnpm.overrides` pin `"brace-expansion": ">=5.0.8"` to clear the HIGH advisory **GHSA-mh99-v99m-4gvg** ("brace-expansion: DoS via unbounded expansion length"), whose `patched: >=5.0.8` range treats **every** version `<=5.0.7` as vulnerable.

`brace-expansion@5.x` is an **ESM** package (`"type": "module"`, named `expand` export). `eslint`'s bundled **`minimatch@3.1.5`** requires `brace-expansion@^1.1.7` and consumes it as a **CJS default function** (`const expand = require('brace-expansion'); expand(...)`). Forcing minimatch@3 to 5.x makes `require()` return the ESM-interop object, so `expand(...)` throws `TypeError: expand is not a function` at ESLint config-array construction — before any file is linted. Result: `npm run lint` was 100% broken (the repo-wide lint gate protected nothing).

This is a **genuine conflict**: the advisory only clears at `>=5.0.8` (ESM), but **no released `minimatch` version depends on brace-expansion 5.x yet**, and `minimatch@3` (eslint's dep) physically cannot use it.

## Decision

Replace the blanket override with a **surgical, scoped** pair:

```jsonc
"brace-expansion": ">=5.0.8",           // production / all other paths — CVE cleared
"minimatch@3>brace-expansion": "1.1.16" // ONLY minimatch@3 (eslint dev tooling) — CJS function export
```

`1.1.16` is the latest `maintenance-v1` release (1.x line, CJS function export), so `minimatch@3` works and lint runs. Every other path keeps `>=5.0.8`.

The residual GHSA-mh99-v99m-4gvg finding then remains on the `minimatch@3` dev paths.
`pnpm audit` collapses this to **one representative path** (`.>eslint>minimatch>brace-expansion`),
but the graph actually reaches `brace-expansion@1.1.16` via **two dev-only chains** (both
through `minimatch@3.1.5`): (a) the eslint family (`eslint`, `@eslint/config-array`,
`@eslint/eslintrc`, `eslint-plugin-import`) and (b) `ts-prune → ts-morph → @ts-morph/common →
minimatch@3.1.5`. It is **accepted** via `deps-audit-allowlist.txt` (sunset 2026-10-23) because:

1. **Dev-only.** Every consumer of `minimatch@3.1.5` is a **devDependency** (eslint family +
   ts-prune, the dead-code auditor). No workspace runtime package (`packages/*/package.json`)
   declares minimatch / ts-morph / ts-prune / eslint as a runtime dep, so brace-expansion 1.1.16
   never ships in any published package or Docker image (production paths are all 5.0.8).
2. **Trusted input.** The advisory is a ReDoS/OOM triggered by an attacker-controlled **glob
   pattern**. eslint/ts-prune expand only the **project's own** config globs
   (`packages/*/src/**/*.ts`), never untrusted external input — the attack vector is not reachable.

**Scope caveat.** The override key `"minimatch@3>brace-expansion"` scopes by **dependency edge**
(any `minimatch@3.x` consumer), not by dev-vs-prod. Today every `minimatch@3` consumer is a
devDependency (verified), so no production path is downgraded. If a FUTURE production/runtime
dependency ever resolves `minimatch@3.x` it would silently receive the vulnerable brace-expansion
1.1.16 — the 90-day sunset forces a re-review before that can go unnoticed, and the deps-audit
gate re-fires the finding at full severity once the entry expires.

## Alternatives considered

- **Keep the blanket `>=5.0.8`** — rejected: it IS the bug (#138); lint stays broken.
- **Per-major pins (1.1.16 / 2.1.2 / 3.0.2 / 4.0.1) globally** — rejected: downgrades production paths below 5.0.8, re-flagging the advisory on MANY paths (the advisory's `patched` is `>=5.0.8`, so any `<5.0.8` is flagged regardless of major-maintenance backports). The scoped override keeps the residual to the single unavoidable dev path.
- **Upgrade eslint / minimatch to a brace-expansion-5.x-compatible release** — rejected: no such release exists yet (5.x is very new; no minimatch depends on it). Revisit at sunset.

## Consequences

- `npm run lint` works again (config loads; 0 violations on the current tree).
- Production CVE mitigation preserved (brace-expansion 5.0.8 on all shipped paths).
- One residual dev-only advisory, explicitly risk-accepted with a 90-day sunset (`deps-audit-allowlist.txt`) — re-fires at full severity if not revisited.
- When eslint/minimatch adopt brace-expansion 5.x, drop the scoped override + the allowlist entry.
