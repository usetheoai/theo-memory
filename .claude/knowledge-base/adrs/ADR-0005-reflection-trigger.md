# ADR-0005: Reflection trigger — explicit-only in v0.0, policy interface declared

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D5
- **Owner:** TheMemory v0.0 contract design
- **Resolves:** CLAUDE.md § Open questions Q3

## Context

`reflect()` is a locked verb (ADR-0004). The mechanism that DECIDES when reflection runs is a separate question:

- (a) Background scheduler (cron/timer fires reflection periodically)
- (b) Explicit method call (consumer invokes `await memory.reflect()` when ready)
- (c) Threshold-based (auto when N new memories cross a configured threshold)
- (d) Sleep-time agent worker (Letta pattern — wakes during idle periods)

Letta uses (d) effectively. Generative Agents 2023 uses (c). Mem0 doesn't ship reflection at all (consolidation happens implicitly during writes). The choice shapes:

- v0.1 cost surface: surprise LLM cost if background reflection auto-fires
- v0.4a roadmap fit: Item 5 (`v0.4a — Reflection pipeline`) ships a sleep-time worker explicitly
- API contract stability: forward-compat is broken if v0.0 ships an "always-on default" that v0.4a then has to disable

## Decision

**v0.0 contract types `reflect()` as an explicit awaitable method.** Default `remember()` path NEVER triggers reflection automatically. Caller pays for reflection only when they call it.

**`ReflectionPolicy` DIP declared in v0.0** but only one implementation (`ManualReflectionPolicy`) ships:

```ts
export interface ReflectionTrigger {
  readonly kind: 'manual' | 'threshold' | 'sleep-time';
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ReflectionPolicy {
  shouldReflect(scope: Scope, trigger: ReflectionTrigger): Promise<boolean>;
  onReflectionStart?(scope: Scope, options: ReflectOptions): Promise<void>;
  onReflectionEnd?(scope: Scope, result: ReflectionResult | Error): Promise<void>;
}

export interface ManualReflectionPolicy extends ReflectionPolicy {
  readonly kind: 'manual';
}
```

`ManualReflectionPolicy.shouldReflect()` always returns `true` (caller decided already; the policy is a pass-through).

`ThresholdReflectionPolicy` and `SleepTimeReflectionPolicy` land at v0.4a (roadmap Item 5) behind the same DIP. Zero contract change required at v0.4a — only new implementations.

If a caller invokes `reflect()` without configuring a policy, throw `ReflectionNotConfigured` (defined in errors.ts, T2.4).

## Consequences

**Positive:**

- Zero-surprise pricing in v0.1: caller knows exactly when they pay for reflection (per their own call).
- v0.4a sleep-time worker is a drop-in implementation of the same DIP — no breaking change.
- Test isolation is trivial in v0.1: unit tests don't trigger reflection unless they call `reflect()`.
- Honest pricing: docs can show `remember()` cost vs `reflect()` cost separately.

**Negative:**

- v0.1 consumers must call `reflect()` themselves. Documentation MUST make the explicit-trigger model obvious (no surprise auto-consolidation).
- The `ReflectionPolicy` DIP exists with only one implementation at v0.0 — slight YAGNI risk per `architecture.md § 13.5 DIP`. Justified because variation is REAL (v0.4a adds two more impls per roadmap Item 5) and testability is REAL (`Memory` constructor accepts any policy).

**Reversibility:**

- Medium. Adding default-auto-reflect in v1.x is a BREAKING behavior change even if the type contract stays the same (consumers wouldn't expect surprise reflection costs).
- Dropping the DIP and inlining the manual path would be backward-compatible at v0.4a IF the v0.4a policies are wired through a different mechanism. But that would force a v0.4a refactor — keep the DIP.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Background scheduler by default** | Rejected | Surprise cost. v0.1 doesn't ship a scheduler in core; would require pulling in cron-like infra. |
| **Threshold-based by default** | Rejected | Couples write-path latency to reflection-trigger evaluation. Complicates reasoning about `remember()` cost. |
| **Drop `reflect()` from v0.0; add at v0.4a** | Rejected | Roadmap Item 1 acceptance criteria reference `reflect()` as one of four locked verbs (ADR-0004). Dropping it forces public-API rename downstream. |
| **`ReflectionPolicy` inlined as union of strings** (`'manual' \| 'threshold' \| 'sleep-time'`) | Rejected | Doesn't compose. Policies need lifecycle hooks (`onReflectionStart` / `onReflectionEnd`) and DI-friendly construction. A DIP is the right shape. |

## References

- `CLAUDE.md § Open questions Q3` (RESOLVED 2026-05-22 → this ADR).
- Roadmap Item 5 (`v0.4a — Reflection pipeline`) — destination for `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy`.
- ADR-0004 (`reflect` locked as a public verb).
- ADR-0008 (DIP method counts — `ReflectionPolicy` interface shape).
- `referencia/letta/letta/orm/` — Letta's sleep-time agent reference (no `t_valid` columns; sleep-time worker is the trigger mechanism).
