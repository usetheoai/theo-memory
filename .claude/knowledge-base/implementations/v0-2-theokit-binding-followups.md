# Followups — v0-2-theokit-binding implementation

Items observed during the /implement halt-loop but DEFERRED to a future task/plan to avoid scope creep.

| # | Observed during | Description | Recommended owner |
|---|---|---|---|
| F1 | T2.3 SEPA pre-COMMIT | Extend `npm pack --dry-run --json` regression guard to assert POSITIVE inclusion of every declared `package.json#exports` entry. | ✅ ABSORBED into T4.5 (commit 3212e2e); 6/6 publish-readiness tests now pass (was 5). |
| F2 | T4.5 SEPA pre-COMMIT | T3.1 must verify probe path works against REAL embedder (not just stub) to back ADR D8 demo-vs-prod parity claim. | T3.1 acceptance criterion add |
| F3 | T4.5 SEPA pre-COMMIT | Warn-once flag on stubs is instance-scoped (not module-scoped) — safe across test files, but T3.1 should use per-test stub instantiation to avoid cross-test warning leakage. | T3.1 fixture design |
| F4 | T4.5 SEPA pre-COMMIT | DEFER-TO-PR-B for wiring pillar (a) MUST hold through T3.1 commit — T3.1 doesn't unblock (a); only the scaffolded TheoKit app does. | T3.1 wiring-summary discipline |
| F5 | T4.5 SEPA pre-COMMIT | EC-2 absorption depth: T3.1 should assert scaffolded boot returns a USABLE Memory instance (e.g., `recall("test", {userId:"x"})` returns `[]` cleanly), not just non-throwing. | T3.1 acceptance criterion add |
