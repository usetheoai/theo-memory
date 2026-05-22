# Plan: Discover-Plan-Confidence — Structural Quality Gate for Discovery Plans

> **Version 1.1** — Ship a new sibling skill `/discover-plan-confidence` that scores discovery plans produced by `/discover-plan` against an M2 deterministic rubric (4 corners populated, no fabricated `referencia/` citations, mandatory sections + question budget + method per question, spec smells). Mirror the proven `plan-confidence` + `discover-confidence` architecture (Python checkers, zero LLM cost, fail-closed hard caps via `discover-plan-golden-rule.md`). Insert as new phase 2.5 of `cycle-discover` between `/discover-edge-cases` and `/discover-execute` (cycle bumps v1.0 → v1.1).
>
> **Changelog v1.0 → v1.1 (2026-05-22):** Absorbed MUST FIX items from `/edge-case-plan` review (`.claude/knowledge-base/reviews/discover-plan-confidence-edge-cases-2026-05-22.md`):
> - **EC-1** — Added **D5** declaring single deferral marker convention `<!-- DEFER-CORNER: {corner} | {reason} -->`; harmonized T0.2/T1.1/T1.3 Deep Dives around the new convention; removed fragile `defer.*{corner}` regex.
> - **EC-2** — T1.3 Deep Dives now specifies that Fase A / Fase B columns are located by HEADER TEXT regex (`^Fase\s*[AB]\b`), not by column position; new RED test in T0.4 covers header with descriptive suffix.
> - **EC-3** — Corrected phase numbering in T3.1 from "1.5" to **"2.5"** to match D3 (after `/discover-edge-cases` which is phase 2); added cross-reference grep check to T4.1 to confirm no downstream SKILL.md needs renumbering.

## Goal

> "Enable `cycle-discover` to gate discovery plans structurally so that no `/discover-execute` invocation starts on a malformed plan, measured by `pytest .claude/skills/discover-plan-confidence/tests/` returning green AND `python3 .claude/skills/discover-plan-confidence/scripts/run_discover_plan_score.py .claude/skills/discover-plan/templates/discovery-plan-template.md` exiting 0 with `verdict in {SHIPPABLE, SHIPPABLE_WITH_CAVEATS}`."

## Context

The current `cycle-discover` chain (defined in `.claude/rules/cycle-discover.md`) is:

```
/discover-plan → /discover-edge-cases → /discover-execute → /discover-confidence → ...
```

`/discover-confidence` scores **blueprints** (output of `/discover-execute`). There is NO structural gate on the **discovery plan itself** — the artifact that drives `/discover-execute`. The only filter today is `/discover-edge-cases`, which is semantic + advisory (returns OK / NEEDS ADJUSTMENT but does not fail-close).

Risk: a malformed discovery plan (e.g., missing coverage corner, fabricated `referencia/` path, no question budget) produces a malformed blueprint → produces a malformed patterns skill → poisons `/to-plan` Step 0 downstream. The blast radius is large because `*-patterns` skills are first-class context for every future implementation plan.

Pattern is already proven: `/plan-confidence` gates `/to-plan` outputs; `/discover-confidence` gates `/discover-execute` outputs. Both follow the same shape (Python deterministic checkers + golden rule + thresholds.txt + rubric YAML + fixtures + pytest). Replicating for discovery plans is mechanical and the marginal cost is one new skill directory + one new rule pair + one cycle-rule update.

**Evidence:**
- `.claude/rules/cycle-discover.md § Chain` — current chain shows the gap explicitly (no gate between edge-cases and execute).
- `.claude/rules/cycle-discover.md § Hard gates` — only blueprint gates are inquebráveis; discovery-plan gates are absent.
- `.claude/skills/discover-plan/SKILL.md § Quality Rules` — lists 8 NON-NEGOTIABLE rules (question budget 5-10, method per Q, pre-validated citations, etc.) — today these are HONOR SYSTEM, not enforced.
- Conversation 2026-05-22: user agreed to P0 gate after gap analysis identified `discoveries/plans/` as un-gated. Recorded as "começar pequeno" recommendation.

## Objective

The list of specific, measurable sub-goals that, taken together, compose the **Goal** above:

- [ ] Skill `/discover-plan-confidence` exists at `.claude/skills/discover-plan-confidence/` with valid frontmatter (`user-invocable: true`, `allowed-tools: Read Glob Grep Bash Write`)
- [ ] Four deterministic Python checkers implemented (research_coverage, reference_citations, plan_completeness, spec_smells) + orchestrator `run_discover_plan_score.py`
- [ ] Rubric file `templates/rubric-discover-plan.md` defines 4 dimensions with weights summing to 1.0
- [ ] Golden rule `.claude/rules/discover-plan-golden-rule.md` enumerates hard caps (empty corner, fabricated citation, missing mandatory section, question budget violated, method-less question)
- [ ] Thresholds file `.claude/rules/discover-plan-thresholds.txt` defines verdict bands (90/70/50/0)
- [ ] `cycle-discover.md` chain diagram + phase contracts updated to insert `/discover-plan-confidence` between `/discover-edge-cases` and `/discover-execute` (cycle version v1.0 → v1.1)
- [ ] `token-budget.md` updated with new entry under `cycle-discover` skills (`<1k`, Python deterministic, $0 LLM cost)
- [ ] `pytest .claude/skills/discover-plan-confidence/tests/` returns green (unit tests for each checker + integration test for orchestrator)
- [ ] Self-application: running the new skill on `discover-plan/templates/discovery-plan-template.md` returns `verdict in {SHIPPABLE, SHIPPABLE_WITH_CAVEATS}` (the canonical template is the structural fixture — if it doesn't pass our own gate, the gate is mis-specified)

## ADRs

### D1 — Reuse the `plan-confidence` / `discover-confidence` architecture verbatim

**Decision:** New skill mirrors the sibling shape exactly — Python deterministic checkers (no LLM), YAML rubric embedded in a `.md` file, `_rubric_loader.py` helper, orchestrator pattern `run_*_score.py`, JSON output matching `score-report.schema.json` shape, fail-closed exit codes (0 SHIPPABLE/CAVEATS, 1 INVALID, 2 error, 3 NON_SHIPPABLE).

**Rationale:** Two siblings already in production prove the pattern works (`/plan-confidence` runs in `<1k` tokens, `/discover-confidence` same). Inquebrável Rule 9 ("Don't Reinvent the Wheel") — when a battle-tested pattern exists in-tree, replicate it rather than invent. Consistency reduces cognitive load for contributors who already know one sibling.

**Alternatives considered:**
1. **Refactor first: extract shared logic into `.claude/scripts/common/`** — rejected for v1.0 because (a) it would balloon the scope from "ship one new gate" to "refactor three siblings simultaneously"; (b) breaks the "duplicate-with-attribution" convention already established by `discover-confidence` (its docstrings say "Copy of plan-confidence/scripts/check_spec_smells.py"); (c) YAGNI — extraction is only valuable when a 4th sibling lands.
2. **Single mega-skill `/structural-confidence {artifact-type}`** — rejected because per-artifact rubrics diverge (plan vs blueprint vs discovery-plan have different mandatory sections); user-invocable slash command resolution is cleaner with one slug per artifact type.
3. **Hook-based gate (PreToolUse on Skill invocation of /discover-execute)** — rejected because hooks are blunt instruments (exit 2 = blocked, exit 0 = allowed); rubric-based skills give the user a structured JSON report + nuanced verdict bands.

**Consequences:**
- Three siblings now duplicate `_rubric_loader.py` + `check_spec_smells.py` + `check_reference_citations.py`. Extraction deferred to a future plan if a 4th gate (e.g., for implementation.md task lists) lands.
- Pattern is now self-evident: every future "structural quality gate for X" follows the same template.
- Honors `architecture.md`'s spirit of DIP (each checker is a pure function with input → report dict; orchestrator composes them) even though `architecture.md`'s `paths:` frontmatter scopes to `src/**/*.ts` and this work is in `.claude/skills/` Python tooling.

### D2 — Four dimensions, 0.25/0.25/0.30/0.20 weights, sum 1.0 (no renormalization)

**Decision:** Rubric YAML defines exactly 4 active dimensions in M2:

| Dimension | Detector | Failure action | Weight |
|---|---|---|---|
| `research_coverage` | check_research_coverage.py | hard_cap 49 (empty corner) | 0.25 |
| `reference_citations` | check_reference_citations.py | hard_cap 49 (fabricated) | 0.25 |
| `plan_completeness` | check_plan_completeness.py | hard_cap 70 (missing section, question budget violated, method-less Q, <2 ADRs) | 0.30 |
| `risco_estrutural` | check_spec_smells.py | penalty only (smells) | 0.20 |

Sum: 1.0. Composite: `final = 0.25·rc + 0.25·rcit + 0.30·pc + 0.20·re`. When hard cap fires: `final_score_after_caps = min(weighted_avg, smallest_active_cap)`.

**Rationale:** Mirrors `discover-confidence`'s 0.30/0.30/0.25/0.15 distribution but rebalances toward `plan_completeness` because discovery plans have MORE mandatory structural elements than blueprints (Coverage Matrix table, question budget, method per question, halt-loop checkpoints, time budget ADR). The plan-completeness check is the heaviest semantic load, so the weight reflects that.

**Alternatives considered:**
1. **Five dimensions** (split `plan_completeness` into `mandatory_sections` + `question_budget` + `method_per_question`) — rejected because the three sub-checks are checked by one Python file and emit one combined report; splitting the rubric without splitting the checker creates spurious complexity. The sub-report still surfaces each violation separately in `motivos`.
2. **0.30/0.30/0.25/0.15 (copy discover-confidence exactly)** — rejected because rcit weight 0.30 over-penalizes thin-plan-stage where citations are aspirational (Fase A targets, not yet read); plan-completeness deserves more weight than rcit at the planning stage.
3. **Equal weights (0.25 each)** — rejected because risco_estrutural smell penalties are advisory; equal weight overstates them.

**Consequences:**
- Weight rebalancing requires `rubric-discover-plan.md v2` if numbers change post-ship (not v1.x patches).
- `weight_normalization_factor` is 1.0 in M2 (all four dimensions active, no future M3+ dimension deferred).

### D3 — Insert as new phase 2.5, NOT replace `/discover-edge-cases`

**Decision:** `/discover-plan-confidence` runs AFTER `/discover-edge-cases` and BEFORE `/discover-execute`. Chain becomes:

```
/discover-plan → /discover-edge-cases → /discover-plan-confidence → /discover-execute → /discover-confidence → /discover-improve → [skill distillation tail]
```

The two gates are complementary: edge-cases is semantic + advisory (LLM reasoning over the plan, returns NEEDS ADJUSTMENT); plan-confidence is structural + fail-closed (Python deterministic, returns INVALID with hard cap audit). Both run.

**Rationale:** Same pattern as `cycle-plan` (where `/edge-case-plan` semantic + `/plan-confidence` structural both run). Removing the semantic gate would lose edge-case detection (cheaper than catching the same issue post-execute). Removing the structural gate is what this plan exists to fix.

**Alternatives considered:**
1. **Insert BEFORE `/discover-edge-cases`** — rejected because edge-cases can surface MUST FIX items that change the plan structure (e.g., adding a question to cover a missed corner); running structural gate first would re-run after edge-cases anyway.
2. **Run conditionally only when edge-cases returns OK** — rejected; gates MUST be independent (edge-cases is advisory; an `OK` verdict from a semantic check NEVER bypasses a fail-closed structural check).
3. **Merge edge-cases + structural into one skill** — rejected because they use different mechanisms (LLM vs Python) and different cost profiles (5-15k tokens vs <1k); merging would force the cheap structural gate to inherit the expensive semantic cost.

**Consequences:**
- `cycle-discover.md` version bumps v1.0 → v1.1 (per the cycle rule's own versioning policy: "Changes that ADD phases or hard gates are minor version bumps").
- Operator workflow gains one mandatory step (~5s latency, $0 cost).
- A plan that passes edge-cases but fails structural gate will block — this is the intended fail-closed behavior; user resolves by fixing structural issues before re-invoking the chain.

### D5 — Single deferral marker convention `<!-- DEFER-CORNER: {corner} | {reason} -->`

**Decision:** ALL checkers that need to recognize "this coverage corner is intentionally deferred" SHALL use exactly one marker syntax — an HTML comment of the form:

```
<!-- DEFER-CORNER: tests | reason text up to one short paragraph -->
```

Valid `{corner}` values: `tests`, `deps`, `tools`, `techniques`. The marker MAY appear in either the `## Coverage Matrix` row body OR inside any ADR body under `## ADRs`. The recognition regex is `<!--\s*DEFER-CORNER:\s*(tests|deps|tools|techniques)\b` (case-insensitive). Both `check_research_coverage` (T1.1) and `check_plan_completeness` (T1.3) share this single recognizer.

**Rationale:** EC-1 from `/edge-case-plan` review identified that v1.0 of this plan had TWO conflicting mechanisms — `check_research_coverage` looked for `<!-- DEFERRED: reason -->` in Coverage Matrix rows, while `check_plan_completeness` (sub-check question_budget) used regex `defer.*{corner}` over ADR body. A plan deferred via one mechanism would pass one checker and fail the other → false rejection. Single convention + single recognizer + single source of truth.

**Alternatives considered:**
1. **Free-form ADR text** — rejected because `defer.*{corner}` regex is both too loose (matches accidental uses of "defer" out of context) and too strict (users write "out of scope", "skipped", "N/A — see D2" without the literal word "defer").
2. **YAML frontmatter in the plan file** — rejected because discovery plans don't have frontmatter today; adding one for a single marker is YAGNI.
3. **Two markers (matrix-specific + ADR-specific)** — rejected because it reintroduces the v1.0 inconsistency under a different name.

**Consequences:**
- T0.2 / T1.1 / T1.3 Deep Dives reference D5 instead of inlining their own marker syntax. Future fourth checker (if any) inherits the convention for free.
- A plan that uses the legacy `<!-- DEFERRED: ... -->` marker will be flagged as missing the deferral signal — acceptable migration burden since no discovery plan exists yet in `discoveries/plans/`. Documented in the new skill's SKILL.md so authors learn the convention from the start.
- Same recognizer used by all checkers means the test fixture for one checker validates the marker for all.

### D4 — TDD discipline (RED tests first, fixtures + negative-path coverage)

**Decision:** Every checker ships with a paired pytest module written FIRST (RED phase), then implementation (GREEN), then refactor. Coverage: each checker has at least one happy-path test (good fixture) + at least one negative-path test (missing section / fabricated citation / etc.) + at least one edge-case test (DEFERRED marker, BLOCKED marker, placeholder text). Mirror `.claude/skills/discover-confidence/tests/conftest.py` structure (session-scoped fixtures, `sys.path.insert` for script imports).

**Rationale:** `.claude/rules/testing.md` § "Core rule — TDD + BDD são obrigatórios" + Inquebrável Rule 5 + Inquebrável Rule 7. The hard cap logic is the load-bearing piece of this skill — when the cap fails to fire in conditions that require it, downstream cycles consume a malformed plan. RED tests prove the cap fires before it is even possible to bypass.

**Alternatives considered:**
1. **GREEN-first implementation, tests after** — rejected; violates Inquebrável Rule 5 + project testing.md.
2. **Only integration tests against orchestrator** — rejected; per-checker unit tests are required because each checker is independently composable and stands as a candidate for reuse if a 4th sibling extracts to common/. Unit tests document each checker's contract.
3. **Skip negative-path tests, only happy-path** — rejected; per `testing.md` § "Anti-patterns" — "Only assert structure" is forbidden; for a fail-closed gate, asserting the failure path is the WHOLE point.

**Consequences:**
- Test count: ~5 tests per checker × 4 checkers + 5 orchestrator tests = ~25 pytest tests. Aligns with `discover-confidence` which has ~30 tests across the same surface.
- Self-application test (P5) is the ultimate integration test — proves the gate accepts a well-formed plan AND rejects a malformed one using REAL artifacts in the project.

## Dependency Graph

```
Phase 0 (scaffold + RED tests) ──▶ Phase 1 (checkers GREEN) ──▶ Phase 2 (orchestrator) ──▶ Phase 3 (SKILL.md + rubric + templates)
                                                                                                │
                                                                                                ▼
                                                                                       Phase 4 (cycle-discover.md + token-budget.md wiring)
                                                                                                │
                                                                                                ▼
                                                                                       Phase 5 (Integration Validation)
```

- **Phase 0** must complete first (RED tests in place before any implementation per TDD).
- **Phase 1** tasks (T1.1-T1.4: the four checkers) can run **in parallel** — each checker is independent, each has its own pytest module.
- **Phase 2** depends on Phase 1 (orchestrator imports all four checkers).
- **Phase 3** depends on Phase 2 (SKILL.md references the orchestrator + rubric).
- **Phase 4** depends on Phase 3 (cycle-discover.md update cites the now-existing SKILL.md).
- **Phase 5** is the gate; blocks PR merge until green.

---

## Phase 0: Scaffold skill directory + RED tests

**Objective:** Lay down directory structure, golden rule, thresholds file, fixtures, and RED tests for every checker before any implementation line is written.

### T0.1 — Create skill directory tree + golden rule + thresholds

#### Objective
Scaffold `.claude/skills/discover-plan-confidence/` with all subdirectories. Create `.claude/rules/discover-plan-golden-rule.md` (the inquebrável contract) and `.claude/rules/discover-plan-thresholds.txt` (verdict bands).

#### Evidence
- `.claude/skills/discover-confidence/` shows the expected structure (`scripts/`, `templates/`, `fixtures/`, `tests/`, `defaults/`).
- `.claude/rules/discover-blueprint-golden-rule.md` shows the golden rule pattern (Rule statement + What it requires + Rules that cannot be bent table + When this rule may change).
- `.claude/rules/discover-blueprint-thresholds.txt` shows the thresholds format (`band|score|sunset|adr-ref`).

#### Files to edit
```
.claude/skills/discover-plan-confidence/                      (NEW directory)
.claude/skills/discover-plan-confidence/scripts/__init__.py   (NEW — empty)
.claude/skills/discover-plan-confidence/tests/__init__.py     (NEW — empty)
.claude/skills/discover-plan-confidence/templates/            (NEW directory)
.claude/skills/discover-plan-confidence/fixtures/             (NEW directory)
.claude/skills/discover-plan-confidence/defaults/             (NEW directory)
.claude/rules/discover-plan-golden-rule.md                    (NEW — mirrors discover-blueprint-golden-rule.md, adapted for discovery plans)
.claude/rules/discover-plan-thresholds.txt                    (NEW — 90/70/50/0 bands with 2027-01-31 sunset)
```

#### Deep file dependency analysis
- The directory tree has no downstream code dependencies until Phase 1 starts.
- The golden rule is REFERENCED by the future SKILL.md (Phase 3) and the future cycle-discover.md update (Phase 4); it must exist before those tasks.
- The thresholds file is RESOLVED at runtime by `run_discover_plan_score.py` (Phase 2) — script falls back to a template if rule file is missing, but project rule wins when present.

#### Deep Dives
- **Golden rule structure** (mirrors `discover-blueprint-golden-rule.md`):
  - Section "The Rule" — enumerate inquebráveis: (1) empty coverage corner, (2) fabricated `referencia/` citation, (3) missing mandatory section, (4) question budget violated (< 5 or > 10 OR > 3 per corner OR 0 in a corner without ADR-deferral), (5) research question without method declared.
  - Section "What it requires" — verdict capping rules (49 for empty corner / fabricated; 70 for completeness / budget / method).
  - Section "Why this rule exists" — cite that discovery plans drive `/discover-execute` which produces blueprints which produce patterns skills which feed every future `/to-plan`.
  - Section "Rules that cannot be bent" — table with stable identifiers (`empty_corner_tests`, `empty_corner_deps`, `empty_corner_tools`, `empty_corner_techniques`, `fabricated_citation`, `mandatory_section_missing`, `no_adrs`, `question_budget_violated`, `method_missing`).
  - Section "When this rule may change" — ADR + root-level strategic review for soft-fail changes.
- **Thresholds file** — 4 lines: `SHIPPABLE|90|2027-01-31|YOUR_ADR_REF` ... `INVALID|0|2027-01-31|YOUR_ADR_REF`.

#### Tasks
1. Create directory structure via `mkdir -p` (run from project root).
2. Write `.claude/rules/discover-plan-golden-rule.md` adapting `discover-blueprint-golden-rule.md` content.
3. Write `.claude/rules/discover-plan-thresholds.txt` (4 lines).
4. Create empty `__init__.py` files for Python package recognition.

#### TDD
```
RED:     No tests at this task — pure scaffolding. (TDD applies at T0.2-T0.5 which write RED tests for the checkers.)
GREEN:   Directory tree + golden rule + thresholds files exist.
REFACTOR: None expected.
VERIFY:  ls .claude/skills/discover-plan-confidence/ && cat .claude/rules/discover-plan-golden-rule.md | head -20 && cat .claude/rules/discover-plan-thresholds.txt
```

#### Acceptance Criteria
- [ ] Directory `.claude/skills/discover-plan-confidence/` exists with `scripts/`, `tests/`, `templates/`, `fixtures/`, `defaults/` subdirectories
- [ ] `.claude/rules/discover-plan-golden-rule.md` exists, mirrors `discover-blueprint-golden-rule.md` structure, enumerates 5+ inquebrável caps with stable identifiers
- [ ] `.claude/rules/discover-plan-thresholds.txt` exists with 4 verdict-band lines
- [ ] Pass: file size — golden rule < 200 lines; thresholds.txt < 30 lines

#### DoD
- [ ] `ls .claude/skills/discover-plan-confidence/` shows all 5 subdirectories
- [ ] `head -3 .claude/rules/discover-plan-golden-rule.md` confirms frontmatter / title
- [ ] No production code yet — only scaffolding and contracts

---

### T0.2 — RED tests + fixtures for `check_research_coverage.py`

#### Objective
Write `tests/test_check_research_coverage.py` + create `fixtures/good-discover-plan.md` (positive fixture) and `fixtures/missing-corner-discover-plan.md` (negative fixture). Tests MUST fail because the implementation doesn't exist yet.

#### Evidence
- `.claude/skills/discover-confidence/tests/test_check_research_coverage.py` (read earlier) — canonical pattern: happy-path with `good_blueprint` fixture, negative-path with `tmp_path`-generated minimal docs, edge-case for DEFERRED markers.
- `.claude/skills/discover-confidence/fixtures/good-blueprint.md` — canonical fixture shape.
- `.claude/skills/discover-plan/templates/discovery-plan-template.md` — defines the shape of a discovery plan (the document the checker validates). The good fixture must satisfy the template's structural rules.

#### Files to edit
```
.claude/skills/discover-plan-confidence/tests/conftest.py                              (NEW — copy + adapt from discover-confidence/tests/conftest.py)
.claude/skills/discover-plan-confidence/tests/test_check_research_coverage.py          (NEW — RED tests)
.claude/skills/discover-plan-confidence/fixtures/good-discover-plan.md                 (NEW — minimal valid discovery plan, all 4 corners populated)
.claude/skills/discover-plan-confidence/fixtures/missing-corner-discover-plan.md       (NEW — negative fixture, one corner missing)
```

#### Deep file dependency analysis
- `conftest.py` registers fixtures (`good_discover_plan`, `missing_corner_discover_plan`, `synthetic_discover_plan` for tmp_path-based tests) — every test file imports them.
- `good-discover-plan.md` must satisfy the rules the checker enforces (4 corners populated with ≥1 question each in the Research Questions table, all citations point to existing `referencia/` paths). The fixture also serves P5 self-application — must be a real-world-shape plan.
- `missing-corner-discover-plan.md` is the negative fixture: omits Coverage Corner 1 ("Integration Tests") section AND has no questions mapped to `tests` in the Coverage Matrix — triggers `empty_corner_tests`.
- RED tests reference `check_research_coverage` from `scripts/` — import will fail with `ModuleNotFoundError` until T1.1 lands. The failed import IS the RED state.

#### Deep Dives
- **Checker contract**: input = `Path` to discovery plan .md; output = dict with keys `corners_populated` (int 0-4), `corners_total` (4), `empty_corners` (list of corner-name strings), `corners_status` (list of dicts per corner with `corner`/`present`/`populated`), `contributors`/`detractors` (top-3 prose strings).
- **What counts as a populated corner for a DISCOVERY PLAN** (different from blueprint):
  - Blueprint check (existing `discover-confidence`): looks for `## Coverage Corner N — {name}` section with ≥50 chars of content.
  - Discovery plan check (NEW): looks at the `## Coverage Matrix` table AND the `## Research Questions` table. Corner is populated if at least one row in either table maps to that corner. **Deferral marker per D5** — `<!-- DEFER-CORNER: {corner} | {reason} -->` appearing in EITHER the Coverage Matrix row OR any ADR body counts the corner as populated. Recognition regex (shared with T1.3 sub-check 2): `<!--\s*DEFER-CORNER:\s*(tests|deps|tools|techniques)\b` (case-insensitive).
- **Fixture skeleton** for `good-discover-plan.md`: Header (Slug/Owner/Created/Time budget) → Context → Objective → In-Scope/Out-of-Scope tables → ADRs (D1 + D2) → Research Questions table with 6 rows (Q1-tests, Q2-deps, Q3-tools, Q4-techniques, Q5-techniques, Q6-tests) → Coverage Matrix (4/4 corners covered) → Halt-loop Checkpoints → Acceptance Criteria → Global DoD. All `referencia/` citations point to paths that exist (verify with `ls referencia/mem0/`).
- **Edge case test — DEFER-CORNER marker (per D5)**: Coverage Matrix has one row `| Integration tests | (none) | <!-- DEFER-CORNER: tests | per D2, tests out of scope --> |` — MUST count as populated. Test name: `test_defer_corner_marker_counts_as_populated`.

#### Tasks
1. Copy `.claude/skills/discover-confidence/tests/conftest.py` to new location, replace `blueprint` references with `discover_plan` (fixture names + paths to `fixtures/good-discover-plan.md`).
2. Write `fixtures/good-discover-plan.md` (full discovery plan, ~150 lines, all 4 corners populated, all citations real).
3. Write `fixtures/missing-corner-discover-plan.md` (~100 lines, omits Coverage Corner 1 from both Questions table and Matrix).
4. Write `tests/test_check_research_coverage.py` with 5 tests: `test_good_plan_all_corners_populated`, `test_missing_corner_detected_in_matrix`, `test_deferred_marker_counts_as_populated`, `test_placeholder_text_not_populated`, `test_questions_table_missing_corner_detected`.
5. Run `cd .claude/skills/discover-plan-confidence && pytest tests/test_check_research_coverage.py` — MUST fail with `ModuleNotFoundError: No module named 'check_research_coverage'`.

#### TDD
```
RED:     test_good_plan_all_corners_populated() — asserts report["corners_populated"] == 4 on good fixture (MUST fail: module missing)
RED:     test_missing_corner_detected_in_matrix() — asserts "tests" in report["empty_corners"] on negative fixture (MUST fail: module missing)
RED:     test_defer_corner_marker_counts_as_populated() — DEFER-CORNER marker per D5 honored (MUST fail: module missing)
RED:     test_placeholder_text_not_populated() — TBD marker NOT populated (MUST fail: module missing)
RED:     test_questions_table_missing_corner_detected() — Questions table missing rows for a corner triggers empty_corners (MUST fail: module missing)
GREEN:   (deferred to T1.1)
REFACTOR: None expected.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_research_coverage.py -v 2>&1 | grep -E "(FAILED|ERROR|ModuleNotFoundError)"
```

#### Acceptance Criteria
- [ ] `conftest.py` exists, fixtures `good_discover_plan` and `missing_corner_discover_plan` resolve to files that EXIST on disk
- [ ] `fixtures/good-discover-plan.md` is a syntactically valid discovery plan (passes manual read against `discovery-plan-template.md` structure)
- [ ] `fixtures/missing-corner-discover-plan.md` is INVALID by design (missing Coverage Corner 1)
- [ ] All 5 RED tests fail with `ModuleNotFoundError` or equivalent (proves test is exercising production code that does NOT exist yet)
- [ ] Pass: size — each test file < 200 lines; fixtures < 250 lines

#### DoD
- [ ] `pytest tests/test_check_research_coverage.py -v` reports 5 failures with import-time errors
- [ ] Fixtures readable; their `referencia/` citations point to paths that actually exist
- [ ] No production code in `scripts/check_research_coverage.py` yet (file MUST NOT exist)

---

### T0.3 — RED tests + fixtures for `check_reference_citations.py`

#### Objective
Same TDD pattern as T0.2 for the reference-citation checker. Reuse the `good-discover-plan.md` fixture; add `fixtures/fabricated-citation-discover-plan.md` (negative).

#### Evidence
- `.claude/skills/discover-confidence/scripts/check_reference_citations.py` — reuse the algorithm verbatim (regex `referencia/[A-Za-z0-9_\-./]+`, project-root resolution via `.claude/`/`.git`, BLOCKED marker exemption).
- `.claude/skills/discover-confidence/tests/test_check_reference_citations.py` — canonical test shape (verified/fabricated/blocked counts, citation density).

#### Files to edit
```
.claude/skills/discover-plan-confidence/tests/test_check_reference_citations.py   (NEW)
.claude/skills/discover-plan-confidence/fixtures/fabricated-citation-discover-plan.md  (NEW — has one path that doesn't exist)
```

#### Deep file dependency analysis
- Checker algorithm is identical to `discover-confidence`'s — only the artifact type differs (discovery plan vs blueprint). Justifies code duplication per D1; the checker is a pure path-validity function.
- Fabricated fixture must have at least 2 citations: one verified (e.g., `referencia/mem0/README.md`) + one fabricated (e.g., `referencia/mem0/this-does-not-exist.md`). Asymmetry exercises the `fabricated > 0` cap trigger.
- BLOCKED-marker test asserts a `<!-- BLOCKED: ... -->` comment immediately following a fake path WITHIN 80 chars excludes it from the fabricated count.

#### Deep Dives
- **Checker contract** (same as sibling): input = Path; output = dict with `total`, `verified`, `fabricated`, `explicitly_blocked`, `fabricated_paths` (sample of up to 10), `citation_density_per_200w`.
- **Tests** (4): `test_good_plan_all_citations_verified`, `test_fabricated_citation_detected`, `test_blocked_marker_excludes_from_fabricated`, `test_citation_density_computed`.

#### Tasks
1. Write `fixtures/fabricated-citation-discover-plan.md` — minimal plan with 2 citations (one real, one fake).
2. Write `tests/test_check_reference_citations.py` — 4 RED tests.
3. Run pytest — confirm `ModuleNotFoundError: No module named 'check_reference_citations'`.

#### TDD
```
RED:     test_good_plan_all_citations_verified() — asserts report["fabricated"] == 0 on good fixture (MUST fail: module missing)
RED:     test_fabricated_citation_detected() — asserts report["fabricated"] == 1 on negative fixture (MUST fail)
RED:     test_blocked_marker_excludes_from_fabricated() — BLOCKED-marked fake path not counted (MUST fail)
RED:     test_citation_density_computed() — citation_density_per_200w returns positive float (MUST fail)
GREEN:   (deferred to T1.2)
REFACTOR: None expected.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_reference_citations.py -v 2>&1 | grep FAILED
```

#### Acceptance Criteria
- [ ] `fixtures/fabricated-citation-discover-plan.md` has exactly 1 fabricated citation + 1 verified citation (manually verifiable via `grep referencia/ fixture.md` + `ls`)
- [ ] All 4 RED tests fail with import error
- [ ] Pass: size — fixture < 50 lines, test file < 150 lines

#### DoD
- [ ] `pytest tests/test_check_reference_citations.py -v` shows 4 collection / import errors
- [ ] No `scripts/check_reference_citations.py` yet

---

### T0.4 — RED tests + fixtures for `check_plan_completeness.py`

#### Objective
Same TDD pattern for the plan-completeness checker (the heaviest checker — covers mandatory sections AND question budget AND method-per-question AND ADR count).

#### Evidence
- `.claude/skills/discover-confidence/scripts/check_blueprint_completeness.py` — shape to mirror (MANDATORY_SECTIONS list of regex patterns, ADR header detector). The discovery-plan version has DIFFERENT mandatory sections (Header w/ Slug, Context, Objective, In-Scope/Out-of-Scope, ADRs, Research Questions, Coverage Matrix, Halt-loop Checkpoints, Acceptance Criteria, Global Definition of Done).
- `.claude/skills/discover-plan/templates/discovery-plan-template.md` — defines the section list (10 sections).
- `.claude/skills/discover-plan/SKILL.md § Quality Rules` — question budget rules (5-10 total, max 3 per corner, min 1 per corner OR ADR-deferred).

#### Files to edit
```
.claude/skills/discover-plan-confidence/tests/test_check_plan_completeness.py   (NEW)
.claude/skills/discover-plan-confidence/fixtures/under-budget-discover-plan.md  (NEW — 4 questions only, triggers question_budget cap)
.claude/skills/discover-plan-confidence/fixtures/method-missing-discover-plan.md (NEW — 1 question with Fase A column empty)
.claude/skills/discover-plan-confidence/fixtures/no-adrs-discover-plan.md       (NEW — ADRs section header present but no D1/D2 entries)
```

#### Deep file dependency analysis
- Single checker bundles 4 sub-checks: mandatory_sections, question_budget, method_per_question, adr_count. Each sub-check emits its own contribution to the report's `missing_mandatory` / `budget_violations` / `methodless_questions` / `adr_count` keys.
- Each negative fixture isolates ONE failure mode for unambiguous test attribution.
- The hard-cap trigger logic (any sub-check fails → cap 70) lives in the orchestrator (T2.1), NOT here — this checker only reports facts.

#### Deep Dives
- **Mandatory sections** (regex list, all anchored as `^##\s+...`, with `re.IGNORECASE | re.MULTILINE`; hyphens and spaces are normalized via `[- ]` per EC-8):
  1. `^#\s+Discovery Plan:` (header)
  2. `^##\s+Context`
  3. `^##\s+Objective`
  4. `^##\s+In[- ]Scope` — matches `## In-Scope`, `## In Scope`, `## In-Scope / Out-of-Scope`, `## In Scope / Out of Scope`
  5. `^##\s+ADRs`
  6. `^##\s+Research Questions`
  7. `^##\s+Coverage Matrix`
  8. `^##\s+Halt[- ]loop Checkpoints` — matches `Halt-loop`, `Halt Loop`, `Halt-Loop`
  9. `^##\s+Acceptance Criteria`
  10. `^##\s+Global Definition of Done`
- **Question budget**: parse the `## Research Questions` markdown table; count rows where first col is `Q\d+` and `Corner` column is in {tests, deps, tools, techniques}. Total must be 5 ≤ N ≤ 10. Per-corner max 3. Per-corner min 1 OR a **DEFER-CORNER marker per D5** exists (recognition regex `<!--\s*DEFER-CORNER:\s*(tests|deps|tools|techniques)\b`, case-insensitive) in EITHER the Coverage Matrix body OR any ADR body. **NO fragile `defer.*{corner}` regex** — D5 mandates the explicit marker.
- **Method per question** (column identification per EC-2 — by HEADER TEXT, not by column position): locate the header row of the Research Questions table (first row matching `^\|.*Fase`); within that row, find the cell whose content matches `^\s*Fase\s*A\b` and the cell matching `^\s*Fase\s*B\b` (case-insensitive; descriptive suffix like `Fase A (broad — ast-grep map)` is OK). Remember each column's index. For each Q data row, extract those two cells by remembered index; assert Fase A is non-empty OR equals literal `SKIP` (text-shape exemption per `discover-plan/SKILL.md`) AND Fase B is non-empty. If the header row contains neither `Fase A` nor `Fase B` (user renamed columns), emit `methodless_questions: ["__header_not_found__"]` violation rather than silently assuming positions.
- **ADR count**: count headers matching `^###\s+D\d+\s*[—-]` inside the `## ADRs` section body. Discovery plans require ≥2 ADRs (D1 time-budget, D2 investigation depth) per the template.
- **Tests** (8): `test_good_plan_all_sections_present`, `test_missing_section_detected`, `test_question_count_below_min_detected`, `test_question_count_above_max_detected`, `test_per_corner_max_exceeded_detected`, `test_methodless_question_detected`, `test_skip_token_allowed_in_fase_a`, `test_adr_count_below_two_detected`.

#### Tasks
1. Write 3 new negative fixtures (`under-budget-discover-plan.md`, `method-missing-discover-plan.md`, `no-adrs-discover-plan.md`).
2. Write `tests/test_check_plan_completeness.py` with 8 RED tests.
3. Run pytest — confirm import errors.

#### TDD
```
RED:     test_good_plan_all_sections_present() — found == total_required on good fixture (MUST fail: module missing)
RED:     test_missing_section_detected() — Halt-loop Checkpoints removed → missing_mandatory includes it (MUST fail)
RED:     test_question_count_below_min_detected() — under-budget fixture (4 Qs) → budget_violations contains 'too_few' (MUST fail)
RED:     test_question_count_above_max_detected() — synthetic fixture (11 Qs) → budget_violations contains 'too_many' (MUST fail)
RED:     test_per_corner_max_exceeded_detected() — 4 questions all for 'tests' corner → budget_violations contains 'corner_overflow_tests' (MUST fail)
RED:     test_methodless_question_detected() — Fase A column empty for Q3 → methodless_questions has Q3 (MUST fail)
RED:     test_skip_token_allowed_in_fase_a() — Fase A == "SKIP" → NOT in methodless_questions (MUST fail)
RED:     test_adr_count_below_two_detected() — only D1 → adr_count == 1 (MUST fail)
GREEN:   (deferred to T1.3)
REFACTOR: None expected.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_plan_completeness.py -v 2>&1 | grep -E "(FAILED|ModuleNotFoundError)" | wc -l   # expect 8
```

#### Acceptance Criteria
- [ ] All 3 new fixtures exist and are syntactically valid markdown
- [ ] Each negative fixture isolates exactly ONE failure mode (no overlap — `under-budget` has full sections; `method-missing` has full budget; `no-adrs` has full budget + method)
- [ ] All 8 RED tests fail with import error
- [ ] Pass: size — test file < 350 lines, each fixture < 150 lines

#### DoD
- [ ] `pytest tests/test_check_plan_completeness.py -v` confirms 8 collection / import errors
- [ ] No `scripts/check_plan_completeness.py` yet

---

### T0.5 — RED tests for `check_spec_smells.py` (reuse sibling logic)

#### Objective
Spec-smell checker is byte-identical to `discover-confidence/scripts/check_spec_smells.py` (just reads a different rubric). Write RED tests that import the not-yet-existing module + tests for the rubric loading.

#### Evidence
- `.claude/skills/discover-confidence/scripts/check_spec_smells.py` — algorithm to clone (strip code fences + inline code → run dictionary/regex matchers from rubric YAML → return SmellReport with `total_hits` / `by_category` / `total_penalty`).
- `.claude/skills/discover-confidence/scripts/_rubric_loader.py` — YAML-in-markdown extractor (byte-identical clone).
- `.claude/skills/discover-confidence/tests/test_check_spec_smells.py` — canonical test pattern (synthetic doc with controlled smell density).

#### Files to edit
```
.claude/skills/discover-plan-confidence/tests/test_check_spec_smells.py   (NEW)
```

#### Deep file dependency analysis
- This checker has TWO module dependencies that will be created in T1.4: `check_spec_smells.py` + `_rubric_loader.py`. RED test imports both — both fail to import.
- The rubric path argument resolves to `templates/rubric-discover-plan.md` (created in T3.2). For T0.5's RED tests, use a tmp_path-created rubric.

#### Deep Dives
- **Test fixtures**: build synthetic discovery plans with controlled smells (e.g., `"This is fast and efficient"` → 2 subjective_adjectives + 1 vague_pronoun hits).
- **Edge case**: smells inside ```` ``` ```` fenced blocks must NOT be counted (algorithm strips code; the test asserts the strip works).
- **Tests** (5): `test_smell_detection_in_prose`, `test_smells_in_code_fence_ignored`, `test_loophole_phrase_detected`, `test_total_penalty_negative_when_hits`, `test_zero_hits_returns_zero_penalty`.

#### Tasks
1. Write `tests/test_check_spec_smells.py` with 5 RED tests.
2. Run pytest — confirm `ModuleNotFoundError`.

#### TDD
```
RED:     test_smell_detection_in_prose() — "fast and efficient" → 2 subjective_adjectives (MUST fail: module missing)
RED:     test_smells_in_code_fence_ignored() — code-fenced "fast efficient" → 0 hits (MUST fail)
RED:     test_loophole_phrase_detected() — "if possible" → loopholes++ (MUST fail)
RED:     test_total_penalty_negative_when_hits() — penalty < 0 when total_hits > 0 (MUST fail)
RED:     test_zero_hits_returns_zero_penalty() — clean text → penalty == 0 (MUST fail)
GREEN:   (deferred to T1.4)
REFACTOR: None expected.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_spec_smells.py -v 2>&1 | grep FAILED
```

#### Acceptance Criteria
- [ ] All 5 RED tests fail with import error
- [ ] No production code in `scripts/check_spec_smells.py` yet
- [ ] Pass: size — test file < 150 lines

#### DoD
- [ ] `pytest tests/test_check_spec_smells.py -v` shows 5 import errors

---

## Phase 1: GREEN — implement the four deterministic checkers

**Objective:** Implement each checker so its RED tests pass. Tasks T1.1-T1.4 can run **in parallel** (each is independent).

### T1.1 — Implement `check_research_coverage.py` (GREEN T0.2)

#### Objective
Make all 5 RED tests in `test_check_research_coverage.py` pass.

#### Evidence
- `.claude/skills/discover-confidence/scripts/check_research_coverage.py` — same shape, but inspects blueprint sections. Discovery-plan version inspects the Research Questions table + Coverage Matrix table.

#### Files to edit
```
.claude/skills/discover-plan-confidence/scripts/check_research_coverage.py   (NEW)
```

#### Deep file dependency analysis
- Pure function; only depends on `pathlib`, `re`, `typing`. No I/O beyond reading the plan file once.
- Called by orchestrator `run_discover_plan_score.py` (T2.1); the orchestrator reads the returned dict and applies hard caps.
- No downstream production code depends on this function.

#### Deep Dives
- **Parsing strategy**: extract the markdown table under `## Research Questions` (rows starting with `|`, second-or-later column matches `Q\d+`). Build `{corner: count}` dict. Cross-reference with the `## Coverage Matrix` table — each corner row has `Questions mapped` column; treat empty / `(none)` as zero. A corner is "populated" if EITHER (a) at least one Q in Research Questions table maps to it, OR (b) a **DEFER-CORNER marker per D5** for that corner exists in EITHER the Coverage Matrix row OR any ADR body (recognition regex `<!--\s*DEFER-CORNER:\s*(tests|deps|tools|techniques)\b`, case-insensitive — shared with T1.3 sub-check 2).
- **Edge case — table with malformed header**: if `## Research Questions` heading exists but no table follows, treat all corners as empty (caps fire).
- **Output dict**: `{corners_populated, corners_total: 4, corners_status: [...], empty_corners: [...], contributors: [...], detractors: [...]}`.

#### Tasks
1. Implement `check_research_coverage(plan_path: Path) -> dict[str, Any]`.
2. Parse markdown tables (lightweight regex; no full markdown parser to avoid deps).
3. Apply DEFER-CORNER marker exemption (per D5) — share recognizer with T1.3.
4. Build contributors/detractors lists (top-3 each).
5. Run pytest until all 5 tests green.

#### TDD
```
RED:     (5 tests from T0.2 currently failing)
GREEN:   Implement function; all 5 tests pass.
REFACTOR: Extract `_parse_questions_table` and `_parse_coverage_matrix` as helper functions if either exceeds ~30 lines.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_research_coverage.py -v   # expect 5 passed
```

#### Acceptance Criteria
- [ ] All 5 tests in `test_check_research_coverage.py` pass
- [ ] Function pure (no global state, no side effects beyond reading the input file once)
- [ ] Pass: complexity — function ≤ 10 cyclomatic complexity (verify with `radon cc scripts/check_research_coverage.py`)
- [ ] Pass: size — file < 150 lines (mirrors sibling's ~100 lines)

#### DoD
- [ ] `pytest tests/test_check_research_coverage.py -v` 5/5 passed
- [ ] Function signature matches what orchestrator (T2.1) will import: `from check_research_coverage import check_research_coverage`

---

### T1.2 — Implement `check_reference_citations.py` (GREEN T0.3)

#### Objective
Make all 4 RED tests in `test_check_reference_citations.py` pass.

#### Evidence
- `.claude/skills/discover-confidence/scripts/check_reference_citations.py` (algorithm verbatim — copy-with-attribution per D1).

#### Files to edit
```
.claude/skills/discover-plan-confidence/scripts/check_reference_citations.py   (NEW)
```

#### Deep file dependency analysis
- Identical to sibling. Same `CITATION_RE`, same `BLOCKED_MARKER_RE`, same project-root walk-up logic.
- No downstream code depends; only the orchestrator imports it.

#### Deep Dives
- **Implementation**: literal copy of `discover-confidence/scripts/check_reference_citations.py` with module docstring updated to reference discovery plans (not blueprints).
- **Why not import sibling**: per D1, duplicate-with-attribution. Future refactor to `.claude/scripts/common/` will consolidate three siblings simultaneously.

#### Tasks
1. Copy `discover-confidence/scripts/check_reference_citations.py` content.
2. Replace `blueprint` → `discover plan` in docstrings.
3. Update module-level docstring to reference the new skill.
4. Run pytest until all 4 tests green.

#### TDD
```
RED:     (4 tests from T0.3 currently failing)
GREEN:   Copy + adapt module; all 4 tests pass.
REFACTOR: None expected (sibling is mature).
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_reference_citations.py -v   # expect 4 passed
```

#### Acceptance Criteria
- [ ] All 4 tests pass
- [ ] Module docstring identifies this as the discovery-plan variant and acknowledges the sibling source
- [ ] Pass: complexity — function ≤ 10
- [ ] Pass: size — file < 120 lines

#### DoD
- [ ] `pytest tests/test_check_reference_citations.py -v` 4/4 passed
- [ ] `diff scripts/check_reference_citations.py ../discover-confidence/scripts/check_reference_citations.py` shows ONLY docstring deltas

---

### T1.3 — Implement `check_plan_completeness.py` (GREEN T0.4)

#### Objective
Make all 8 RED tests in `test_check_plan_completeness.py` pass.

#### Evidence
- `.claude/skills/discover-confidence/scripts/check_blueprint_completeness.py` — shape to mirror (MANDATORY_SECTIONS list, ADR header counter). New checker adds question-table parsing + question budget validation.

#### Files to edit
```
.claude/skills/discover-plan-confidence/scripts/check_plan_completeness.py   (NEW)
```

#### Deep file dependency analysis
- Heaviest checker — bundles 4 sub-checks under one function for orchestrator simplicity.
- Returns one combined report dict; orchestrator reads it once and decides which hard caps to fire based on which keys are populated (`missing_mandatory`, `budget_violations`, `methodless_questions`, `adr_count`).

#### Deep Dives
- **Function signature**: `check_plan_completeness(plan_path: Path) -> dict[str, Any]`.
- **Sub-check 1 — mandatory sections**: iterate `MANDATORY_SECTIONS = [(name, regex), ...]`; for each, `re.search(pattern, content, re.MULTILINE | re.IGNORECASE)` → present/missing.
- **Sub-check 2 — question budget**: parse `## Research Questions` table. Extract rows where col-1 matches `^Q\d+$`. Count total + per-corner. Validate `5 <= total <= 10` and `count[corner] <= 3` for each. For each corner with `count[corner] == 0`, search for a **DEFER-CORNER marker per D5** for that corner (recognition regex `<!--\s*DEFER-CORNER:\s*(tests|deps|tools|techniques)\b`, case-insensitive) in EITHER the Coverage Matrix body OR any ADR body. If marker NOT found, add `corner_uncovered_{corner}` to violations. **Recognizer is shared verbatim with T1.1's `check_research_coverage`** (extract to a module-level helper `_has_defer_corner_marker(content, corner)` callable from both).
- **Sub-check 3 — method per question (column identification per EC-2 — by HEADER TEXT, not by column position)**: find the header row of the Research Questions table (first row matching `^\|.*Fase`); within that row, identify the cell whose content matches `^\s*Fase\s*A\b` (case-insensitive; descriptive suffix like `Fase A (broad — ast-grep map)` is OK) and the cell matching `^\s*Fase\s*B\b`. Remember each column's index. For each Q data row, extract those two cells by remembered index; assert Fase A is non-empty OR equals literal `SKIP` (text-shape exemption per `discover-plan/SKILL.md`) AND Fase B is non-empty. If neither `Fase A` nor `Fase B` cell is found in the header row (user renamed columns), emit `methodless_questions: ["__header_not_found__"]` violation rather than silently assuming positions.
- **Sub-check 4 — ADR count**: re-use sibling's `ADR_HEADER_RE = re.compile(r"^###\s+D\d+\s*(?:—|-)", re.MULTILINE)` within the `## ADRs` section body.
- **Return shape**: `{total_required, found, present, missing_mandatory, budget_violations, methodless_questions, adr_count, contributors, detractors}`.

#### Tasks
1. Implement `check_plan_completeness(plan_path)`.
2. Implement four helper functions: `_check_mandatory_sections`, `_parse_question_table`, `_check_question_budget`, `_check_methods`, `_count_adrs`.
3. Combine results into single dict.
4. Build contributors (e.g., "10/10 mandatory sections present", "5 ADRs found") + detractors (top-3 violations).
5. Run pytest until all 8 tests green.

#### TDD
```
RED:     (8 tests from T0.4 currently failing)
GREEN:   Implement function + 4 helpers; all 8 tests pass.
REFACTOR: If function exceeds 100 lines, split helpers into private module-level functions.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_plan_completeness.py -v   # expect 8 passed
```

#### Acceptance Criteria
- [ ] All 8 tests pass
- [ ] Each sub-check has a separate helper function (single responsibility per SOLID-SRP)
- [ ] Output dict has all 9 documented keys (no surprise schema drift)
- [ ] Pass: complexity — main function ≤ 10; each helper ≤ 10
- [ ] Pass: size — file < 250 lines (largest checker; budget reflects its scope)

#### DoD
- [ ] `pytest tests/test_check_plan_completeness.py -v` 8/8 passed
- [ ] Output dict schema documented in module docstring

---

### T1.4 — Implement `check_spec_smells.py` + `_rubric_loader.py` (GREEN T0.5)

#### Objective
Make all 5 RED tests in `test_check_spec_smells.py` pass.

#### Evidence
- `.claude/skills/discover-confidence/scripts/check_spec_smells.py` — verbatim copy candidate.
- `.claude/skills/discover-confidence/scripts/_rubric_loader.py` — verbatim copy candidate.

#### Files to edit
```
.claude/skills/discover-plan-confidence/scripts/check_spec_smells.py   (NEW)
.claude/skills/discover-plan-confidence/scripts/_rubric_loader.py      (NEW)
```

#### Deep file dependency analysis
- `_rubric_loader.py` is depended on by `check_spec_smells.py` (sibling import via `sys.path.insert`) AND by `run_discover_plan_score.py` (T2.1).
- Both are byte-identical copies (no algorithmic divergence between siblings).

#### Deep Dives
- **Implementation**: literal copy of sibling files; update module docstrings to reference discovery plans.
- **Rubric path resolution**: caller (orchestrator) passes the rubric path explicitly; T2.1 will pass `templates/rubric-discover-plan.md` (created in T3.2).
- **Tests pass** because the YAML rubric structure is identical (same smell categories + same regex patterns).

#### Tasks
1. Copy `_rubric_loader.py` from sibling.
2. Copy `check_spec_smells.py` from sibling; update docstring.
3. Tests will fail until T3.2 creates `templates/rubric-discover-plan.md`; for T1.4, create a temporary minimal rubric in `tests/conftest.py` fixture (`rubric_path` fixture writes a minimal valid rubric YAML to tmp_path).
4. Run pytest until all 5 tests green.

#### TDD
```
RED:     (5 tests from T0.5 currently failing)
GREEN:   Copy modules; create temp rubric fixture; all 5 tests pass.
REFACTOR: None expected.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_check_spec_smells.py -v   # expect 5 passed
```

#### Acceptance Criteria
- [ ] All 5 tests pass
- [ ] `_rubric_loader.py` is byte-identical to sibling's (sanity-check via `diff`)
- [ ] `check_spec_smells.py` differs from sibling only in docstring
- [ ] Pass: complexity — `check_spec_smells` function ≤ 10
- [ ] Pass: size — `check_spec_smells.py` < 150 lines; `_rubric_loader.py` < 50 lines

#### DoD
- [ ] `pytest tests/test_check_spec_smells.py -v` 5/5 passed
- [ ] `diff scripts/_rubric_loader.py ../discover-confidence/scripts/_rubric_loader.py` returns empty (true byte-identical)

---

## Phase 2: Orchestrator + JSON schema

### T2.1 — Implement `run_discover_plan_score.py` orchestrator

#### Objective
Compose the four checkers, apply hard caps + soft caps per the golden rule, emit JSON matching `score-report.schema.json`. Exit codes: 0 (SHIPPABLE/CAVEATS), 1 (INVALID), 2 (error), 3 (NON_SHIPPABLE).

#### Evidence
- `.claude/skills/discover-confidence/scripts/run_blueprint_score.py` (read earlier) — canonical orchestrator shape. Discovery-plan orchestrator follows the same pattern with new hard-cap triggers.

#### Files to edit
```
.claude/skills/discover-plan-confidence/scripts/run_discover_plan_score.py   (NEW)
.claude/skills/discover-plan-confidence/tests/test_run_discover_plan_score.py (NEW — RED tests then GREEN)
```

#### Deep file dependency analysis
- Imports: `argparse`, `json`, `sys`, `datetime`, `pathlib` + the four checker modules + `_rubric_loader`.
- Depends on all four checkers (T1.1-T1.4) — Phase 2 starts only after Phase 1 green.
- Depends on `templates/rubric-discover-plan.md` (T3.2) and `templates/discover-plan-thresholds.example.txt` (T3.3) as fallback paths.
- Called by SKILL.md (T3.1) workflow step 2.

#### Deep Dives
- **Hard-cap logic** (per `discover-plan-golden-rule.md` from T0.1):
  - For each empty corner: `hard_caps_triggered.append(f"empty_corner_{corner}")`; cap = 49.
  - If `citations["fabricated"] > 0`: `hard_caps_triggered.append("fabricated_citation")`; cap = 49.
  - If `completeness["missing_mandatory"]`: `hard_caps_triggered.append("mandatory_section_missing")`; cap = 70.
  - If `completeness["adr_count"] < 2`: `hard_caps_triggered.append("insufficient_adrs")`; cap = 70.
  - If `completeness["budget_violations"]`: `hard_caps_triggered.append("question_budget_violated")`; cap = 70.
  - If `completeness["methodless_questions"]`: `hard_caps_triggered.append("method_missing")`; cap = 70.
- **Soft caps** (conservative bias, cap 89):
  - `smells.total_hits >= 20` → `soft_floor_smell_density_high`.
  - `citation_density < 1.0 per 200w` (and total > 0) → `soft_floor_citation_density_low`.
- **Composite formula**: per D2, `weighted = 0.25·rc + 0.25·rcit + 0.30·pc + 0.20·re`.
- **Final**: `min(weighted, smallest_active_cap)`.
- **Verdict**: lookup band from thresholds.txt by descending score.
- **Output**: JSON object matching `score-report.schema.json` (T2.2).

#### Tasks
1. Write `tests/test_run_discover_plan_score.py` — 6 RED tests:
   - `test_good_plan_returns_shippable`
   - `test_missing_corner_returns_invalid_with_empty_corner_cap`
   - `test_fabricated_citation_returns_invalid_with_cap`
   - `test_missing_section_returns_caveats_with_cap_70`
   - `test_under_budget_returns_caveats_with_question_budget_cap`
   - `test_exit_code_matches_verdict`
2. Implement `run_discover_plan_score.py` mirroring sibling structure.
3. Run pytest until all 6 tests green.

#### TDD
```
RED:     6 orchestrator tests — start failing because module doesn't exist.
GREEN:   Implement orchestrator (~200 lines, similar to sibling).
REFACTOR: Extract `_apply_hard_caps(coverage, citations, completeness)` helper if main exceeds 150 lines.
VERIFY:  cd .claude/skills/discover-plan-confidence && pytest tests/test_run_discover_plan_score.py -v   # 6 passed
         AND  python3 scripts/run_discover_plan_score.py fixtures/good-discover-plan.md   # exit 0, JSON valid
```

#### Acceptance Criteria
- [ ] All 6 orchestrator tests pass
- [ ] Manual run on good fixture exits 0, prints valid JSON with `verdict: "SHIPPABLE"` (or `SHIPPABLE_WITH_CAVEATS` if minor smells)
- [ ] Manual run on `missing-corner-discover-plan.md` exits 1, `verdict: "INVALID"`, `hard_caps_triggered` includes `empty_corner_tests`
- [ ] Manual run on `fabricated-citation-discover-plan.md` exits 1, `hard_caps_triggered` includes `fabricated_citation`
- [ ] JSON output validates against `score-report.schema.json` (T2.2) — verified via `python3 -c "import json, jsonschema; jsonschema.validate(json.load(open(report)), json.load(open(schema)))"`
- [ ] Pass: complexity — `main()` ≤ 15 (orchestrator slightly higher allowance per sibling); helpers ≤ 10
- [ ] Pass: size — file < 300 lines (mirrors sibling's ~260)

#### DoD
- [ ] All orchestrator tests green
- [ ] `python3 scripts/run_discover_plan_score.py --help` shows usage with `plan` positional + `--rubric` / `--thresholds` flags
- [ ] Exit codes verified: 0/1/2/3 documented in module docstring

---

### T2.2 — Author `templates/score-report.schema.json`

#### Objective
JSON schema documenting the orchestrator's output. Used by tests + future tooling.

#### Evidence
- `.claude/skills/discover-confidence/templates/score-report.schema.json` (read earlier) — pattern to mirror. Discovery-plan schema mostly identical with `blueprint_*` → `plan_*` renames + active_dimensions enum updated.

#### Files to edit
```
.claude/skills/discover-plan-confidence/templates/score-report.schema.json   (NEW)
```

#### Deep file dependency analysis
- Referenced by `test_run_discover_plan_score.py` (T2.1) for schema-validation tests.
- Documented by SKILL.md (T3.1) under "Output Format".

#### Deep Dives
- **Top-level keys**: `plan_slug`, `plan_path`, `plan_version`, `scored_at`, four `*_score` keys, `active_dimensions` (enum: research_coverage, reference_citations, plan_completeness, risco_estrutural), `weight_normalization_factor`, `weighted_avg`, `hard_caps_triggered`, `final_score_after_caps`, `verdict`, `calibration`, `motivos`, `sub_reports`.
- **$id**: `https://usetheo.dev/schemas/discover-plan-confidence-score-report.v1.json`.

#### Tasks
1. Copy sibling schema; rename `blueprint_*` → `plan_*`.
2. Update `active_dimensions` enum to the four discovery-plan dimensions.
3. Save.

#### TDD
```
RED:     test_run_discover_plan_score.py's schema-validation test currently fails (schema file missing).
GREEN:   Schema file exists, validation passes.
REFACTOR: None expected.
VERIFY:  python3 -c "import json; json.load(open('templates/score-report.schema.json'))"   # parses
```

#### Acceptance Criteria
- [ ] Schema file valid JSON
- [ ] `active_dimensions` enum lists the four NEW dimensions (NOT blueprint-flavored names)
- [ ] $id reflects discover-plan-confidence
- [ ] Pass: size — file < 100 lines

#### DoD
- [ ] `jq . templates/score-report.schema.json` parses without error
- [ ] Schema-validation test in T2.1's pytest module passes

---

## Phase 3: SKILL.md, rubric, defaults, templates

### T3.1 — Author `SKILL.md` (entry point)

#### Objective
Write `.claude/skills/discover-plan-confidence/SKILL.md` mirroring `discover-confidence/SKILL.md` structure (frontmatter → When to Trigger → Cycle contract → What this skill checks → Workflow → Hard Caps → Soft Caps → Verdict Bands → Output Format → Exit Codes → Related).

#### Evidence
- `.claude/skills/discover-confidence/SKILL.md` and `.claude/skills/plan-confidence/SKILL.md` — both canonical entry points. Adapt language for discovery plans.

#### Files to edit
```
.claude/skills/discover-plan-confidence/SKILL.md   (NEW)
```

#### Deep file dependency analysis
- Frontmatter `description` is consumed by `/to-plan` Step 0 frontmatter scan (when patterns skills accumulate). The description must include the trigger phrase "Use after `/discover-edge-cases`, before `/discover-execute`" for downstream discoverability.
- References `cycle-discover.md` (updated in T4.1) and `discover-plan-golden-rule.md` (created in T0.1).

#### Deep Dives
- **Frontmatter**:
  ```yaml
  ---
  name: discover-plan-confidence
  description: Score a discovery plan produced by /discover-plan for structural quality (M2 deterministic check). Sibling of /plan-confidence and /discover-confidence — verifies 4 coverage corners populated, no fabricated referencia/ citations, mandatory sections + question budget (5-10, max 3/corner) + method per question + ≥2 ADRs. Use after /discover-edge-cases, before /discover-execute.
  user-invocable: true
  allowed-tools: Read Glob Grep Bash Write
  argument-hint: "{discovery-plan-slug}"
  ---
  ```
- **Body sections**: copy structure verbatim from sibling, adapt content. Reference `discover-plan-golden-rule.md` for hard caps; reference `discover-plan-thresholds.txt` for verdict bands.

#### Tasks
1. Copy `.claude/skills/discover-confidence/SKILL.md` structure.
2. Replace `blueprint` → `discovery plan`; replace `/discover-execute` → `/discover-plan`; update cycle phase number to **2.5** (between edge-cases at phase 2 and execute at phase 3 — per D3 and EC-3 of edge-case review).
3. Update "What this skill checks" table with four new dimensions + weights from D2.
4. Update "Hard Caps" section to enumerate the six identifiers from T0.1's golden rule.
5. Update "Related" links.

#### TDD
```
RED:     N/A — markdown content; no Python test.
GREEN:   File exists with all mandatory sections (frontmatter, When to Trigger, Cycle contract, Workflow, Hard Caps, Verdict Bands, Output Format, Exit Codes, Related).
REFACTOR: None expected.
VERIFY:  head -10 .claude/skills/discover-plan-confidence/SKILL.md   # frontmatter valid
         grep -E "^## " .claude/skills/discover-plan-confidence/SKILL.md   # all expected sections present
```

#### Acceptance Criteria
- [ ] Frontmatter parses (valid YAML, `user-invocable: true`, `allowed-tools` includes Read Glob Grep Bash Write)
- [ ] Body has all sections: When to Trigger, Cycle contract, What this skill checks, Workflow, Hard Caps, Soft Caps, Verdict Bands, Output Format, Exit Codes, Related
- [ ] References `discover-plan-golden-rule.md` and `discover-plan-thresholds.txt` (verify with `grep`)
- [ ] Description includes "Use after `/discover-edge-cases`, before `/discover-execute`" for trigger discoverability
- [ ] Pass: size — < 200 lines (siblings range 120-150)

#### DoD
- [ ] `cat .claude/skills/discover-plan-confidence/SKILL.md | head -20` shows valid frontmatter
- [ ] All 10 mandatory section headers present
- [ ] Cross-references to golden rule + thresholds resolve to existing files

---

### T3.2 — Author `templates/rubric-discover-plan.md`

#### Objective
Define the rubric YAML (4 dimensions, weights from D2, smells dictionary cloned from sibling).

#### Evidence
- `.claude/skills/discover-confidence/templates/rubric-blueprint.md` (read earlier) — shape to mirror. Discovery-plan rubric updates: `artifact_type: discovery_plan`, weights 0.25/0.25/0.30/0.20, detector names match new checkers.

#### Files to edit
```
.claude/skills/discover-plan-confidence/templates/rubric-discover-plan.md   (NEW)
```

#### Deep file dependency analysis
- Read by `_rubric_loader.py` (T1.4) → consumed by `check_spec_smells.py` (T1.4) for smell category penalty weights.
- Read by `run_discover_plan_score.py` (T2.1) for composite weight resolution.

#### Deep Dives
- **YAML structure** (same shape as sibling):
  ```yaml
  version: 1
  created_at: 2026-05-22
  updated_at: 2026-05-22
  artifact_type: discovery_plan
  nodes:
    - id: 1
      dimension: research_coverage
      description: "All 4 coverage corners covered by ≥1 question (or ADR-deferred)"
      detector: research_coverage
      failure_action: hard_cap
      hard_cap_value: 49
      weight: 0.25
    - id: 2
      dimension: reference_citations
      description: "Every referencia/ path cited exists on disk"
      detector: reference_citations
      failure_action: hard_cap
      hard_cap_value: 49
      weight: 0.25
    - id: 3
      dimension: plan_completeness
      description: "Mandatory sections present, question budget 5-10 (max 3/corner), method per Q, ≥2 ADRs"
      detector: plan_completeness
      failure_action: hard_cap
      hard_cap_value: 70
      weight: 0.30
    - id: 4
      dimension: risco_estrutural
      description: "Spec smells below threshold"
      detector: spec_smells
      failure_action: penalty
      penalty_weights:
        subjective_adjectives: -2
        weak_imperatives: -3
        vague_pronouns: -2
        loopholes: -3
        non_verifiable: -4
      weight: 0.20
  smells:
    # ... (clone from rubric-blueprint.md verbatim)
  ```
- **Smells block**: byte-identical to sibling (same dictionary + same regex patterns; smells don't change between artifact types).

#### Tasks
1. Copy `rubric-blueprint.md` content.
2. Update YAML: `artifact_type`, weights, dimension names, detector names.
3. Update doc preamble + "How to Evolve" + "Limitations" sections to reference discover-plan-confidence.

#### TDD
```
RED:     T1.4's tests against this rubric currently fail (rubric path resolution missing) — depends on this file existing.
GREEN:   File exists; YAML parses via `python3 -c "import yaml; yaml.safe_load(open(...).read().split('```yaml')[1].split('```')[0])"`.
REFACTOR: None.
VERIFY:  python3 -c "from pathlib import Path; import sys; sys.path.insert(0, '.claude/skills/discover-plan-confidence/scripts'); from _rubric_loader import load_rubric; print(load_rubric(Path('.claude/skills/discover-plan-confidence/templates/rubric-discover-plan.md')))"
```

#### Acceptance Criteria
- [ ] YAML block parses; sum of weights == 1.0 (verified by helper or manual sum)
- [ ] `artifact_type == "discovery_plan"`
- [ ] Detector names match checker module names (research_coverage, reference_citations, plan_completeness, spec_smells)
- [ ] Smells block byte-identical to sibling (verify via `diff <(extract_yaml rubric-discover-plan.md) <(extract_yaml ../discover-confidence/templates/rubric-blueprint.md) | grep -v artifact_type`)
- [ ] Pass: size — < 200 lines

#### DoD
- [ ] `_rubric_loader.load_rubric()` returns dict with 4 nodes, sum of weights == 1.0
- [ ] `check_spec_smells` tests using this rubric path now pass

---

### T3.3 — Templates: golden-rule + thresholds example files

#### Objective
Author `templates/discover-plan-golden-rule.example.md` and `templates/discover-plan-thresholds.example.txt` (the in-skill copies for fallback if `.claude/rules/` is removed).

#### Evidence
- `.claude/skills/discover-confidence/templates/discover-blueprint-golden-rule.example.md` and `.../discover-blueprint-thresholds.example.txt` — pattern to mirror.

#### Files to edit
```
.claude/skills/discover-plan-confidence/templates/discover-plan-golden-rule.example.md   (NEW — copy of .claude/rules/discover-plan-golden-rule.md created in T0.1, with TEMPLATE caveat)
.claude/skills/discover-plan-confidence/templates/discover-plan-thresholds.example.txt   (NEW — copy of .claude/rules/discover-plan-thresholds.txt)
```

#### Deep file dependency analysis
- `run_discover_plan_score.py` (T2.1) falls back to these files when `.claude/rules/discover-plan-thresholds.txt` is missing.
- Documentation purpose only — operator-facing examples.

#### Deep Dives
- Add header at top: `# {filename} — TEMPLATE  ·  Copy this file to .claude/rules/{name} in your project.`
- Otherwise byte-identical to the rule file from T0.1.

#### Tasks
1. Copy `.claude/rules/discover-plan-golden-rule.md` → `templates/discover-plan-golden-rule.example.md`; prepend TEMPLATE notice.
2. Copy `.claude/rules/discover-plan-thresholds.txt` → `templates/discover-plan-thresholds.example.txt`; prepend TEMPLATE notice (mimic sibling's `# TEMPLATE` comment block at top).

#### TDD
```
RED:     N/A — template files.
GREEN:   Files exist.
REFACTOR: None.
VERIFY:  ls .claude/skills/discover-plan-confidence/templates/*.example.*
```

#### Acceptance Criteria
- [ ] Both template files exist with TEMPLATE notice prepended
- [ ] Otherwise content matches the live `.claude/rules/` versions
- [ ] Pass: size — each < 200 lines

#### DoD
- [ ] `ls .claude/skills/discover-plan-confidence/templates/` shows 4 files: `rubric-discover-plan.md`, `score-report.schema.json`, `discover-plan-golden-rule.example.md`, `discover-plan-thresholds.example.txt`

---

### T3.4 — Defaults dir (fallback when project rules removed)

#### Objective
Author `defaults/README.md` + `defaults/research-coverage.md` — minimal fallback docs explaining what the four corners mean. Used as inline reference if a user removes `.claude/rules/` entirely.

#### Evidence
- `.claude/skills/discover-confidence/defaults/` — pattern to mirror (README + research-coverage.md).

#### Files to edit
```
.claude/skills/discover-plan-confidence/defaults/README.md            (NEW)
.claude/skills/discover-plan-confidence/defaults/research-coverage.md (NEW)
```

#### Deep file dependency analysis
- Read by orchestrator (T2.1) as documentation references when running without project rules. Not load-bearing for scoring.

#### Deep Dives
- **README.md**: explain when these defaults apply (project rules dir empty/absent). Cross-reference golden rule + thresholds.
- **research-coverage.md**: describe the four corners (Integration Tests / Dependencies / Tools / Techniques) — same content as sibling, adapted for discovery plans.

#### Tasks
1. Copy sibling `defaults/README.md`; update title + cross-refs.
2. Copy sibling `defaults/research-coverage.md`; update for discovery-plan context.

#### TDD
```
RED:     N/A.
GREEN:   Files exist.
REFACTOR: None.
VERIFY:  cat .claude/skills/discover-plan-confidence/defaults/README.md | head -10
```

#### Acceptance Criteria
- [ ] Both files exist, less than 100 lines each
- [ ] README references golden rule + thresholds for canonical source

#### DoD
- [ ] `ls .claude/skills/discover-plan-confidence/defaults/` shows README.md + research-coverage.md

---

## Phase 4: Cycle wiring + token-budget update

### T4.1 — Update `cycle-discover.md`: insert new phase 2.5, bump v1.0 → v1.1

#### Objective
Modify `.claude/rules/cycle-discover.md` to insert `/discover-plan-confidence` between `/discover-edge-cases` and `/discover-execute`. Update Chain diagram + Phase contracts table + Hard gates list + Versioning section.

#### Evidence
- `.claude/rules/cycle-discover.md` (read earlier) — current chain explicitly absent of structural gate on discovery plans. Versioning policy: "Changes that ADD phases or hard gates are minor version bumps."

#### Files to edit
```
.claude/rules/cycle-discover.md   (UPDATED — chain diagram, phase contracts, hard gates, versioning bump v1.0 → v1.1)
```

#### Deep file dependency analysis
- This file is REFERENCED by every `/discover-*` SKILL.md as "source of truth for chain order". Updating here propagates the new chain to all consumers.
- Strategic review NOT required (ADD-only minor bump per file's own versioning policy).

#### Deep Dives
- **Chain diagram** update — insert one line between edge-cases and execute:
  ```
  /discover-plan {topic-slug}
    ↓ produces .claude/knowledge-base/discoveries/plans/{slug}-plan.md
  /discover-edge-cases {slug}
    ↓ incorporates MUST FIX entries; bumps plan version 1.0 → 1.1
  /discover-plan-confidence {slug}             ← NEW (v1.1)
    ↓ scores plan structurally (M2: research_coverage + reference_citations + plan_completeness + smells)
    ↓ hard caps audited (empty_corner_*, fabricated_citation, mandatory_section_missing, no_adrs, question_budget_violated, method_missing)
    ↓ if verdict < SHIPPABLE_WITH_CAVEATS: refuse to advance; user fixes plan; re-runs from /discover-edge-cases
  /discover-execute {slug}
    ↓ ...
  ```
- **Phase contracts table** — add one row:
  ```
  | `discover-plan-confidence` | `plans/{slug}-plan.md` | JSON score report + verdict | Hard caps audited; verdict ≥ SHIPPABLE_WITH_CAVEATS to advance |
  ```
- **Hard gates** — add: "`/discover-plan-confidence` verdict INVALID → discovery plan structurally defective. Cycle MUST loop back to `/discover-plan` to fix corner / citation / mandatory section / question budget / method violations."
- **Versioning section** — append entry: "v1.1 (2026-05-22): added `/discover-plan-confidence` phase between `/discover-edge-cases` and `/discover-execute`. ADD-only minor bump per this file's versioning policy."

#### Tasks
1. Read full `cycle-discover.md`.
2. Edit Chain section (insert new phase between edge-cases and execute).
3. Edit Phase contracts table (add row).
4. Edit Hard gates section (add INVALID gate for new skill).
5. Edit Versioning section (bump v1.0 → v1.1, log the addition).
6. Verify cross-references in other cycle rule files (cycle-plan.md, cycle-implement.md) — they don't enumerate cycle-discover's chain, so no edits expected.
7. **(EC-3 cross-reference audit)** Run `grep -rn 'phase [0-9]' .claude/skills/discover-*/SKILL.md` to confirm no downstream skill renumbering is needed. Inserting at phase **2.5** preserves the existing integer numbering of phases 3-5 (execute / confidence / improve). If any downstream SKILL.md cites phase 3/4/5, document the fact that the integer is preserved (no edit needed); if any cites phase 2 expecting it to be edge-cases, no change either. Only renumber if explicit conflicts surface — record the audit output verbatim in the commit message.

#### TDD
```
RED:     N/A — rule file edit (no Python tests).
GREEN:   File updated; cross-references intact; markdown valid.
REFACTOR: None.
VERIFY:  grep -E "discover-plan-confidence" .claude/rules/cycle-discover.md | wc -l   # ≥ 4 mentions
         grep "v1.1" .claude/rules/cycle-discover.md   # versioning bump recorded
         grep -rn 'phase [0-9]' .claude/skills/discover-*/SKILL.md   # audit; no edits expected after 2.5 insertion
```

#### Acceptance Criteria
- [ ] Chain diagram shows new phase explicitly
- [ ] Phase contracts table has new row
- [ ] Hard gates section enumerates new INVALID gate
- [ ] Versioning section recorded v1.0 → v1.1 with reason
- [ ] No existing content removed (additive change only)
- [ ] Pass: size — file < 350 lines after edit (was ~290; adding ~30 lines is safe)

#### DoD
- [ ] `grep -c discover-plan-confidence .claude/rules/cycle-discover.md` returns ≥ 4
- [ ] `grep -E '^## Versioning' -A 5 .claude/rules/cycle-discover.md` shows v1.1 entry

---

### T4.2 — Update `token-budget.md` with new gate

#### Objective
Add entry under `cycle-discover` skills table for the new gate (`<1k` tokens, Python deterministic, $0 LLM cost).

#### Evidence
- `.claude/rules/token-budget.md` (read earlier) — existing `cycle-discover` skills table lists `/discover-confidence` at `<1k`. New row added below it.

#### Files to edit
```
.claude/rules/token-budget.md   (UPDATED — add new row, recalculate full-chain range)
```

#### Deep file dependency analysis
- This file is REFERENCED by humans deciding when to invoke a cycle. No automated consumer.

#### Deep Dives
- **New row**: `| /discover-plan-confidence | <1k | Deterministic Python; ~0 LLM tokens (sibling of /discover-confidence + /plan-confidence) |`
- **Full chain recalculation**: adding a `<1k` gate to the chain shifts upper bound by negligible amount; the existing "80-200k" range absorbs it (note in commit message that the range is unchanged because <1k is within noise).

#### Tasks
1. Read `.claude/rules/token-budget.md`.
2. Edit `cycle-discover` skills table — add new row in alphabetic position after `/discover-plan`.
3. Update "Full chain" estimate note (still 80-200k; just note "+<1k for new gate, no material change").

#### TDD
```
RED:     N/A.
GREEN:   Row added; grep confirms.
REFACTOR: None.
VERIFY:  grep "discover-plan-confidence" .claude/rules/token-budget.md
```

#### Acceptance Criteria
- [ ] New row present in `cycle-discover` skills table
- [ ] Cost listed as `<1k`
- [ ] Annotated as deterministic Python
- [ ] Pass: size — file < 300 lines (was ~220; +1 row trivial)

#### DoD
- [ ] `grep -c discover-plan-confidence .claude/rules/token-budget.md` returns 1
- [ ] Full-chain estimate range note updated (or explicitly marked as unchanged with reason)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `discoveries/plans/{slug}-plan.md` has no structural quality gate today | T0.1, T1.1-T1.4, T2.1, T3.1 | New skill `/discover-plan-confidence` scores discovery plans deterministically; hard caps fail-close per golden rule |
| 2 | Pattern must mirror existing siblings for consistency | D1, T1.2, T1.4, T2.1, T3.1 | Architecture cloned verbatim from `/discover-confidence` + `/plan-confidence` (Python checkers, YAML rubric, golden rule, thresholds, JSON output schema) |
| 3 | Hard caps must be fail-closed (inquebrável) | T0.1, T2.1 | Golden rule `discover-plan-golden-rule.md` enumerates 6 caps with stable identifiers; orchestrator applies `min(weighted, smallest_active_cap)` |
| 4 | Cycle-discover.md must wire the new phase explicitly | T4.1 | Chain diagram updated; phase contracts table extended; hard gates section adds INVALID trigger; version bumps v1.0 → v1.1 |
| 5 | Token-budget.md must include the new gate | T4.2 | New row added under `cycle-discover` skills table |
| 6 | TDD discipline (RED tests before implementation) | T0.2-T0.5, T1.1-T1.4, T2.1 | Every checker has dedicated test file written FIRST (RED) before implementation (GREEN); fixtures cover happy-path + each negative-path |
| 7 | Self-application: gate validates the discover-plan template itself | T5.1 | Final phase runs `run_discover_plan_score.py` against `discover-plan/templates/discovery-plan-template.md`; verdict MUST be ≥ SHIPPABLE_WITH_CAVEATS (if not, the gate is mis-specified and blocks merge) |
| 8 | Schema documents output for future tooling | T2.2 | `score-report.schema.json` matches sibling shape with discovery-plan-specific dimension names |
| 9 | Defaults dir provides inline fallback when rules removed | T3.4 | `defaults/README.md` + `defaults/research-coverage.md` mirror sibling structure |
| 10 | Soft caps for conservative bias (smell density, citation density) | T2.1 | Orchestrator applies `soft_floor_smell_density_high` (>20 hits) + `soft_floor_citation_density_low` (<1 per 200w) caps at 89 |
| 11 | Edge-case review 2026-05-22 identified 3 MUST FIX (EC-1 deferral marker inconsistency, EC-2 table parsing strategy unspecified, EC-3 phase numbering wrong) | D5 (NEW), T0.2 / T1.1 / T1.3 Deep Dives, T3.1 / T4.1 Tasks | v1.0 → v1.1 absorbed all 3 MUST FIX as cirurgical edits — single DEFER-CORNER marker convention, header-text parsing for Fase A/B columns, phase 2.5 numbering with cross-reference audit |

**Coverage: 11/11 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (T0.1-T0.5, T1.1-T1.4, T2.1-T2.2, T3.1-T3.4, T4.1-T4.2, T5.1)
- [ ] All tests passing — `cd .claude/skills/discover-plan-confidence && pytest tests/` returns 0 failures (target: ~30 tests across 5 test files)
- [ ] Manual smoke test — `python3 scripts/run_discover_plan_score.py fixtures/good-discover-plan.md` exits 0 with `verdict in {SHIPPABLE, SHIPPABLE_WITH_CAVEATS}` and valid JSON
- [ ] Self-application — `python3 scripts/run_discover_plan_score.py .claude/skills/discover-plan/templates/discovery-plan-template.md` exits 0 with valid verdict (the canonical template self-validates)
- [ ] Negative-fixture confirmations: missing-corner / fabricated-citation fixtures exit 1 with `verdict == INVALID` and correct `hard_caps_triggered`
- [ ] `cycle-discover.md` references new skill in Chain + Phase contracts + Hard gates + Versioning sections (≥ 4 grep hits for `discover-plan-confidence`)
- [ ] `token-budget.md` lists new gate at `<1k`
- [ ] Golden rule + thresholds files exist at `.claude/rules/`
- [ ] No file in this plan exceeds the size budgets declared per task (sanity check via `wc -l`)
- [ ] All new Python files have type hints (`from __future__ import annotations`; full annotations on public functions); validated by `python3 -c "import ast; [ast.parse(open(f).read()) for f in glob.glob('scripts/*.py')]"` (syntax) — strict mypy not required (no project mypy config exists)
- [ ] No emojis added to any file (per Inquebrável Rule "No emojis")
- [ ] CHANGELOG.md updated under `[Unreleased]` — **SKIPPED for this plan**: `CHANGELOG.md` does not yet exist in the repo (verified via `ls CHANGELOG.md` returns no such file). Per `to-plan/templates/plan-template.md § Global DoD`, the entry is required "once the file exists in the repo"; deferred until then.
- [ ] **Runtime-metric proof** — N/A for this plan (no runtime counters introduced; this is a Python tooling skill, not src/ application code with metrics).
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move `.claude/knowledge-base/plans/discover-plan-confidence-plan.md` to `.claude/knowledge-base/plans/completed/discover-plan-confidence-plan.md` per `audit-trail-rotation.md` § ROTATE policy.

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all implementation phases (T0.1-T4.2) complete. The plan is NOT done until the validation chain passes.

**Objective:** Validate that the new skill works end-to-end against REAL artifacts in the project — not just synthetic fixtures.

### T5.1 — Self-application + sibling no-breakage smoke test

#### Objective
Run the new skill against (a) the canonical discovery-plan template itself, (b) every existing artifact in `.claude/knowledge-base/discoveries/plans/`, and (c) verify the existing sibling skills `/plan-confidence` + `/discover-confidence` still work unchanged.

#### Files to edit
```
None (validation only).
```

#### TDD
```
RED:     N/A — Phase 5 is the validation gate, not a bug-fix task. No production code written here; all RED/GREEN cycles live in T0.2–T2.1.
GREEN:   N/A
REFACTOR: N/A
VERIFY:  See Execution section below — the full validation chain serves as the integration test.
```

### Execution

Run the full validation chain (adapted for Python tooling — project has no npm setup yet per CLAUDE.md's pre-code phase):

```bash
# 1. Full test suite for new skill
cd .claude/skills/discover-plan-confidence && pytest tests/ -v

# 2. Self-application — gate validates its own input template
python3 .claude/skills/discover-plan-confidence/scripts/run_discover_plan_score.py \
  .claude/skills/discover-plan/templates/discovery-plan-template.md

# 3. Existing discovery plans (if any) — verify they pass or get honest verdicts
for plan in .claude/knowledge-base/discoveries/plans/*-plan.md 2>/dev/null; do
  [ -f "$plan" ] && python3 .claude/skills/discover-plan-confidence/scripts/run_discover_plan_score.py "$plan"
done   # currently zero files; loop is no-op — confirms no regression on absent artifacts

# 4. Sibling non-regression — re-run existing skills' test suites
cd .claude/skills/plan-confidence && pytest tests/ -v
cd .claude/skills/discover-confidence && pytest tests/ -v

# 5. Cross-reference integrity — every link in updated cycle-discover.md resolves
python3 .claude/scripts/check_xrefs.py .claude/rules/cycle-discover.md   # if script supports it
```

### Acceptance Criteria

- [ ] New skill's `pytest tests/` 100% green (~30 tests)
- [ ] Self-application of new gate against `discovery-plan-template.md` returns `verdict in {SHIPPABLE, SHIPPABLE_WITH_CAVEATS}` (if INVALID, the gate is mis-specified — blocker)
- [ ] Existing `/plan-confidence` and `/discover-confidence` test suites still green (no regression from copied modules)
- [ ] `cycle-discover.md` cross-references resolve (golden rule + thresholds + skill SKILL.md all exist where referenced)
- [ ] Manual review of orchestrator's JSON output on good fixture confirms motivos contributors/detractors are meaningful (not empty strings)
- [ ] Coverage Matrix in this plan remains 100% mapped (this is the self-check on the plan itself)
- [ ] `/plan-confidence discover-plan-confidence-plan` returns `verdict ≥ SHIPPABLE_WITH_CAVEATS` (meta-recursion: the plan that creates the gate is itself gated by the existing plan-confidence gate)
- [ ] Runtime-metric proof — N/A (no runtime counters in this plan)

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing — if sibling skills' tests break, T1.2 or T1.4's "copy-with-attribution" diverged from sibling source; revert + re-copy.
2. Fix all plan-caused failures before declaring the plan complete.
3. Re-run the validation chain to confirm fixes.
4. If self-application fails (gate rejects its own template), the gate is over-strict OR the template is under-spec'd — debug the discrepancy (it's load-bearing — template is the contract the gate enforces; both must agree).
5. Pre-existing issues are logged but do NOT block plan completion (document them in the PR description).
