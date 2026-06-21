# Deps Audit: agentic-skill-execution-sandbox

**Date:** 2026-06-21
**Mode:** plan-bound:agentic-skill-execution-sandbox
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (TS monorepo)
- Plan deps audited: 1 NEW (`isolated-vm`) + 1 existing (`@opentelemetry/api`)
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
- Outdated: n/a (NEW dep pinned to latest `^7.0.0`)
- Allowlist hits: 0
- Auditor coverage: { npm-registry: ran (version resolution), osv-scanner: installed, OSV-API: ran (CVE query) }

## Plan validation (Mode 2)

| Plan dep | Section | Registry match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `isolated-vm` | NEW (optionalDependency) | yes — latest 7.0.0 of 88 versions on registry.npmjs.org | yes — OSV query returned **0 vulns** at 7.0.0 AND 5.0.4 | yes — evaluated vm2 (rej: CVE-2026-22709 9.8), node:vm (rej: not a boundary), worker_threads (rej: shares process), QuickJS-WASM (rej: heavier); isolated-vm selected | OK |
| `@opentelemetry/api` | Existing | yes (already a dep) | n/a (unchanged) | n/a | OK |

## Findings

No vulnerabilities. `isolated-vm` is CVE-clean per OSV:
- `POST https://api.osv.dev/v1/query` `{npm, isolated-vm, 7.0.0}` → `vulns: 0`.
- `POST https://api.osv.dev/v1/query` `{npm, isolated-vm, 5.0.4}` → `vulns: 0`.
- `registry.npmjs.org/isolated-vm` → latest `7.0.0`; 88 published versions; actively published.

## Notes (non-blocking, surfaced for the security review gate)

1. **Maintenance mode** — isolated-vm's README states it is in maintenance mode. This is NOT a CVE and does NOT cap the deps-audit verdict; it is the defense-in-depth rationale (ADR D2): the 6 guards + the out-of-process DIP seam are the backstop. The dedicated security review at `/review` MUST weigh the maintenance-mode + native-addon + RCE-surface posture.
2. **Native addon** — `isolated-vm` ships native bindings (node-gyp/prebuilt). As an `optionalDependency` it does not break installs that skip it; the CI integration job + the distroless image MUST build/load it (onnxruntime-node glibc precedent). Tracked in the plan's Drawbacks table (High severity, mitigated).

## Recommended next steps

1. Plan pin corrected to `^7.0.0` (was `^5.0.0`) — already absorbed into the plan v1.1 Dependencies table + Q1.
2. Proceed to `/plan-confidence agentic-skill-execution-sandbox`.
3. The dedicated security review (RCE surface) remains a mandatory `/review` gate per the plan's Global DoD.
