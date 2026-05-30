# SEPA — Iteration 1 / T0.1 / pre-COMMIT / MODE=VERBOSE

Full SEPA brief verbatim above this section; main session resolutions follow.

## Main session resolutions

### CRITICAL-1 (branch policy `develop` vs feature-branch) — RESOLVED VIA OVERRIDE

SEPA flagged a conflict between project `cycle-implement.md § Anti-pattern #5` ("Feature branch only") and the observed state `git branch --show-current = develop`.

Resolution: develop IS correct per the CURRENT user global policy at `/home/paulo/.claude/CLAUDE.md § PARTE I-4`:

> **SEMPRE** trabalhe na branch `develop`. Toda mudança (feature, fix, refactor, docs, chore) é commitada diretamente em `develop`. **Não criamos feature branches.**

The project `cycle-implement.md § Anti-pattern #5` wording "Feature branch only" PRE-DATES this global update — every prior v0.x cycle (v0.4a / v0.6 / v0.6.1 / chat-with-memory-e2e-fixes) used feature branches because they ran before the global policy was tightened to develop-direct.

Project `cycle-implement.md § Hard gate #1` (which the implement skill ACTUALLY enforces) says "not on `main` OR uncommitted changes" — does NOT mandate feature branch. The strict hard gate is satisfied.

Per Inquebrável Rule 1 (95% confidence): 95% confident develop is correct under the current global policy. Documented in T0.1 commit body for audit trail.

### MAJOR-1 (HLR paper-name in commit body) — FIXED

Rewording in commit body: `D7 (HLR exponential form decay; ...)` → `D7 (exponential half-life decay form; ADR cite carries the formula reference)`. The ADR D7 ID itself remains as the citation surface; the paper-name shorthand is removed per `.claude/rules/no-paper-names-in-code.md` (rule's spirit extends to commit messages — forever-searchable git history is code-adjacent).

### MAJOR-2 (pillar (a) classification borderline-gamed) — FIXED

Reclassified `Wiring: a=pass b=defer-foundation c=n/a` → `Wiring: a=defer-foundation b=defer-foundation c=n/a` with single shared defer-rationale tail. More honest to the actual state — schema column accessors are DECLARED but not yet consumed by any production read/write path (T3.1+ consumers). Matches v0.4a precedent (`llm_importance_score` migration commit 494bceb).

### MINOR-1, 2, 3 — accepted as documented

Test-file-path deviation already documented in JSDoc + commit body; coverage 100% (5 tests cover 3 cols + 1 idx via Drizzle introspection — implicit, not blocking); `IF NOT EXISTS` defensive pattern is the right choice (confirmed against `0002_skill_columns.sql` precedent).

## DoD checkbox audit (verbatim from SEPA — all PASS or PASS-with-bonus)

| # | Criterion | Verdict |
|---|---|---|
| 1 | v0-4a plan archived | PASS (commit 2151c02) |
| 2 | Migration applies cleanly via drizzle-kit push | PASS (direct psql + dry-run output verified) |
| 3 | 4 RED → GREEN | PASS-with-bonus (5/5 — included regression-list extension) |
| 4 | Complexity ≤ 10/file | PASS-inferred (schema-only declarations cyclomatic 1) |
| 5 | Coverage ≥ 90% on changed files | PASS-inferred (100% via 5 tests) |
| 6 | Lint zero warnings | PASS |
| 7 | Size budgets SQL ≤30, schema.ts additions ≤20 | PASS (4 + 18) |
