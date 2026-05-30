# ADR-0010: RepoScope — fourth Scope tier for skill memory

- **Status:** Accepted
- **Date:** 2026-05-30
- **Plan:** [`voyager-skill-library-plan.md`](../plans/voyager-skill-library-plan.md) (v0.6 introduction) + [`voyager-skill-library-fixes-v0-6-1-plan.md`](../plans/voyager-skill-library-fixes-v0-6-1-plan.md) § T5.1 (documentation absorption)
- **Owner:** TheMemory v0.6 voyager-skill-library
- **Supersedes:** ADR-0002 § Alternatives row "Four tiers (User / Session / Agent / Org) — Deferred"

## Context

[ADR-0002](./ADR-0002-three-tier-scope.md) locked the public API at three Scope tiers (`User` / `Session` / `Agent`) and explicitly deferred a fourth tier behind strategic review. The voyager-skill-library plan (v0.6) introduced `Memory.skills(repoId)` — a fourth entry-point whose lifetime is **per-repository** (typed under `RepoScope`), distinct from the existing three. Without a written ADR, the expansion looks like a silent override of ADR-0002.

The skill memory contract requires per-repo isolation:

- A skill written against `repo-payments` MUST NOT be recallable from `repo-checkout` even when both sit under the same user/session/agent tuple.
- The consolidation orchestrator must scope its Orient → Gather → Consolidate → Report phases to a single repo's skill cluster.
- `forget(skillId)` on `repo-A` MUST reject when `skillId` belongs to `repo-B` (v0.6.1 T4.1 EC-2 absorption).

`AgentScope` cannot carry this: agents are cross-user persona handles; binding a single `agentId` to "the repo this skill belongs to" overloads agent semantics. `SessionScope` is mid-lived; repos outlive sessions. `UserScope` is per-account; skills cross users on the same repo.

## Decision

`Scope` becomes a four-arm discriminated union:

```ts
export type RepoScope = { readonly kind: 'repo'; readonly repoId: string };
export type Scope = UserScope | SessionScope | AgentScope | RepoScope;
```

`Memory.skills(repoId)` returns a `ScopedSkillMemory` bound to `RepoScope{ kind: 'repo', repoId }`. At the store layer, `RepoScope.repoId` is mapped to the existing `agent_id` column (per the EC-4 absorption in `filtersFromScope`) so v0.1's schema needs no new column — the discriminator on the public side stays separate from the storage shape.

`RepoScope` is exposed ONLY through `Memory.skills(repoId)`; it does not appear on `Memory.remember / recall / forget / reflect` for non-skill content. This keeps the original 3-tier contract intact for the four public verbs and isolates the 4th tier inside the skill-specific entry-point.

## Consequences

**Positive:**

- Per-repo skill isolation is type-narrowed: `memory.skills('repo-A')` and `memory.skills('repo-B')` return distinct `ScopedSkillMemory` instances whose recall, consolidate, and forget operations never cross.
- Storage layer unchanged — `agent_id` column reused via `filtersFromScope` mapping per EC-4. No migration; no new index.
- The mapping is opaque to consumers: callers see the `RepoScope` discriminator on the public side; the column name on the store side is implementation detail (consistent with the public-vs-internal vocabulary split in ADR-0002).
- Forward-compatible with any future fifth tier: same discriminated-union pattern.

**Negative:**

- ADR-0002's "Three tiers" anchor in `public-copy.md` and CLAUDE.md needs the addition called out (this ADR + a row in CLAUDE.md § Architectural Decisions Locked).
- `filtersFromScope` now has a fourth arm; structural exhaustiveness checks must include `kind: 'repo'`.
- The `RepoScope → agent_id` column mapping is asymmetric (RepoScope carries `repoId`, AgentScope carries `agentId`); both land in the same column. Tooling that introspects the storage layer must remember the dual mapping.

**Reversibility:**

- HARD. Removing `RepoScope` would break `Memory.skills(...)`, the consolidate orchestrator's scope filter, and the v0.6.1 T4.1 cross-scope forget guard. All consumer code relies on the type-narrowing.
- Renaming `RepoScope` would touch every reference in `src/core/scope.ts`, `src/local/scoped-skill-memory.ts`, the consolidate orchestrator, and every test.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Reuse `AgentScope` for skills** (no new tier) | Rejected | Overloads agent semantics. An agent is a cross-user persona; a repo is a code-graph entity. Same `agentId` value would mean different things depending on whether the caller is `memory.agent(...)` or `memory.skills(...)`. Worse DX, worse mental model. |
| **Add a `repoId` field on every Scope variant** (no new tier) | Rejected | Skill semantics don't apply to user/session/agent operations; bolting `repoId` onto them muddies the discriminated-union pattern that powers type narrowing. Also leaks "skill thinking" into non-skill verbs. |
| **Drop the public `RepoScope` discriminator; only the store layer knows** | Rejected | Loses type narrowing on `Memory.skills('repo-A')` vs `Memory.skills('repo-B')`. The cross-scope forget guard becomes a runtime-only check instead of a type-and-runtime check. Information leak risk per T4.1 deep-dives § behavior matrix is harder to enforce statically. |
| **Five tiers: User / Session / Agent / Repo / Org** | Deferred | Same posture as ADR-0002 on "Org" — additive, no consumer asked for it day-0. RepoScope ships now because v0.6 needs it; Org can land later under the same discriminated-union shape. |

## References

- [ADR-0002](./ADR-0002-three-tier-scope.md) — Three-tier scope (the contract this ADR extends).
- `.claude/rules/architecture.md § 1 Three-tier scope (User / Session / Agent)` — gets a pointer to this ADR.
- `CLAUDE.md § Architectural Decisions Locked` — gets a row pointing to this ADR.
- `src/core/scope.ts` — `RepoScope` declaration + `Scope` union arm.
- `src/local/scoped-skill-memory.ts` — `LocalScopedSkillMemory` constructor maps `RepoScope.repoId → filters.agent_id` per EC-4.
- `.claude/knowledge-base/plans/voyager-skill-library-plan.md` — v0.6 introduction of `Memory.skills(repoId)`.
- `.claude/knowledge-base/plans/voyager-skill-library-fixes-v0-6-1-plan.md` § T5.1 — documentation absorption driving this ADR.
