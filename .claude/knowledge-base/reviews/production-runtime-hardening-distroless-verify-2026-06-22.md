# Distroless isolated-vm verification (production-runtime-hardening T2.2 / ADR D3)

**Date:** 2026-06-22
**Image:** `themory-e2e:prh3` (HEAD + Phase 1 wire + Phase 3 Docker fixes), `gcr.io/distroless/nodejs22-debian12:nonroot` runtime.

## Result: PASS — isolated-vm loads + executes in the distroless runtime.

Container run with `THEOMEM_SKILL_EXECUTION=true` against the stack's real `pg-themory`:

| Check | Result |
|---|---|
| Server boots with skill-exec enabled (EC-1 no-crash) | `Up`, `listening on 0.0.0.0:8080` |
| `isolated-vm` at `/app/node_modules` (runtime root) | **present** |
| `onnxruntime-node` (local embedder) at runtime root | **present** (latent bug also fixed) |
| `POST /v1/scopes/skill/dv3/skills/:id/execute {x:40,y:2}` | **HTTP 200** `{"output":42,"truncated":false,"elapsedMs":31.7}` |

## Root cause + fix (the M2-live-test finding)
The published image returned **503 SKILL_EXECUTOR_UNAVAILABLE** because the `production-deps` stage used pnpm's default ISOLATED node_modules layout: the OPTIONAL native deps (`isolated-vm`, `onnxruntime-node`) landed under `packages/*/node_modules` (or only in `.pnpm`), NOT at the top level the runtime copies → unreachable from the flattened `/app/dist`. Two intermediate attempts (toolchain; copy `packages/`) were necessary but insufficient. The fix: `production-deps` installs with `--config.node-linker=hoisted` → FLAT node_modules with every dep at the top level → the runtime copies isolated-vm + onnxruntime-node → both load.

Combined with the prior commits (isolated-vm `^7`→`^6.1.2` Node-22 compat; node-gyp toolchain), M1 skill execution now works end-to-end in the distroless production runtime when opted in via `THEOMEM_SKILL_EXECUTION=true`.
