# ADR-0014: OSS multi-user lifecycle parity (Camada 2 — Stripe-shape `theo_live_*` keys in `@usetheo/memory/server`)

- **Status:** Accepted
- **Date:** 2026-06-07
- **Plan:** [`theo-memory-faang-auth-lifecycle-plan.md`](../plans/theo-memory-faang-auth-lifecycle-plan.md) § ADR D2 + T0.2 + T1.2 + T2.1 + T2.2 + T2.2.1 + T2.3
- **Owner:** TheMemory `theo-memory-faang-auth-lifecycle` cycle (SDK sub-goal 2 hardening)
- **Sign-off:** Project owner authorization 2026-06-07 via `/auto-plan` → `/implement` chain

## Context

Before this cycle, `@usetheo/memory/server` (shipped 2026-06-03 via `theo-memory-standalone-p0`) authenticated REST requests via a SINGLE-secret env-var model — `THEMEMORY_API_KEY`. A self-hosted operator running multiple agents could NOT:

- Scope per-agent (single env var = global authorization).
- Rotate without downtime.
- Audit per-key usage.
- Revoke individual keys (only `unset THEMEMORY_API_KEY` for everyone).

Per blueprint Q3 — PostHog / Cal.com / Plausible ALL ship full OSS UI parity for API-key CRUD; Supabase is the documented anti-pattern (cloud-only PAT UI). The Cal.com pattern (`cal_live_*` shape identical to theo's `theo_live_*`) is the strongest reference.

The theo-cloud codebase had already shipped the Stripe-shape lifecycle (`cloud/internal/routes/api_keys.go:50-115`) for the multi-tenant SaaS path. The OSS server needed the SAME lifecycle, single-tenant variant.

## Decision

`@usetheo/memory/server` ships the full Stripe-shape lifecycle for `theo_live_*` keys when started with `themory server --auth=api-keys`:

1. **`theo_api_keys` table** (migration `0012_theo_api_keys.sql`) — single-tenant variant of the cloud schema:
   - `tenant_id` defaults to `'self'` constant (D6 — column retained for forward-compat with future multi-tenant flag).
   - `key_hash` SHA-256 single-pass per cloud ADR D4 (256-bit entropy makes bcrypt unnecessary).
   - `CHECK (id != rotated_from)` constraint forbids self-rotation cycles (EC-2 absorption).
   - Partial index `WHERE revoked_at IS NULL` for the hot SELECT path.

2. **`ApiKeyAuthVerifier`** (12th DIP impl) — `theo_live_` prefix + SHA-256 hash lookup + scope-isolated by `tenant_id = 'self'` + fire-and-forget `last_used_at` update.

3. **Admin REST endpoints** under `/v1/admin/keys/*` (5 handlers ported from cloud `api_keys.go`):
   - `POST /v1/admin/keys` — create with show-once secret + scope dedupe (EC-7)
   - `GET /v1/admin/keys/list` — LIMIT 100 cap (EC-1 from cloud)
   - `DELETE /v1/admin/keys/{id}` — soft-delete (D7 from cloud)
   - `POST /v1/admin/keys/{id}/rotate` — atomic 5-stmt tx with grace window
   - `GET /v1/admin/keys/{id}/lineage` — recursive CTE with UNION dedupe (EC-2)
   - D5 existence-leak invariant: 404 NOT_FOUND for "doesn't exist" + "different tenant" + "already revoked"

4. **`requireScope` middleware** — gates `/v1/admin/keys/*` to keys carrying `memory:admin` scope; bootstrap-token bypass via `timingSafeEqual` (D7).

5. **Bootstrap self-revoke (T2.2.1 — EC-3 absorption)** — `admin_config.bootstrap_consumed` flag flips to TRUE atomically with the first admin-key INSERT. Subsequent bootstrap-token uses return 401 `BOOTSTRAP_CONSUMED`. Single-use semantics close the silent-backdoor exploit (leaked bootstrap token persisting even after admin key revoke).

6. **`themory keys` CLI subcommand** (T2.3) — wraps the admin REST surface with `create/list/rotate/revoke` actions. Show-once UX matches dashboard EC-13 pattern (secret printed once + loud "NEVER be shown again" warning).

## Consequences

**Positive:**

- OSS production-grade multi-user lifecycle — closes the documented gap vs Cal.com / PostHog / Plausible.
- Zero divergence from cloud impl semantics — code ported verbatim, adapted Go→TS. Bug fixes propagate cleanly across repos.
- Bootstrap token cannot persist as silent backdoor after first admin key (EC-3 absorption).
- Show-once secret UX matches FAANG canonical (Stripe / GitHub / PostHog all use it).
- CLI subcommand makes admin operations scriptable for CI/CD.

**Negative:**

- New table + 4 new modules in `src/server/auth/` + `src/server/handlers/` + `src/agent-tools/`.
- Operators MUST set `THEMORY_ADMIN_BOOTSTRAP_TOKEN` env var on first install AND remember to unset post-first-key (mitigated by the EC-3 self-revoke — even if they forget, leaked bootstrap is dead on first use).
- Single-tenant `tenant_id = 'self'` is a baked-in constant; multi-tenant promotion requires a future ADR + new `TenantResolver` DIP.

**Reversibility:** rollback path is `themory server` without `--auth=api-keys` flag — server returns to the existing `BearerAuthVerifier` env-var path. The `theo_api_keys` table stays in the DB (no destructive migration needed); subsequent rollforward picks up existing rows.

## Alternatives considered

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Multi-tenant directly** (mirror cloud verbatim) | Rejected for v1.x | Premature; OSS use case is single-tenant per-deployment. Multi-tenant adds complexity for zero v1.x benefit; revisit at v2.x if/when self-host operators ask. |
| **Use a different ORM (Kysely, raw SQL) for schema** | Rejected | Existing theo-memory schema goes through Drizzle (per `src/local/migrations/0001..0011`). Cross-toolchain drift would violate KISS. |
| **Add lifecycle to `BearerAuthVerifier` directly** | Rejected | Violates SRP/ISP. `BearerAuthVerifier` purpose is env-var single-secret; new `ApiKeyAuthVerifier` keeps each verifier focused per ADR D11 of standalone-p0 + ISP rules in `architecture.md § 13.4`. |
| **Auto-generate first admin key at startup, log to stdout** | Rejected | Sensitive secret in logs = poor security hygiene. Env-bootstrap with self-revoke is the canonical FAANG pattern (Cal.com `CALENDSO_ENCRYPTION_KEY`, PostHog `POSTHOG_PERSONAL_API_KEY`). |
| **Use cloud-repo Go binary in OSS via Docker** | Rejected | Defeats the OSS-first positioning. The cloud + OSS code paths SHOULD share semantics but ship in the language of their host (Go for cloud, TS for OSS). |

## References

- Plan [`theo-memory-faang-auth-lifecycle-plan.md`](../plans/theo-memory-faang-auth-lifecycle-plan.md) § ADR D2 + Phase 0-2
- Blueprint [`theo-memory-faang-auth-lifecycle-blueprint.md`](../discoveries/blueprints/theo-memory-faang-auth-lifecycle-blueprint.md) § Q3 (OSS lifecycle CRUD tooling) + § Q1 (Stripe-shape verdict)
- Canonical Stripe-shape source: `/home/paulo/Projetos/usetheo/theo-cloud/theo/cloud/internal/routes/api_keys.go`
- Commits: `61fbec7` (T0.2 schema) + `2bbde27` (T1.2 ApiKeyAuthVerifier) + `f76eb16` (T2.1 admin REST) + `829fe73` (T2.2 scope verifier) + `1b6fe3f` + `21804db` (T2.2.1 bootstrap self-revoke) + `ce117c7` (T2.3 CLI)
- [Cal.com API keys reference](https://cal.com/blog/where-is-my-api-key-and-what-can-it-do) (`cal_live_*` shape)
- [Stripe API keys best practices](https://docs.stripe.com/keys-best-practices)
