# ADR-0009: Cloud auth — `THEOKIT_API_KEY` reuse with optional `apiKey` parameter override

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D9
- **Owner:** TheMemory v0.0 contract design
- **Resolves:** CLAUDE.md § Open questions Q6

## Context

The cloud runtime (`@usetheo/memory/cloud`, ships at v0.5 per roadmap Item 7) needs an authentication mechanism for TheoCloud-managed access. Three options:

- (a) Reuse `THEOKIT_API_KEY` env var (shared credential across the TheoCloud surface)
- (b) Introduce a dedicated `THEMEMORY_API_KEY` env var (per-product credential)
- (c) Reuse `THEOKIT_API_KEY` with optional explicit `apiKey` constructor parameter override

Question Q6 asked which to pick. Context from `CLAUDE.md § Architectural Decisions Locked § Cross-Project Rule 6 exception`: TheoKit + TheMemory + TheoCloud is a DELIBERATE single-platform consolidation. The lock-in is a feature, owned explicitly. Reusing the auth credential is the practical surface of that consolidation.

## Decision

**Path (c)**: The cloud runtime reads `THEOKIT_API_KEY` from process env by default. `CloudMemoryConfig` (the cloud runtime's constructor config, declared in T2.5) accepts an optional `apiKey?: string` parameter that overrides the env var when set.

No separate `THEMEMORY_API_KEY`.

```ts
export interface CloudMemoryConfig extends MemoryConfig {
  /** Overrides `THEOKIT_API_KEY` env var when set. */
  readonly apiKey?: string;
  /** Cloud endpoint base URL. Defaults to TheoCloud production; override for dev/staging. */
  readonly baseUrl?: string;
}
```

Resolution order at v0.5 runtime:

1. If `apiKey` is provided in `CloudMemoryConfig`, use it.
2. Otherwise, read `process.env.THEOKIT_API_KEY`. If set, use it.
3. Otherwise, throw a typed error (e.g., `InvalidScope` or a new `MissingApiKey` — locked at v0.5 implementation).

## Consequences

**Positive:**

- Single env var across the TheoCloud surface. A user installs `@usetheo/sdk` and `@usetheo/memory/cloud` and gets a unified auth model.
- Matches `@usetheo/sdk` pattern (root `CLAUDE.md § Cross-Project Rule 6` consolidation).
- Minimum config to get started: one env var.
- Override allows multi-account / dev-vs-prod scenarios via explicit `apiKey` constructor arg.

**Negative:**

- Multi-account / dev-vs-prod scenarios MUST use the explicit `apiKey` override. Documentation must show both paths (env-var default + constructor override).
- Reusing the same credential across products means a leaked `THEOKIT_API_KEY` exposes BOTH TheoKit AND TheMemory. Documented risk; mitigated by standard secret-rotation practices.
- If a future product in the TheoCloud surface (e.g., `@usetheo/observability`) also reuses `THEOKIT_API_KEY`, the credential becomes platform-wide. That is the locked design (`Cross-Project Rule 6 exception`).

**Reversibility:**

- Adding a separate `THEMEMORY_API_KEY` env var later (with separate taking precedence over `THEOKIT_API_KEY`) is backward-compatible.
- Removing the env-var fallback entirely (requiring `apiKey` constructor arg always) is breaking.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Separate `THEMEMORY_API_KEY` env var** (path b) | Rejected | Extra env var to manage. Breaks the TheoCloud consolidation pitch. No benefit at v0.5 (single-product surface today). |
| **API key required as constructor arg only** (no env fallback) | Rejected | Every TheoCloud consumer would re-implement the env-var read. Redundant boilerplate. |
| **Both env vars with `THEMEMORY_API_KEY` taking precedence** | Rejected for v0.0 / v0.5 | Over-engineered for a problem we don't have. Revisit when a real-world multi-account scenario surfaces (Phase IV+). Adding later is backward-compatible. |
| **OAuth / OIDC flow** | Deferred to v1.x | Heavier; needs identity provider integration. v0.5 ships with API-key auth (Mem0/Zep parity); OAuth lands when enterprise customers ask. |

## References

- `CLAUDE.md § Open questions Q6` (RESOLVED 2026-05-22 → this ADR).
- Root `CLAUDE.md § Cross-Project Rule 6` (exception authorizing the lock-in pattern).
- Roadmap Item 7 (`v0.5 — TheoCloud runtime + bi-temporal premium`) — destination for the cloud auth implementation.
- T2.5 `CloudMemoryConfig` shape (ships the `apiKey?: string` + `baseUrl?: string` fields).
- `@usetheo/sdk` documentation — confirms shared `THEOKIT_API_KEY` convention.

## Supersession history

- **2026-06-07** — § Alternatives row 4 ("OAuth / OIDC flow — Deferred to v1.x") is **SUPERSEDED** by [ADR-0013](./ADR-0013-oidc-bridge-via-introspection.md). The Camada 3 OIDC bridge via RFC 7662 dual-validation middleware lands in `@usetheo/memory/server` via the `theo-memory-faang-auth-lifecycle` cycle (Sub-goal 2 + Sub-goal 3 hardening per CLAUDE.md PRIORITY 0). The historical row remains in this ADR unchanged per `architecture.md` history-preservation rule (Inquebrável Rule 4 — git history is the audit trail; ADRs append, do not rewrite). Future cycles MUST cite ADR-0013 as the active OIDC contract; this row is preserved only for archaeological context (it documents the deferral that was honest in 2026-05-22 and is no longer honest in 2026-06-07 after the blueprint-Q4 empirical verification).
