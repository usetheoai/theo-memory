# Edge Case Review — production-runtime-hardening

Date: 2026-06-22
Tasks analyzed: 4 (T1.1, T2.1, T2.2, T3.1)
Edge cases found: 6 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 3)

## MUST FIX

### EC-1: enabling the env when `isolated-vm` is NOT installed must NOT crash server boot
- **Affected task:** T1.1
- **Family:** State / Resource
- **Scenario:** an operator sets `THEOMEM_SKILL_EXECUTION=true` on a runtime where the optional `isolated-vm` addon is absent (e.g. INCLUDE_OPTIONAL=false image, or a platform with no prebuilt). `wireMemoryFromPool` constructs `new SandboxedSkillExecutor()` at Memory-warm time. If the CONSTRUCTOR eagerly loads `isolated-vm`, the server boot (warm Promise) throws → the whole server is down, not just skill-execute.
- **Impact:** turning on an opt-in feature crashes the entire REST/MCP server (DoS) instead of degrading to a 503 on execute only.
- **Suggested fix:** confirm `SandboxedSkillExecutor`'s constructor is addon-free (M1 lazy-loads `isolated-vm` only at `execute()` via `loadIsolatedVm`); add a unit assertion that `new SandboxedSkillExecutor()` does not throw without the addon, and that execute then yields the typed `503 SkillExecutorUnavailable`. If the constructor is NOT lazy, wrap the wire so a construction failure logs + leaves `skillExecutor` undefined (degrade to 501, never crash boot).

## SHOULD TEST

### EC-2: `THEOMEM_SKILL_EXECUTION` accepts ONLY exact `'true'`
- **Affected task:** T1.1
- **Suggested test:** `test_skill_execution_env_exact_true_only` — assert `'1'`, `'TRUE'`, `'yes'`, `' true '` all resolve to DISABLED (exact-match, mirroring `resolveEmbedderKind`'s exact lowercase contract). Prevents a silently-disabled feature when an operator guesses the value.

### EC-3: enabling skill-exec is all-or-nothing across server + MCP + CLI
- **Affected task:** T1.1 / D2
- **Suggested test:** `test_wire_enables_executor_for_all_entrypoints` — since the wire is in the single shared `wireMemoryFromPool`, assert the resolver is the only gate (one env flips server + MCP + CLI together). Documents the blast radius so a reviewer does not expect per-surface control.

## DOCUMENT

### EC-4: static import of `SandboxedSkillExecutor` is sufficient (no dynamic import needed)
- **Accepted risk:** the plan's Deep Dive proposes `await import('@usetheo/memory')` to stay barrel-clean, but `createLocalMemory` is ALREADY a static import from `@usetheo/memory` (`agent-tools-memory.ts:27`), and `SandboxedSkillExecutor`'s constructor is addon-free (isolated-vm loads only at execute). So a STATIC `import { SandboxedSkillExecutor }` does NOT pull `isolated-vm` at module-load. Prefer the static import (KISS) over a dynamic one; record the rationale at the call site. (If a future audit shows the barrel does pull the addon, revert to dynamic import — but verify, don't assume.)

### EC-5: build retry around `pnpm install` retries the WHOLE install
- **Accepted risk:** T3.1's bounded retry wraps the full `pnpm install`, not just the libvips download (Dockerfile RUN granularity). pnpm is cache-friendly so a retry is cheap; a NON-transient failure (lockfile mismatch) still fails after the cap. Acceptable — document that the retry is for transient network only and fails loud after N attempts.

### EC-6: T2.2 distroless verification requires adding the env to the container
- **Accepted risk:** the running stack's themory container has no `THEOMEM_SKILL_EXECUTION`; the verification step must run a container (or `docker exec`/recreate) WITH the env set. Operational note for T2.2 — not a code change.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 4 | 1 (EC-1) | 2 (EC-2, EC-3) | 1 (EC-4) |
| T2.2 | 1 | 0 | 0 | 1 (EC-6) |
| T3.1 | 1 | 0 | 0 | 1 (EC-5) |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (constructor-addon-free / no-crash-on-boot) as MUST-FIX into T1.1; fold EC-2 + EC-3 test assertions into T1.1 TDD; record EC-4/EC-5/EC-6 as DOCUMENT notes. Then `/plan-confidence`.
