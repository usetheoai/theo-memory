# ADR-0020 — Re-scope the v1.0 gate: drop the comparative-benchmark requirement (gate (a))

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** project owner (explicit directive, this session)
- **Supersedes:** the two-gate formulation of Roadmap Item 11 (gate (a) = independent v0.8 comparative benchmark)
- **Change protocol:** Item 11 is owner-gated; this ADR + the CHANGELOG entry + the CLAUDE.md/README reconciliation constitute the required record (per `cycle-rule-schema.md § Golden Rule Change Protocol`).

## Context

Roadmap Item 11 ("v1.0 / `production-ready`") was gated on TWO conditions:

- **(a)** `docs/benchmarks/v0.8.md` exists + ≥ 1 **independent / third-party** reproduction logged under `benchmarks/reproductions/`.
- **(b)** `/dogfood` returns `EVIDENCE_SUFFICIENT`.

Gate (b) is **CLOSED** (re-audited 2026-07-12: anchor S1 `running`, 49 evidence files, journey suite 0 reds). Gate (a) has never been satisfiable, and as of v0.35.0 it is no longer even *reconstructable-in-place*:

1. **The benchmark feature was deleted.** Commit `283fbc2` (2026-07-16, shipped in v0.35.0) removed the entire benchmark surface — `benchmarks/`, `docs/benchmarks/v0.8.md`, the `BenchmarkAdapter` DIP + all adapters, the fixtures, and the runner scripts (CHANGELOG `[0.35.0] § Removed`). The artifact gate (a) requires to *exist* is gone.
2. **The competitor cells were never built.** The v0.8 matrix was TheMemory-only; the competitor SDK wiring (`v0-9-vendor-client-impls`) was **ABANDONED 2026-06-07**.
3. **Gate (a) is not self-satisfiable.** `public-copy.md § 4` requires an independent third-party reproduction — by design, the project team cannot self-certify it. CLAUDE.md Item 11 itself anticipated the only agent-reachable exit: *"or an ADR re-scoping gate (a)"*.
4. **The product makes no comparative performance claim.** `public-copy.md § 4`'s "independent reproduction" requirement gates *comparative* claims ("faster than X"). The README deliberately frames its competitor table as **"not a performance benchmark"** (README) and makes no "faster than" claim anywhere. So the honesty rule that gate (a) enforced **does not apply to any copy the project actually ships.**

Holding v1.0 hostage to a comparative benchmark the project (a) deleted, (b) never finished the competitor side of, and (c) makes no public claim requiring — is gate-keeping theatre, not honesty.

## Decision

**Re-scope Item 11: gate (a) (the independent comparative v0.8 benchmark) is DROPPED. The v1.0 / `production-ready` gate is now `/dogfood` `EVIDENCE_SUFFICIENT` ALONE.**

Guardrails that remain in force (this ADR does NOT weaken them):

- **No comparative performance claim** ("faster than / beats / outperforms <competitor>") may appear in any public copy without satisfying `public-copy.md § 4` in full (reproducible artifact + independent third-party reproduction + inline link). Dropping the *gate* does not license the *claim*. If the project ever wants to make such a claim, it must rebuild a benchmark and obtain an external reproduction at that time.
- **v1.0 is not auto-declared by this ADR.** Flipping README Status `Pre-release → Production-ready` and bumping the package to `v1.0.0` remains a **separate, deliberate owner release action**. This ADR removes the *blocker*; it does not perform the *declaration*.
- The dogfood honesty gate (`dogfood-golden-rule.md`, gate (b)) is untouched and remains the sole standing bar.

## Alternatives considered

- **Keep gate (a) as-is (external third-party reproduction).** Rejected: the harness was deleted and the competitor side abandoned; the gate blocks v1.0 indefinitely for a claim the project does not make. Dishonest by omission — it signals a rigor the product neither performs nor advertises.
- **Reconstruct the harness + self-run a reproduction.** Rejected: a self-run reproduction is **not** independent (the gate's entire point), so it cannot close gate (a); it would re-introduce ~40 deleted files + competitor SDK deps (Rule 9 / YAGNI) purely to produce evidence for a claim we don't ship.
- **Reconstruct + solicit a genuine third-party reproduction.** Deferred, not rejected: this is the correct path *if and when* the project decides to make a public comparative claim. It is out of scope for reaching v1.0, which needs no such claim.

## Consequences

- **Positive:** the only standing v1.0 blocker is now gate (b), which is CLOSED — so the path to a v1.0 cut is unblocked, honestly, without fabricating self-certified benchmark evidence. The docs stop asserting a gate the code can no longer support.
- **Negative / risk:** the project ships v1.0 without a published comparative benchmark. Mitigation: the README already makes no comparative claim, so no public statement is weakened; the guardrail above keeps `public-copy.md § 4` in force for any future claim.
- **Follow-up (docs reconciliation, this PR):** CLAUDE.md Item 11 + § Feature Status + Inviolable Rule 3 wording, and the README "one last box" line, are corrected to reflect (i) the benchmark feature was removed in v0.35.0, and (ii) gate (a) is dropped per this ADR.
