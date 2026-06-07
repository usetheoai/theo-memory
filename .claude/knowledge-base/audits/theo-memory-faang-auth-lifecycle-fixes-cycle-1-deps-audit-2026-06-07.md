# Deps Audit: theo-memory-faang-auth-lifecycle-fixes-cycle-1

**Date:** 2026-06-07
**Mode:** plan-bound
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** none for plan-declared deps; project-wide transitive vulns not this plan's surface

## Summary

- Ecosystems detected: npm
- Plan declares: 0 new deps; reuses `oauth4webapi ^3.8.6` + `hono >=4.11.4` + `pg ^8` (all pinned by parent cycle T0.1)
- Vulnerabilities found in deps THIS plan introduces: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW**
- Vulnerabilities found in pre-existing project deps (NOT introduced by this plan): 1 CRITICAL + 3 HIGH + 4 MODERATE = 8 total

## Vulnerabilities

### Plan-introduced deps

(none — plan adds no new dependencies)

### Pre-existing project deps (out of cycle scope)

| Severity | Package | Path |
|---|---|---|
| critical | `protobufjs` | `@xenova/transformers → onnxruntime-web → onnx-proto → protobufjs` |
| high | `onnx-proto` | `@xenova/transformers → onnxruntime-web → onnx-proto` |
| high | `onnxruntime-web` | `@xenova/transformers → onnxruntime-web` |
| high | `@xenova/transformers` | direct |

These are inherited from the `LocalTransformerEmbedder` (Xenova MiniLM) chain shipped via `adapters-openrouter-local-embedder` (CHANGELOG 2026-06-02). NOT introduced by `theo-memory-faang-auth-lifecycle-fixes-cycle-1`. Documented as pre-existing project-level concern; **recommend a separate `/deps-audit` cycle targeted at the embedder dep chain** before any production release.

## Plan validation

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| oauth4webapi ^3.8.6 | Existing (parent T0.1) | yes | yes | yes (blueprint Q5) | OK |
| hono >=4.11.4 | Existing (parent T0.1) | yes | yes (CVE pin in place) | yes | OK |
| pg ^8 | Existing (pre-existing) | yes | yes | yes | OK |

## Recommended next steps

1. Plan is clean from new-deps perspective → proceed to `/plan-confidence`.
2. **Schedule a separate `/deps-audit` cycle** for the `@xenova/transformers` chain — out of scope for `theo-memory-faang-auth-lifecycle-fixes-cycle-1` but a real project-level concern.
3. Apply NO diffs from this cycle's `package.json` perspective.
