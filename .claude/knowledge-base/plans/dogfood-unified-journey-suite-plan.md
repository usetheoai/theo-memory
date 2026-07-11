---
slug: dogfood-unified-journey-suite
created_at: 2026-07-11
goal: Replace the evidence-only /dogfood gate with a unified journey-suite that drives every user journey across SDK+API+MCP+UI as a human and gates EVIDENCE_SUFFICIENT on all journeys green.
---

# Plan: Unified /dogfood journey-suite (Claude-as-human across SDK · API · MCP · UI)

> **Version 1.2** — (v1.1 absorbed the `/edge-case-plan` MUST-FIX items EC-1/EC-2/EC-3 into T0.1 + T1.1. v1.2 fixes a plan-oracle-vs-reality defect found by the `/implement` halt-loop's first run — see `knowledge-base/implementations/dogfood-unified-journey-suite-BLOCKED-2026-07-11.md`: the T0.1/T4.1 GREEN gate was "protocol scripts green", but `check_xrefs.py`/`test_e2e_smoke.py` were ALREADY FAIL at HEAD from pre-existing repo-wide debt unrelated to /dogfood. v1.2 rescopes those oracles to a **delta**: "adds zero new [FAIL] referencing the touched files".) Rewrite the `/dogfood` skill and its LOCKED golden rule into ONE unified journey-suite. Today `/dogfood` only *evaluates* recorded evidence (a manifest + evidence files) and emits `EVIDENCE_SUFFICIENT / WITH_CAVEATS / INSUFFICIENT`. This plan turns it into a runner+gate: Claude Code, behaving as a real human user of the system, *executes* a catalogued set of user journeys end-to-end across all four product surfaces (SDK, REST API, MCP, and the theo-cloud dashboard UI — cross-repo, on the real dev-stack + real Chrome), records one evidence file per journey, and only then evaluates. The verdict semantics are preserved but are now **backed by executed journeys**: `EVIDENCE_SUFFICIENT` requires every catalogued anchor journey to have run green with fresh evidence. Expected outcome: an honest, repeatable "is the system 100% functional?" gate that generates the anchor evidence instead of waiting for it.

## Goal

> "Enable the TheMemory team to prove the system is 100% functional across all four surfaces by rewriting `/dogfood` into a unified journey-suite that drives every catalogued user journey as a human, measured by `python3 .claude/skills/dogfood/scripts/run_journey_audit.py` emitting `EVIDENCE_SUFFICIENT` only when 100% of anchor journeys have fresh green evidence (and `EVIDENCE_INSUFFICIENT` naming each red/missing journey otherwise)."

## Context

The user directive (2026-07-11): "revisar nossa skill dogfood completa para que ela faça todos os testes de todas as jornadas em UI/API/MCP/SDK", clarified to: (a) **one unified** `/dogfood` skill containing all journeys; (b) it must **use Claude Code with human behavior** to test as a real system user; (c) it must **guarantee the system is 100% functional**; (d) **cross-repo** coverage of all four surfaces.

Motivating evidence — the same session proved, manually, that a real end-to-end UI test IS achievable but is NOT automated and NOT captured by `/dogfood` today: I brought up the theo-cloud dev-stack with OpenRouter, seeded a logged-in user's workspace, and visually confirmed M2 summary + M1 superseded-edge rendering in the real dashboard via chrome-devtools MCP. None of that flows into the `/dogfood` verdict — the anchor `claude-code-auto-memory` is a *single* scenario, and the UI/API/MCP/SDK journeys are not enumerated as gate inputs.

Prior art already in-repo: the `dogfood-anchor-scenario-launch` plan shipped `scripts/dogfood/claude-code-bridge.ts` + `.claude/hooks/dogfood-mirror.sh` — a mechanism where Claude Code's *own* memory writes are mirrored into TheMemory via the MCP surface. That is the seed of "Claude Code as human user"; this plan generalizes it from passive mirroring to active journey execution.

This change alters a **LOCKED** golden rule (`rules/dogfood-golden-rule.md`), so it is gated by the Golden Rule Change Protocol (`cycle-rule-schema.md § Golden Rule Change Protocol`): ADR + CHANGELOG + `check_xrefs.py` + `test_e2e_smoke.py` green.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `.claude/skills/dogfood/SKILL.md` | 100 | `8006dc0` (2026-06-28) | The dogfood skill: audit/log-evidence/status modes over a manifest + evidence dir | Keep `audit` verdict tokens `EVIDENCE_SUFFICIENT/WITH_CAVEATS/INSUFFICIENT`; keep `status` non-verdict; keep read-of-golden-rule contract |
| `.claude/rules/dogfood-golden-rule.md` | 86 | `8006dc0` (2026-06-28) | LOCKED contract: anchor scenario, Status vocab, hard/soft caps, evidence frontmatter | Status vocab (`planned/wired/running/paused/abandoned`) stays; hard-cap short-circuit semantics stay; change requires ADR (this plan's D1) |
| `.claude/knowledge-base/dogfood/manifest.md` | 140 | `1cc502d` (2026-06-28) | Declares anchor slug `claude-code-auto-memory`, Status `running`, decision log | Existing anchor + decision log preserved; journey catalog is ADDED, not a silent anchor swap |
| `.claude/knowledge-base/dogfood/journeys.md` (NEW) | 0 | — | (NEW) machine-parseable journey catalog: one row per journey with surface, id, steps, oracle | — |
| `.claude/skills/dogfood/scripts/run_journey_audit.py` (NEW) | 0 | — | (NEW) evaluator: parses the catalog + evidence, computes all-green verdict | — |
| `.claude/skills/dogfood/scripts/check_journey_catalog.py` (NEW) | 0 | — | (NEW) validates catalog structure + that each surface has ≥1 journey | — |
| `.claude/skills/dogfood/drivers/` (NEW dir) | 0 | — | (NEW) per-surface driver prompts Claude follows to execute journeys as a human | — |
| `.claude/knowledge-base/adrs/ADR-0019-dogfood-unified-journey-suite.md` (NEW) | 0 | — | (NEW) ADR authorizing the locked golden-rule change | — |
| `tests/unit/dogfood/run_journey_audit.test.ts` (NEW) | 0 | — | (NEW) TDD for the audit evaluator (Python invoked via subprocess OR port evaluator to TS) | — |
| `CHANGELOG.md` | (exists) | — | Public contract | `[Unreleased] § Changed` entry required by the Golden Rule Change Protocol |

### Current callers / dependents

- **Symbol:** the `/dogfood` skill (invoked by humans + by `cycle-release` pre-v1.0 gate references).
  - **Callers (docs/rules):** `rules/dogfood-golden-rule.md`, `rules/cycle-rule-schema.md § verdict matrix (dogfood row)`, `CLAUDE.md § Production-ready gate (Item 11)`, `README.md § Status`.
  - **Callers (scripts):** `.claude/scripts/check_xrefs.py` validates cross-references; `test_e2e_smoke.py` validates cycle sections.
  - **External (other repos):** the theo-cloud dev-stack is DRIVEN by the UI journeys but does not import this skill. Cross-repo coupling is one-directional (dogfood orchestrates theo-cloud `make dev-up`), not a code dependency.
- **Symbol:** `scripts/dogfood/claude-code-bridge.ts` (`InvalidProjectSlug`, `MCPUnreachable`, bridge fn).
  - **Callers (production):** `.claude/hooks/dogfood-mirror.sh` (PostToolUse hook).
  - **Callers (tests):** `tests/unit/dogfood/claude-code-bridge.test.ts`, `tests/integration/dogfood/claude-code-bridge-roundtrip.test.ts`.
  - This bridge is REUSED (not modified) as the SDK/MCP mirroring primitive; the new drivers may call it or the raw surfaces.

### Domain glossary

- **journey** — one end-to-end user task on one surface (e.g. "remember then recall a fact via REST"), with numbered steps and an observable oracle (assertion).
- **surface** — one of the four product entry points: SDK (`@usetheo/memory` in-process), API (REST `/v1/*`), MCP (native + OpenMemory tools), UI (theo-cloud dashboard).
- **anchor journey** — a journey the golden rule marks as required for `EVIDENCE_SUFFICIENT` (a superset generalization of today's single "anchor scenario").
- **driver** — a per-surface prompt/procedure that tells Claude Code exactly how to execute a journey AS A HUMAN (open the browser, curl the endpoint, run the SDK snippet) and how to record the evidence.
- **evidence file** — append-only markdown with frontmatter `scenario/journey`, `date`, `operator`, `outcome`, `summary`; the audit reads these.
- **dev-stack** — theo-cloud `make dev-up`: gateway + kratos + themory + dashboard vite, the substrate for UI journeys.
- **empirical-snapshot path** — ADR-0012's mechanism letting a Status transition be justified by a captured evidence snapshot rather than 30 days of calendar time.

### Architecture boundaries affected

- `.claude/` cycle-kit boundary: this is a SKILL + RULE + KB change, not `src/**` product code — except the NEW audit scripts (`.claude/skills/dogfood/scripts/*.py`), which follow the existing skill-scripts convention (deterministic Python, subprocess-isolated, per `code-quality`/`plan-confidence` script precedent).
- Cross-repo orchestration boundary (NEW, one-directional): dogfood UI drivers invoke theo-cloud `make dev-up` + chrome-devtools MCP. No code import; the coupling is a documented runbook (per this session's `themory-dashboard-openrouter-uitest-recipe` memory). `rules/architecture.md § God modules` respected — drivers are per-surface, not one god-driver.
- Golden Rule Change Protocol boundary: `rules/dogfood-golden-rule.md` is LOCKED; crossing it requires D1 ADR + the two protocol scripts green.

## Dependencies

This plan adds **no new runtime or dev dependencies** (Parsimony Ladder rung 4 — reuse what is installed; Rule 9 — do not reinvent). Every task is markdown (skill/rule/catalog/ADR) or deterministic scripts on already-present tooling:

| Dependency | Version | Kind | Already present? | Rule-9 justification (why not reinvent) |
|---|---|---|---|---|
| Python 3 stdlib (`re`, `pathlib`, `datetime`, `json`, `sys`) | system (3.11) | dev/tooling | Yes — used by every `.claude/skills/*/scripts/*.py` (e.g. `plan-confidence`, `code-quality`) | Catalog/evidence parsing is a stdlib regex+glob job; no parser lib needed |
| `vitest` | existing (see `package.json` devDeps) | test | Yes — `vitest.contract.config.ts` runs the repo suite | New dogfood unit tests reuse the configured runner; no new test framework |
| `chrome-devtools` MCP | existing session MCP | dev/tooling (UI journeys) | Yes — already connected + used this session | Driving the real browser is the product's front door; no headless-browser dep added |
| theo-cloud `make dev-up` (gateway/kratos/themory/dashboard) | existing sibling repo | dev/tooling (UI journeys) | Yes — `../../theo-cloud/theo-cloud` | The dev-stack IS the UI substrate; orchestrated, not vendored |

No package manifest (`package.json`, `pyproject.toml`) is modified by this plan. Therefore no CVE surface is introduced. If `/implement` later finds a task genuinely needs a new dependency, that task MUST return to `/to-plan` to add it here first (per `cycle-plan` anti-pattern "pivoting the plan during implement").

## Prior Art & Related Work

- **Internal plan** — `knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md` (shipped): built `claude-code-bridge.ts` + `dogfood-mirror.sh`; the "Claude Code writes → TheMemory MCP" primitive this plan generalizes.
- **Internal ADR** — `knowledge-base/adrs/ADR-0012-dogfood-gate-empirical-snapshot-amendment.md`: precedent for amending the dogfood golden rule via ADR (the "wired→running via empirical snapshot" path). D1 follows the same protocol.
- **Internal skill** — `.claude/skills/test-chat-with-memory/SKILL.md`: 30-scenario Chrome-DevTools-MCP UI journey skill for the example app; the UI-driver template is adapted from it (reuse, per Rule 9).
- **Internal recipe (this session)** — session memory `themory-dashboard-openrouter-uitest-recipe`: the exact cross-repo dev-stack bring-up + Chrome-MCP + workspace-seeding gotchas the UI drivers encode.
- **Existing suites reused** — `vitest.contract.config.ts`, `vitest.integration.config.ts`, `vitest.e2e.config.ts`, `tests/integration/{entities,openmemory,reflection,forgetting,distillation,eviction}`, theo-cloud `make e2e` / `make e2e-edge`. Drivers WRAP these where a journey already has a suite (Rule 9 — do not reinvent), and add human-driven execution only where a surface has no runnable journey (primarily UI).
- **External** — dogfooding as a v1.0 honesty gate is standard practice; no external library adopted. (none beyond the internal precedents above)

## Objective

- [ ] D1 ADR authorizes the locked golden-rule change; `check_xrefs.py` + `test_e2e_smoke.py` stay green.
- [ ] A machine-parseable journey catalog (`knowledge-base/dogfood/journeys.md`) enumerates every journey per surface (SDK/API/MCP/UI), each with id, steps, oracle, anchor flag.
- [ ] Per-surface drivers tell Claude Code how to execute each journey AS A HUMAN and record evidence.
- [ ] `run_journey_audit.py` computes the verdict from catalog × evidence (all anchor journeys fresh+green ⇒ `EVIDENCE_SUFFICIENT`).
- [ ] `/dogfood` SKILL.md documents the unified run→audit flow; verdict tokens unchanged.
- [ ] A first full run executes the catalog and produces an honest verdict (SUFFICIENT if truly green, else INSUFFICIENT naming the reds).

## ADRs

### D1 — Amend the LOCKED dogfood golden rule to a runner+gate; generalize the single anchor scenario into an anchor journey catalog
- **Decision:** `rules/dogfood-golden-rule.md` gains a "Journey catalog" section: hard cap #3/#4 evolve from "≥1 evidence file for THE anchor" to "**EVERY journey in `knowledge-base/dogfood/journeys.md` (ALL flagged `anchor: true`) has a fresh (`outcome: pass`) evidence file**" (Q1 — project-owner directive 2026-07-11: all journeys are anchor). The single anchor `claude-code-auto-memory` is preserved as one anchor journey (no silent swap). Verdict tokens unchanged. `EVIDENCE_WITH_CAVEATS` no longer fires on a red non-anchor journey (there are none) — it fires ONLY on the golden rule's thin-evidence soft caps (evidence count < 3, no failure story).
- **Rationale:** the current gate can pass on one narrow scenario while UI/API/MCP/SDK journeys rot untested — exactly the failure mode `dogfood` exists to prevent (`dogfood-golden-rule.md § 7`). Making **every** journey anchor is the literal reading of the owner's directive "todos os testes de todas as jornadas / garantir que o sistema está 100% funcional": `EVIDENCE_SUFFICIENT` means every catalogued journey on every surface is green. Per `cycle-rule-schema.md § Golden Rule Change Protocol`, this is an *extension* (tightens the gate) — lower burden than a softening, still ADR-gated.
- **Alternatives considered:** (a) NEW sibling skill `/dogfood-run` leaving `/dogfood` untouched — rejected: the user explicitly wants ONE unified dogfood ("Unificar em uma dogfood só completa"). (b) Anchor SUBSET + non-anchor soft caps — rejected by the owner (Q1): a subset lets a red journey still yield `EVIDENCE_SUFFICIENT`, contradicting "100% functional". Accepted trade-off: the gate is brittle to flaky journeys (see Drawbacks) — mitigated by per-journey re-run + honest `partial/fail` recording, never a silent green.
- **Consequences:** enables per-surface honesty; every surface + journey must be green for a v1.0 claim; `EVIDENCE_SUFFICIENT` is hard to reach (by design); a single flaky journey blocks — the accepted cost of a literal "100% functional" gate.

### D2 — Claude-as-human execution, not headless-only suites
- **Decision:** journeys are executed by Claude Code following per-surface driver prompts (open Chrome, curl, run SDK snippet), reusing existing automated suites as the *oracle* where one exists. Each journey run writes an evidence file via the `log-evidence` path.
- **Rationale:** the user directive is explicit ("dogfood deve usar o CLAUDE CODE com comportamento humano ... com um usuário do sistema"). A green vitest run proves code works in a harness; a human-driven journey proves the *product* works through the front door (the classic dogfood distinction, `dogfood-golden-rule.md § 7`).
- **Alternatives considered:** pure `pnpm test:all` orchestration — rejected: it never exercises the UI/gateway/Kratos front door and is not "human behavior". CI-only e2e — rejected: same reason; also can't drive the dashboard.
- **Consequences:** the suite is heavier + partly interactive (Chrome MCP, dev-stack) — mitigated by reusing suites for backend surfaces so only UI is fully manual-driven.

### D3 — Journey catalog is the machine-readable SoT in `knowledge-base/dogfood/journeys.md`; the audit script parses it
- **Decision:** one file, one table-block per surface, one row per journey (`id | surface | title | anchor | oracle`), plus a per-journey steps block the driver reads. `check_journey_catalog.py` validates structure; `run_journey_audit.py` joins catalog × evidence.
- **Rationale:** DRY + auditable — mirrors how `code-quality-languages.txt` / `plan-confidence` thresholds are parseable SoT files. Avoids encoding journeys inside prose that can't be gated.
- **Alternatives considered:** embed journeys in SKILL.md prose — rejected: not parseable, drifts. JSON catalog — rejected: the KB convention is markdown-with-frontmatter; keep consistency.
- **Consequences:** adding a journey = a catalog row + a driver block + (first) an evidence run; the gate enforces coverage automatically.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| UI journeys need the full theo-cloud dev-stack + Chrome MCP — flaky/slow, cross-repo | High | Encode the exact bring-up + gotchas (dim-match, platform-admin key, register-proxy workaround, Chrome reconnect) from the session recipe into the UI driver; make UI journeys resumable + individually re-runnable; allow `EVIDENCE_WITH_CAVEATS` when a non-anchor UI journey is skipped with a logged reason | dogfood owner |
| Amending a LOCKED golden rule can destabilize the release gate if done wrong | High | Follow the Golden Rule Change Protocol exactly (D1 ADR + CHANGELOG + `check_xrefs.py` + `test_e2e_smoke.py` green); preserve verdict tokens + Status vocab verbatim | project owner |
| "Claude-as-human" runs are non-deterministic (LLM extraction varies) | Medium | Oracles assert structure/behavior (entity present, edge active flag, counter non-zero), NOT exact LLM wording; reuse deterministic vitest suites as oracle for backend surfaces | dogfood owner |
| Scope creep: "all journeys" is large; a partial catalog claims full coverage falsely | Medium | Coverage Matrix maps every catalog journey to a task; `check_journey_catalog.py` fails if a surface has zero journeys; INCOMPLETE catalog logged explicitly (no silent truncation) | dogfood owner |
| Secrets (OpenRouter key, minted `theo_live_*`) could leak into evidence files | High | Drivers MUST redact — evidence frontmatter carries prefixes only; a grep gate in `check_journey_catalog.py`/audit rejects `theo_live_[A-Za-z0-9_]{8,}` or `sk-or-` in evidence | dogfood owner |

## Unresolved Questions

- Q1 — RESOLVED (project-owner 2026-07-11): **ALL journeys are anchor**; `EVIDENCE_SUFFICIENT` requires every catalogued journey green+fresh (see D1). `EVIDENCE_WITH_CAVEATS` fires only on the golden rule's thin-evidence soft caps.
- Q2 — RESOLVED (project-owner 2026-07-11): **fold CLI into the API surface** (thin CLI over the same core); CLI verbs are checks inside the API driver (Coverage #23).
- Q3 — RESOLVED (default): keep the golden rule's **30-day** freshness window for journey evidence; revisit to per-release only if evidence churn proves it too loose.
- Q4 — RESOLVED (default): the UI driver **reuses the seeded `dev@theo.local`** user and **logs the broken register-proxy as a real dogfood finding** (rather than registering fresh each run) until the register-proxy defect is fixed.

## Dependency Graph

```
Phase 0 (ADR + golden-rule + catalog) ──▶ Phase 1 (harness: audit + catalog scripts + drivers scaffold)
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        ▼                        ▼                        ▼
              Phase 2 (SDK+API+MCP          Phase 3 (UI journeys —   (Phases 2 & 3 parallel:
              journey drivers, reuse         cross-repo dev-stack +   independent surfaces)
              vitest/e2e suites)             Chrome MCP)
                        └───────────────────────┼───────────────────────┘
                                                ▼
                                     Phase 4 (rewrite /dogfood SKILL.md
                                     run→audit flow; wire audit to catalog)
                                                ▼
                                     Final Phase: Integration Validation
                                     (one full run → honest verdict)
```

Phase 0 → 1 sequential (harness needs the catalog schema). Phases 2 and 3 parallel (different surfaces). Phase 4 needs 1–3. Final needs all.

---

## Phase 0: Locked-contract change + journey catalog

**Objective:** authorize + define the new gate shape without breaking the protocol.

### T0.1 — ADR-0019 + golden-rule amendment (runner+gate, journey-catalog anchor)

#### Objective
Author ADR-0019 and amend `rules/dogfood-golden-rule.md` so the anchor is the journey catalog, preserving verdict tokens + Status vocab.

#### Why this step (action + reasoning — ReAct discipline)
This step writes ADR-0019 and edits the golden rule's hard-cap table to reference `knowledge-base/dogfood/journeys.md` anchor journeys, plus a "Journey catalog" section and a secrets-redaction evidence rule.
It is necessary first because the golden rule is LOCKED (per `cycle-rule-schema.md § Golden Rule Change Protocol`): no downstream skill/script may assume the new contract until the ADR exists and the two protocol scripts pass. Cites D1.

#### Evidence
`rules/dogfood-golden-rule.md:1-86` (LOCKED contract); `cycle-rule-schema.md § Golden Rule Change Protocol` (ADR+CHANGELOG+scripts); `ADR-0012-dogfood-gate-empirical-snapshot-amendment.md` (amendment precedent).

#### Files to edit
```
.claude/knowledge-base/adrs/ADR-0019-dogfood-unified-journey-suite.md — NEW, the authorizing ADR (D1)
.claude/rules/dogfood-golden-rule.md — add § Journey catalog; hard caps #3/#4 reference journeys.md; add secrets-redaction evidence rule
CHANGELOG.md — [Unreleased] § Changed entry (protocol requirement)
```

#### Deep file dependency analysis
- `dogfood-golden-rule.md` (Baseline row) — LOCKED; edit adds a section + evolves hard caps #3/#4. Downstream: `run_journey_audit.py` (T1.1) reads the new caps; `SKILL.md` (T4.1) cites them.
- `ADR-0019` (NEW) — referenced by the golden rule's "When this rule may change" + by `check_xrefs.py`.

#### Deep Dives
- Invariant: Status vocab (`planned/wired/running/paused/abandoned`) + verdict tokens unchanged (Baseline invariant cell). Only hard-cap *inputs* change (single anchor → anchor journeys).
- Edge case: existing anchor `claude-code-auto-memory` MUST appear as an anchor journey (no silent swap — `dogfood-golden-rule.md § 7`).

#### Tasks
1. Write ADR-0019 (Decision/Rationale/Alternatives/Consequences = D1).
2. Add `## Journey catalog` to the golden rule pointing at `knowledge-base/dogfood/journeys.md`.
3. Evolve hard caps #3/#4: "≥1 fresh `pass` evidence file per `anchor: true` journey".
4. **[EC-2]** Add evidence secrets-redaction rule: drivers write at most `theo_live_`+4 chars / `sk-or-`+4 chars; a `pass` is INVALID if any body ≥ 20 chars matches `theo_live_[A-Za-z0-9_-]{20,}` or `sk-or-v1-[A-Za-z0-9]{20,}` (allows the documented short prefix, rejects a full secret).
5. **[EC-3]** Add to the LOCKED evidence frontmatter contract (`§ 5`) a REQUIRED `oracle_result:` field — the machine-observable proof of the journey (suite exit code / Chrome `evaluate_script` return / HTTP status+shape). `outcome: pass` without a non-empty `oracle_result` is INVALID.
6. **[EC-1]** Preserve backward-compat: the frontmatter join key MAY be `journey:` OR the legacy `scenario:`; the preserved anchor journey declares `aliases:` so existing `scenario: claude-code-auto-memory` evidence still matches.
7. Add CHANGELOG `[Unreleased] § Changed` entry citing ADR-0019.

#### TDD
```
RED:     test_e2e_smoke.py — the dogfood cycle sections stay intact (no dogfood `## §`/row removed) after the edit
RED:     check_xrefs.py — adds ZERO new [FAIL] referencing `dogfood-golden-rule.md` or `ADR-0019` (DELTA vs the committed baseline; the whole-repo protocol-script baseline is PRE-EXISTING FAIL — Python-syntax + `skill_cycle_contract_resolves` + skill-frontmatter — unrelated to /dogfood and out of this plan's scope, per BLOCKED report 2026-07-11)
GREEN:   Author ADR + amend rule so no new referencing-FAIL appears AND verdict tokens present in the file are verbatim-unchanged (EC-11 grep)
REFACTOR: None expected (markdown)
VERIFY:  test "$(python3 .claude/scripts/check_xrefs.py 2>&1 | grep '\[FAIL\]' | grep -Ec 'dogfood-golden|ADR-0019')" = "0"  # scoped delta; MUST be 0
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] ADR-0019 exists and is cited by the golden rule.
- [ ] Golden rule verdict tokens + Status vocab unchanged (diff shows only additions/cap-input evolution).
- [ ] `check_xrefs.py` adds ZERO new [FAIL] referencing `dogfood-golden-rule.md`/`ADR-0019` (scoped delta; whole-repo baseline is pre-existing FAIL, out of scope).
- [ ] `test_e2e_smoke.py` dogfood cycle sections intact (no dogfood section removed).
- [ ] CHANGELOG `[Unreleased] § Changed` has the entry.
- [ ] Pass: size — edited files ≤ 500 lines.

#### DoD (Definition of Done)
- [ ] Protocol scripts add zero new referencing-FAIL (scoped delta — whole-repo baseline is pre-existing FAIL).
- [ ] No verdict-token/Status-vocab regression.

### T0.2 — Journey catalog `knowledge-base/dogfood/journeys.md` (all surfaces enumerated)

#### Objective
Create the machine-parseable catalog enumerating every journey per surface with id/surface/title/anchor/oracle + a steps block each.

#### Why this step (action + reasoning — ReAct discipline)
Writes `knowledge-base/dogfood/journeys.md` with one table-block per surface (SDK/API/MCP/UI) and a per-journey steps section the drivers consume.
Necessary now because it is the SoT (D3) that Phases 1–4 all depend on; without it the audit has nothing to join against and the Coverage Matrix cannot be enforced.

#### Evidence
Surfaces from Baseline: CLI verbs `remember recall forget reflect mcp server migrate health keys`; REST routes (`/v1/remember|recall|forget|reflect`, `/v1/scopes/:type/:id/{memories,episodes,metrics}`, entities/graph, admin keys, members, health); MCP native+OpenMemory (`README Feature Status` rows 4+26); UI dashboard tabs observed this session (Overview/Memories/Episodes/Playground/Entities/Graph/Skills/Exports/Webhooks).

#### Files to edit
```
.claude/knowledge-base/dogfood/journeys.md — NEW, the catalog (see Coverage Matrix for the journey rows)
```

#### Deep file dependency analysis
- NEW file; consumed by `check_journey_catalog.py` (T1.2) + `run_journey_audit.py` (T1.1) + drivers (Phases 2–3).

#### Deep Dives
- Data structure per row: `id (J-<SURFACE>-<n>) | surface | title | anchor (true/false) | oracle (suite path OR assertion phrase)`.
- Steps block per journey: numbered human steps + the observable oracle (what proves it worked).
- Anchor set (D1, Q1 resolved): **ALL journeys `anchor: true`** — every catalogued journey is required green for `EVIDENCE_SUFFICIENT`. The preserved `claude-code-auto-memory` is one of them (mapped via `aliases:`, EC-1).

#### Tasks
1. Enumerate SDK journeys (J-SDK-1..12 per Coverage Matrix).
2. Enumerate API journeys (J-API-1..6, incl. folded CLI per Q2).
3. Enumerate MCP journeys (J-MCP-1..4).
4. Enumerate UI journeys (J-UI-1..9).
5. Mark EVERY journey `anchor: true` (Q1); map the legacy `claude-code-auto-memory` anchor via `aliases:`.

#### TDD
```
RED:     test_journey_catalog_has_all_four_surfaces() -> check_journey_catalog.py fails on empty/malformed, passes on this file
RED:     test_every_journey_flagged_anchor_true() -> assert all(j.anchor is True for j in catalog) (Q1)
GREEN:   Author the catalog so the validator passes
REFACTOR: None expected
VERIFY:  python3 .claude/skills/dogfood/scripts/check_journey_catalog.py
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Every surface (SDK/API/MCP/UI) has ≥ 1 journey; EVERY journey is `anchor: true` (Q1).
- [ ] Every journey has id/surface/title/anchor/oracle + a steps block.
- [ ] Legacy anchor `claude-code-auto-memory` present as an anchor journey (via `aliases:`).
- [ ] Pass: size — ≤ 500 lines (split per-surface if exceeded).

#### DoD (Definition of Done)
- [ ] `check_journey_catalog.py` green.

---

## Phase 1: Audit harness (evaluator + catalog validator + drivers scaffold)

**Objective:** deterministic scripts that validate the catalog and compute the verdict from catalog × evidence.

### T1.1 — `run_journey_audit.py` (catalog × evidence → verdict)

#### Objective
Implement the evaluator: join `knowledge-base/dogfood/journeys.md` anchor journeys with `evidence/*.md`, emit `EVIDENCE_SUFFICIENT/WITH_CAVEATS/INSUFFICIENT` + name each red/missing/stale journey.

#### Why this step (action + reasoning — ReAct discipline)
Writes a deterministic Python evaluator (no LLM) mirroring the existing `plan-confidence`/`code-quality` script style: parse catalog, glob evidence, apply the D1 hard caps, print verdict + JSON.
Necessary now because it is the Goal's measured metric; every later phase's "green" is defined by this script's output.

#### Evidence
`dogfood-golden-rule.md § 3` hard-cap ordering (short-circuit to INSUFFICIENT); existing script convention `skills/dogfood/scripts/` sibling to `code-quality/scripts/*.py`.

#### Files to edit
```
.claude/skills/dogfood/scripts/run_journey_audit.py — NEW evaluator
tests/unit/dogfood/run_journey_audit.test.ts — NEW RED tests (subprocess-invoke the script on fixtures)
tests/fixtures/dogfood/journeys-*.md + evidence/*.md — NEW fixtures (green, red, stale, missing)
```

#### Deep file dependency analysis
- NEW evaluator; reads catalog (T0.2) + evidence dir + golden-rule caps (T0.1). Downstream: SKILL.md `audit` mode (T4.1) invokes it.

#### Deep Dives
- Algorithm: parse anchor journeys → for each, find newest evidence whose join key (`journey:` OR legacy `scenario:` matched against the journey's `aliases:` [EC-1]) matches, with `outcome: pass` AND a non-empty `oracle_result:` [EC-3], within freshness → any missing/red/stale/oracle-less ⇒ INSUFFICIENT (list them). All anchor green + a non-anchor red ⇒ WITH_CAVEATS. All green ⇒ SUFFICIENT.
- Invariant: hard-cap short-circuit order preserved (first fail wins) per golden rule § 3.
- Edge cases: no evidence dir → INSUFFICIENT `evidence_dir_missing`; zero anchor journeys in catalog → INSUFFICIENT `no_anchor_journeys` [EC-7]; newest evidence `fail` beats older `pass`, tie-break lexicographically-last filename [EC-5]; orphan evidence (id not in catalog) ignored, never crash [EC-6]; freshness boundary inclusive at exactly `today−30d` [EC-4].
- Secret gate [EC-2]: `pass` INVALID if a body matches `theo_live_[A-Za-z0-9_-]{20,}` / `sk-or-v1-[A-Za-z0-9]{20,}` → INSUFFICIENT `evidence_contains_secret` (the documented ≤4-char prefix does NOT match).
- Oracle gate [EC-3]: `outcome: pass` with empty/absent `oracle_result:` → INSUFFICIENT `outcome_pass_requires_oracle_result` (blocks a hallucinated self-reported green).

#### Pseudo-code / Signatures
```pseudocode
function audit(catalogPath, evidenceDir, goldenRulePath) -> {verdict, reds, json}
  journeys = parseCatalog(catalogPath)
  anchors  = journeys.filter(j => j.anchor)
  reds = []
  for j in anchors:
    ev = newestEvidenceFor(j.id, evidenceDir)
    if ev == null:            reds.push({j, "no_evidence"})
    elif ev.outcome != pass:  reds.push({j, "red:"+ev.outcome})
    elif stale(ev, 30d):      reds.push({j, "stale"})
    elif hasSecret(ev):       reds.push({j, "secret_leak"})
  if reds.nonEmpty: return INSUFFICIENT(reds)
  nonAnchorReds = ...
  return nonAnchorReds.empty ? EVIDENCE_SUFFICIENT : EVIDENCE_WITH_CAVEATS

# Example
input:  catalog with 1 anchor J-API-1, evidence outcome=pass date=today
output: { verdict: "EVIDENCE_SUFFICIENT", reds: [] }
```

#### TDD
```
RED:     test_audit_green_catalog_emits_sufficient() — all anchor evidence pass+fresh+oracle_result ⇒ SUFFICIENT
RED:     test_audit_missing_anchor_evidence_emits_insufficient_and_names_it()
RED:     test_audit_red_anchor_journey_emits_insufficient()
RED:     test_audit_stale_anchor_evidence_emits_insufficient()
RED:     test_audit_rejects_full_secret() / audit_allows_short_prefix()          [EC-2]
RED:     test_audit_nonanchor_red_only_emits_with_caveats()
RED:     test_audit_legacy_scenario_field_satisfies_mapped_anchor()              [EC-1]
RED:     test_audit_pass_without_oracle_result_is_insufficient()                 [EC-3]
RED:     test_audit_evidence_exactly_at_freshness_boundary_is_fresh()            [EC-4]
RED:     test_audit_newest_fail_supersedes_older_pass()                          [EC-5]
RED:     test_audit_orphan_evidence_ignored_not_crash()                          [EC-6]
RED:     test_audit_zero_anchors_is_structural_insufficient()                    [EC-7]
GREEN:   Implement run_journey_audit.py
REFACTOR: extract parseCatalog/newestEvidenceFor/hasSecret/isFresh helpers
VERIFY:  npx vitest run tests/unit/dogfood/run_journey_audit.test.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] All 12 RED tests green (incl. EC-1..EC-7).
- [ ] Verdict tokens match golden-rule vocabulary exactly.
- [ ] Full-secret evidence ⇒ INSUFFICIENT; documented short prefix ⇒ allowed [EC-2].
- [ ] `outcome: pass` without `oracle_result` ⇒ INSUFFICIENT [EC-3].
- [ ] Legacy `scenario:` evidence satisfies the mapped anchor journey [EC-1].
- [ ] Pass: size ≤ 500 lines; complexity ≤ 10 per function.

#### DoD (Definition of Done)
- [ ] `npx vitest run tests/unit/dogfood/` green; zero type errors.

### T1.2 — `check_journey_catalog.py` + drivers scaffold

#### Objective
Validate catalog structure (every surface ≥1 journey, ids unique, required columns) and scaffold the per-surface driver directory.

#### Why this step (action + reasoning — ReAct discipline)
Writes a structural validator + creates `.claude/skills/dogfood/drivers/{sdk,api,mcp,ui}.md` skeletons the human-execution phases fill.
Necessary now so the catalog (T0.2) has a gate and Phases 2–3 have a home; prevents the "partial catalog claims full coverage" risk.

#### Evidence
Risk row "Scope creep: partial catalog"; D3 (catalog is SoT). Mirrors `code-quality` `check_*` validator convention.

#### Files to edit
```
.claude/skills/dogfood/scripts/check_journey_catalog.py — NEW validator
.claude/skills/dogfood/drivers/{sdk,api,mcp,ui}.md — NEW driver skeletons
tests/unit/dogfood/check_journey_catalog.test.ts — NEW RED tests
```

#### Deep file dependency analysis
- Validator reads `knowledge-base/dogfood/journeys.md` (T0.2). Drivers are consumed by Phases 2–3. Downstream: SKILL.md references drivers.

#### Deep Dives
- Checks: 4 surfaces present; each ≥1 journey + ≥1 anchor; unique ids matching `J-(SDK|API|MCP|UI)-\d+`; every row has oracle + a steps block.
- Edge: a surface with zero journeys ⇒ fail `surface_uncovered_<surface>`.

#### TDD
```
RED:     test_catalog_missing_surface_fails()
RED:     test_catalog_surface_without_anchor_fails()
RED:     test_catalog_duplicate_id_fails()
RED:     test_catalog_valid_passes()
GREEN:   Implement check_journey_catalog.py
REFACTOR: None expected
VERIFY:  npx vitest run tests/unit/dogfood/check_journey_catalog.test.ts
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Validator fails on missing surface / missing anchor / dup id; passes on the real catalog.
- [ ] Four driver skeletons exist.
- [ ] Pass: size ≤ 500; complexity ≤ 10.

#### DoD (Definition of Done)
- [ ] Tests green; `check_journey_catalog.py` passes on `knowledge-base/dogfood/journeys.md`.

---

## Phase 2: Backend-surface drivers (SDK · API · MCP) — reuse suites, human-driven

**Objective:** each SDK/API/MCP journey has a driver that Claude follows to execute it (reusing the existing suite as oracle where present) and record evidence.

### T2.1 — SDK driver (`drivers/sdk.md`) + reuse of integration suites

#### Objective
Author the SDK driver: for each J-SDK journey, the human-steps + the oracle command (reuse `vitest.integration.config.ts` targets) + the evidence template.

#### Why this step (action + reasoning — ReAct discipline)
Fills `drivers/sdk.md` mapping each J-SDK-* row to concrete steps ("run this snippet / this integration test against real pgvector") and the assertion that proves it.
Necessary now because SDK is the foundation surface (all others sit on the core); reusing the shipped integration suites honors Rule 9 (Baseline: `tests/integration/{entities,reflection,forgetting,distillation,eviction}`).

#### Evidence
Baseline `tests/integration/*` dirs; `package.json` scripts `test:integration`; README Feature-Status SDK rows (remember/recall/forget/reflect, skills, reflection, forgetting, distillation, entities/graph, asOf, attributedTo, recall-cache).

#### Files to edit
```
.claude/skills/dogfood/drivers/sdk.md — fill with J-SDK-1..12 steps + oracles
.claude/knowledge-base/dogfood/journeys.md — refine J-SDK rows if a step is unrunnable (path-validate)
```

#### Deep file dependency analysis
- Driver references existing suites (no code change to them). If a journey has no suite, the driver specifies a real SDK snippet Claude runs against `THEOMEM_PG_URI`.

#### Deep Dives
- Oracle preference order: existing integration test > REST round-trip > ad-hoc SDK snippet. Every oracle is an *observable* assertion (row exists, cosine>threshold, active flag), not LLM wording (Risk: non-determinism).

#### TDD
```
RED:     test_sdk_driver_every_journey_has_resolvable_oracle() -> check_journey_catalog.py passes + each J-SDK oracle path resolves
RED:     test_sdk_driver_missing_oracle_records_fail_not_skip() -> EC-8 assert outcome == "fail" reason=oracle_unresolvable
GREEN:   Author sdk.md; refine rows
REFACTOR: None expected
VERIFY:  python3 .claude/skills/dogfood/scripts/check_journey_catalog.py
```

#### Edge/negative (EC-8 — applies to all drivers T2.1/T2.2/T2.3)
When a journey's oracle command/path does not resolve at run time (suite renamed/deleted), the driver MUST write `outcome: fail reason=oracle_unresolvable` — never skip silently. RED test `driver_missing_oracle_records_fail_not_skip()`.

#### Concurrency tests (only when applicable)
Eviction + reflection touch capacity triggers/async hooks (Baseline: `tests/integration/{eviction,reflection}`). The driver's oracle for J-SDK-10/11 REUSES those suites, which already carry their race-aware coverage; the driver adds no new concurrency logic.
(none — single-threaded). The reused eviction/reflection integration suites are the race-aware oracle; the driver adds no concurrency logic.

#### Acceptance Criteria
- [ ] Every J-SDK journey has resolvable steps + oracle.
- [ ] Oracles assert structure/behavior, not LLM wording.
- [ ] `check_journey_catalog.py` green.

#### DoD (Definition of Done)
- [ ] Catalog validator green; SDK driver complete.

### T2.2 — API driver (`drivers/api.md`, incl. folded CLI) + auth journeys

#### Objective
Author the API driver: REST round-trips (curl as a human), auth (api-key + OIDC + fail-closed), admin key lifecycle + members RBAC, entities/graph/metrics, folded CLI verbs.

#### Why this step (action + reasoning — ReAct discipline)
Fills `drivers/api.md` with the J-API-* steps: real `curl` against `:18081` (or the gateway) with a minted `theo_live_*` key, asserting status + body shape; folds `themory <verb>` CLI checks (Q2).
Necessary now because the API/CLI surface is what external consumers + the gateway use; the auth + admin-lifecycle journeys are the CWE-441/RBAC guarantees (`CLAUDE.md § invariants`).

#### Evidence
Baseline REST routes (`/v1/admin/keys*`, `/v1/members*`, `/v1/scopes/:type/:id/{metrics,memories,episodes}`, entities/graph); README Item 20 (auth lifecycle) + Item 16 (REST); this session's mint+seed flow.

#### Files to edit
```
.claude/skills/dogfood/drivers/api.md — fill J-API-1..6 (+ CLI) steps + oracles
.claude/knowledge-base/dogfood/journeys.md — refine J-API rows
```

#### Deep file dependency analysis
- Driver uses the running `themory server` + admin bootstrap; no product code change. Redaction: evidence records key *prefixes* only (Risk row: secrets).

#### Deep Dives
- J-API-3 (auth): assert `theo_live_*` accepted, non-`theo_live_` → OIDC path, missing → 401 (fail-closed) — matches this session's observed behavior.
- Edge: health warmup 503→200 (EC-33) is J-API-5's oracle.

#### Failure scenarios: see `## Failure scenarios` (REST/DB/LLM external I/O).

#### TDD
```
RED:     test_api_driver_every_journey_has_resolvable_oracle() -> check_journey_catalog.py passes + each J-API oracle resolves
RED:     test_api_driver_secret_literal_evidence_is_insufficient() -> assert verdict == "EVIDENCE_INSUFFICIENT" (EC-2 cross-check)
GREEN:   Author api.md
REFACTOR: None expected
VERIFY:  python3 .claude/skills/dogfood/scripts/check_journey_catalog.py
```

#### Concurrency tests (only when applicable)
(none — single-threaded). The server's own concurrency is covered by its integration suites.

#### Acceptance Criteria
- [ ] J-API journeys have curl steps + status/shape oracles.
- [ ] Auth fail-closed (401) journey present.
- [ ] Admin key lifecycle + members RBAC journeys present.
- [ ] CLI verbs mapped (Q2 folded).

#### DoD (Definition of Done)
- [ ] Catalog validator green; API driver complete.

### T2.3 — MCP driver (`drivers/mcp.md`) native + OpenMemory compat

#### Objective
Author the MCP driver: native tools (remember/recall/forget/reflect) over stdio+http and OpenMemory compat (add_memories/search_memory/list_memories/delete_memories) over SSE, with per-user isolation.

#### Why this step (action + reasoning — ReAct discipline)
Fills `drivers/mcp.md` reusing `tests/integration/openmemory` + the shipped `themory mcp` / `--compat openmemory` as oracle, plus a real MCP client round-trip.
Necessary now because MCP is the agent-facing surface (P0 sub-goal 3); the per-user isolation journey re-proves the IDOR closure (README Item 26).

#### Evidence
Baseline `tests/integration/openmemory`; README rows 4 (`themory mcp`) + 26 (OpenMemory compat, SSE, per-user delete isolation).

#### Files to edit
```
.claude/skills/dogfood/drivers/mcp.md — fill J-MCP-1..4 steps + oracles
.claude/knowledge-base/dogfood/journeys.md — refine J-MCP rows
```

#### Deep file dependency analysis
- Reuses the OpenMemory integration suite + a live `themory mcp` boot. No product change.

#### Deep Dives
- J-MCP-4 oracle: user A cannot read/delete user B's memory (assert 404/empty, not error leak).

#### TDD
```
RED:     test_mcp_driver_every_journey_has_resolvable_oracle() -> check_journey_catalog.py passes + each J-MCP oracle resolves
GREEN:   Author mcp.md
REFACTOR: None expected
VERIFY:  python3 .claude/skills/dogfood/scripts/check_journey_catalog.py
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Native + OpenMemory journeys present.
- [ ] Per-user isolation journey present.

#### DoD (Definition of Done)
- [ ] Catalog validator green; MCP driver complete.

---

## Phase 3: UI driver (theo-cloud dashboard, cross-repo) — Chrome-MCP human-driven

**Objective:** the UI driver Claude follows to bring up the dev-stack and drive every dashboard journey as a logged-in human, recording evidence.

### T3.1 — UI driver (`drivers/ui.md`) — dev-stack bring-up + Chrome-MCP journeys

#### Objective
Encode the cross-repo dev-stack bring-up + Chrome-MCP journeys for every dashboard tab (login → Overview → Memories → Episodes → Playground → Entities(M2) → Graph(M1) → Skills → Exports/Webhooks), with the exact gotchas.

#### Why this step (action + reasoning — ReAct discipline)
Fills `drivers/ui.md` with the runbook from this session's `themory-dashboard-openrouter-uitest-recipe` memory: `make dev-up` (embedder-dim match, `OPENAI_CHAT_MODEL=openai/gpt-4o-mini`, platform-admin key mint, recreate-with-deps), login as `dev@theo.local`, seed the user's workspace, drive Chrome (navigate/snapshot/screenshot), assert per tab.
Necessary now because UI is the surface with NO runnable suite (the example-app `test-chat-with-memory` skill covers a different app) — it is the primary gap the user's directive targets; without an explicit driver the UI journeys can't be executed reproducibly.

#### Evidence
This session: M2 summary rendered (`ui-m2-entities.png`), M1 superseded toggle 4→5 relations (`ui-m1-graph-audit.png`); session memory `themory-dashboard-openrouter-uitest-recipe` (7 gotchas); `test-chat-with-memory/SKILL.md` (Chrome-MCP driver template, reused).

#### Files to edit
```
.claude/skills/dogfood/drivers/ui.md — fill J-UI-1..9 steps + oracles + the dev-stack runbook
.claude/knowledge-base/dogfood/journeys.md — refine J-UI rows
```

#### Deep file dependency analysis
- Driver orchestrates theo-cloud `make dev-up` + chrome-devtools MCP (one-directional cross-repo coupling; no import). Redaction: no OpenRouter key / minted key in evidence.

#### Deep Dives
- Oracle per tab is an observable UI assertion via `evaluate_script` (e.g. Entities table SUMMARY cell text contains `works_at → Meta`; Graph relations count increments with the superseded toggle) + a screenshot artifact path.
- Edge/known-defect: register-proxy broken in dev-stack (Q4) → driver logs it as a real finding and reuses the seeded user; this is exactly the kind of DX pain dogfood should surface.

#### TDD
```
RED:     test_ui_driver_every_tab_has_chrome_observable_oracle() -> check_journey_catalog.py passes + each J-UI row has an evaluate_script oracle
RED:     test_ui_j6_evidence_with_screenshot_and_oracle_result_passes() -> assert audit counts J-UI-6 green (fresh+pass+oracle_result)
GREEN:   Author ui.md
REFACTOR: None expected
VERIFY:  python3 .claude/skills/dogfood/scripts/check_journey_catalog.py
```

#### Concurrency tests (only when applicable)
(none — single-threaded). Browser interactions are sequential.

#### Acceptance Criteria
- [ ] Every dashboard tab has a J-UI journey with a Chrome-MCP-observable oracle.
- [ ] The dev-stack runbook (7 gotchas) is encoded so a fresh operator can reproduce.
- [ ] M2 (Entities summary) + M1 (Graph superseded toggle) journeys present and anchor-flagged.

#### DoD (Definition of Done)
- [ ] Catalog validator green; UI driver complete + reproducible.

---

## Phase 4: Unify the /dogfood skill (run → audit)

**Objective:** rewrite SKILL.md so `run` executes the catalog via drivers and `audit` evaluates via `run_journey_audit.py`; verdict tokens unchanged.

### T4.1 — Rewrite `.claude/skills/dogfood/SKILL.md`

#### Objective
Add a `run` mode (execute journeys via the four drivers, writing evidence), rewire `audit` to `run_journey_audit.py`, keep `log-evidence`/`status`, preserve verdict tokens.

#### Why this step (action + reasoning — ReAct discipline)
Edits SKILL.md to document the unified flow: `run [surface?]` drives journeys (Claude-as-human per D2), each journey ends with a `log-evidence` write; `audit` calls the evaluator; `status` unchanged.
Necessary now because the drivers + evaluator only become a skill when SKILL.md orchestrates them; this is the "one unified dogfood" the user asked for.

#### Evidence
Baseline SKILL.md:1-100 (current modes); D2 (Claude-as-human); T1.1 evaluator; Phase 2–3 drivers.

#### Files to edit
```
.claude/skills/dogfood/SKILL.md — add run mode; rewire audit; cite drivers + evaluator; keep tokens
```

#### Deep file dependency analysis
- SKILL.md is the caller of drivers (Phases 2–3) + `run_journey_audit.py` (T1.1). Downstream doc callers (`README`, `CLAUDE.md § Item 11`) unaffected (verdict tokens stable).

#### Deep Dives
- Invariant: `audit`/`status` verdict + non-verdict semantics preserved (Baseline invariant). `run` is additive.
- Edge: `run` on a surface with a down dependency (no dev-stack) records the affected journeys `outcome: partial` with the reason (never silent).

#### TDD
```
RED:     test_e2e_smoke.py — dogfood cycle sections stay intact after the SKILL.md rewrite
RED:     check_xrefs.py — the rewritten SKILL.md adds ZERO new [FAIL] referencing the dogfood skill / drivers / scripts / the journey catalog (DELTA vs committed baseline; whole-repo baseline is pre-existing FAIL, out of scope)
GREEN:   Rewrite SKILL.md so every reference it introduces resolves (no new referencing-FAIL)
REFACTOR: None expected
VERIFY:  test "$(python3 .claude/scripts/check_xrefs.py 2>&1 | grep '\[FAIL\]' | grep -Ec 'skills/dogfood|journeys.md|run_journey_audit|check_journey_catalog')" = "0"  # scoped delta; MUST be 0
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `run` mode documented (per-surface + all).
- [ ] `audit` invokes `run_journey_audit.py`; tokens unchanged.
- [ ] SKILL.md rewrite adds ZERO new [FAIL] referencing the dogfood skill / drivers / scripts / the journey catalog (scoped delta; whole-repo baseline pre-existing FAIL, out of scope).
- [ ] Pass: size ≤ 500 lines.

#### DoD (Definition of Done)
- [ ] Protocol scripts add zero new referencing-FAIL (scoped delta).

---

## Coverage Matrix

| # | Gap / Requirement (journey) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Locked golden-rule change authorized (ADR + protocol green) | T0.1 | ADR-0019 + amendment; `check_xrefs`+`test_e2e_smoke` green |
| 2 | Machine-readable journey catalog (all surfaces) | T0.2 | `knowledge-base/dogfood/journeys.md` with per-surface rows + steps |
| 3 | Verdict evaluator (catalog × evidence → SUFFICIENT/…) | T1.1 | `run_journey_audit.py` + 6 tests |
| 4 | Catalog structural gate (surface coverage, unique ids) | T1.2 | `check_journey_catalog.py` + driver scaffold |
| 5 | J-SDK-1 remember→recall round-trip | T2.1 | SDK driver + integration oracle |
| 6 | J-SDK-2 3-tier scope isolation (user/session/agent) | T2.1 | SDK driver |
| 7 | J-SDK-3 forget (soft + hard/GDPR) | T2.1 | SDK driver |
| 8 | J-SDK-4 reflect (consolidation) | T2.1 | SDK driver (reflection suite oracle) |
| 9 | J-SDK-5 skills repo-scope add/recall/consolidate/forget | T2.1 | SDK driver |
| 10 | J-SDK-6 entities + graph traversal (+asOf) | T2.1 | SDK driver (entities suite oracle) |
| 11 | J-SDK-7 episodes | T2.1 | SDK driver |
| 12 | J-SDK-8 bi-temporal asOf recall | T2.1 | SDK driver |
| 13 | J-SDK-9 attributedTo multi-peer | T2.1 | SDK driver |
| 14 | J-SDK-10 eviction + long-tail forgetting | T2.1 | SDK driver (eviction/forgetting suite oracle) |
| 15 | J-SDK-11 distillation episodic→semantic | T2.1 | SDK driver (distillation suite oracle) |
| 16 | J-SDK-12 recall cache | T2.1 | SDK driver |
| 17 | J-API-1 REST remember/recall/forget/reflect round-trip | T2.2 | API driver (curl) |
| 18 | J-API-2 scopes memories/entities/graph/episodes/metrics | T2.2 | API driver |
| 19 | J-API-3 auth api-key + OIDC + fail-closed 401 | T2.2 | API driver |
| 20 | J-API-4 admin key lifecycle + members RBAC | T2.2 | API driver |
| 21 | J-API-5 health/health-db warmup 503→200 | T2.2 | API driver |
| 22 | J-API-6 graph includeSuperseded (M1) + entities summary (M2) via REST | T2.2 | API driver |
| 23 | CLI verbs (`themory remember/recall/forget/reflect/keys/health/...`) | T2.2 | Folded into API driver (Q2) |
| 24 | J-MCP-1 native tools stdio | T2.3 | MCP driver |
| 25 | J-MCP-2 native streamable-http + bearer | T2.3 | MCP driver |
| 26 | J-MCP-3 OpenMemory compat SSE (add/search/list/delete) | T2.3 | MCP driver (openmemory suite oracle) |
| 27 | J-MCP-4 per-user isolation (IDOR closed) | T2.3 | MCP driver |
| 28 | J-UI-1 register/login (Kratos) | T3.1 | UI driver (Chrome MCP) |
| 29 | J-UI-2 Memory Overview counters | T3.1 | UI driver |
| 30 | J-UI-3 Memories tab | T3.1 | UI driver |
| 31 | J-UI-4 Episodes tab | T3.1 | UI driver |
| 32 | J-UI-5 Playground remember+recall live | T3.1 | UI driver |
| 33 | J-UI-6 Entities tab M2 summary column | T3.1 | UI driver (anchor) |
| 34 | J-UI-7 Graph tab M1 superseded toggle | T3.1 | UI driver (anchor) |
| 35 | J-UI-8 Skills tab browse + curate | T3.1 | UI driver |
| 36 | J-UI-9 Exports / Webhooks | T3.1 | UI driver |
| 37 | Legacy anchor `claude-code-auto-memory` preserved | T0.2 | Mapped as an anchor journey |
| 38 | Unified `/dogfood` run→audit flow; tokens unchanged | T4.1 | SKILL.md rewrite |
| 39 | Secrets never leak into evidence | T0.1, T1.1 | Golden-rule rule + audit redaction gate |
| 40 | First full run yields honest verdict | T5.1 | End-to-end suite run in the Integration Validation phase |
| 41 | EC-1 legacy `scenario:` evidence backward-compat | T0.1, T1.1 | `aliases:` join + `audit_legacy_scenario_field_...` test |
| 42 | EC-2 secret redaction (allow prefix, reject full) | T0.1, T1.1 | source-side cap + `{20,}` gate + 2 tests |
| 43 | EC-3 `oracle_result` required for `pass` (no hallucinated green) | T0.1, T1.1 | mandatory field + `audit_pass_without_oracle_result_...` test |
| 44 | EC-4..7 freshness boundary / newest-fail / orphan / zero-anchor | T1.1 | 4 RED tests added to T1.1 TDD |
| 45 | EC-8 oracle unresolvable at run time ⇒ fail (not skip) | T2.1/T2.2/T2.3 | driver records `fail reason=oracle_unresolvable` |
| 46 | EC-9..11 interrupted run / repo-missing / token-regression | T4.1, T3.1, T0.1 | documented + token-set grep in T0.1 VERIFY |

**Coverage: 46/46 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run tests/unit/dogfood/` green
- [ ] Zero type errors — `npm run test:type`
- [ ] Zero lint warnings — `npm run lint` (on changed TS) / markdown lint on rules+skill
- [ ] File-size budget respected (per `rules/architecture.md`; scripts ≤ 500 LoC)
- [ ] CHANGELOG.md updated under `[Unreleased] § Changed` (Unbreakable Rule 6) — protocol requirement
- [ ] Backward compatibility preserved: `/dogfood` verdict tokens + Status vocab unchanged
- [ ] Golden Rule Change Protocol satisfied: `python3 .claude/scripts/check_xrefs.py` + `python3 .claude/scripts/test_e2e_smoke.py` both green
- [ ] **Runtime-metric proof** — `run_journey_audit.py` emits a verdict from REAL evidence produced by an actual run (not fixtures) in the Final Phase
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Failure scenarios (when I/O external)

The UI + API + MCP journeys touch external I/O (themory server over HTTP, pgvector, OpenRouter LLM, the gateway, Kratos, Chrome CDP). The drivers must handle these failure modes (the audit records `outcome: partial/fail` with the reason, never silent):

| Dependency | Failure mode | How the driver reproduces / detects it | Expected behavior |
|---|---|---|---|
| `themory server` (HTTP) | not booted / warming (503) | driver polls `/v1/health` before journeys | journeys blocked → evidence `outcome: partial reason=server_warming`; not counted green |
| `pgvector` (DB) | embedder-dim ≠ column-dim | driver checks `atttypmod` after boot (session gotcha) | halt + fix (destructive dim migration) BEFORE journeys; else `remember` silently returns `[]` (the exact trap this session hit) |
| `OpenRouter` (LLM) | model 404 / rate-limit / Azure json quirk | driver asserts extraction produced ≥1 entity | zero-extraction ⇒ evidence `outcome: fail reason=llm_extraction_empty` |
| gateway `theo-cloud` (HTTP) | empty platform-admin key (Model B broken) | driver checks `THEMORY_PLATFORM_ADMIN_KEY` non-empty + mints if missing | mint via bootstrap; else UI memory journeys `partial reason=modelB_unprovisioned` |
| Kratos (HTTP) | container exited / register-proxy 5xx | driver `/health/ready` probe + reuse seeded user | log defect as finding; reuse `dev@theo.local`; `partial` on register journey (Q4) |
| Chrome CDP (MCP) | DevToolsActivePort stale / disconnect | driver relaunches a SEPARATE-profile Chrome + repoints the port (session recipe) | reconnect non-destructively; never kill the operator's personal Chrome |

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 0–4. The plan is NOT done until one full real run produces an honest verdict.

### T5.1 — First full real run + honest verdict

Execute the unified `/dogfood run` across all four surfaces (SDK+API+MCP backend, then UI via dev-stack + Chrome MCP), then run the evaluator once against the REAL evidence it produced (not fixtures). This task IS the "first full run yields an honest verdict" gate (Coverage #40).

#### TDD
```
RED:     test_first_full_run_emits_verdict_from_real_evidence() -> assert run_journey_audit.py verdict ∈ {EVIDENCE_SUFFICIENT, EVIDENCE_INSUFFICIENT} over the REAL evidence produced by /dogfood run (not fixtures)
RED:     test_a_simulated_red_journey_blocks_sufficient() -> inject one failing journey; assert verdict != "EVIDENCE_SUFFICIENT"
GREEN:   Run the unified /dogfood run end-to-end, then the evaluator
REFACTOR: None expected
VERIFY:  python3 .claude/skills/dogfood/scripts/run_journey_audit.py
```

#### Concurrency tests (only when applicable)
(none — single-threaded). The orchestration is sequential; the reused backend integration suites carry their own race-aware coverage.

### Execution

```
# unit gates
npx vitest run tests/unit/dogfood/
npm run test:type

# protocol gates (locked golden rule)
python3 .claude/scripts/check_xrefs.py
python3 .claude/scripts/test_e2e_smoke.py

# catalog gate
python3 .claude/skills/dogfood/scripts/check_journey_catalog.py

# ONE REAL RUN of the unified skill: /dogfood run  (drives SDK+API+MCP backend, then UI via dev-stack + Chrome MCP), then:
python3 .claude/skills/dogfood/scripts/run_journey_audit.py
```

If a chaos/failure pass applies, exercise each `## Failure scenarios` row (server-warming, dim-mismatch, llm-empty) and confirm the audit records `partial/fail` — not a false green.

### Acceptance Criteria

- [ ] All unit suites green; zero type errors.
- [ ] `check_xrefs.py` + `test_e2e_smoke.py` green (protocol satisfied).
- [ ] `check_journey_catalog.py` green (every surface covered).
- [ ] `run_journey_audit.py` emits a verdict from REAL evidence of an actual `/dogfood run` (not fixtures).
- [ ] The verdict is HONEST: `EVIDENCE_SUFFICIENT` only if every anchor journey ran green+fresh; otherwise `EVIDENCE_INSUFFICIENT` naming each red (this is a success of the gate, not a failure of the plan).
- [ ] Failure-scenario rows exercised: a simulated red journey ⇒ audit does NOT emit SUFFICIENT.
- [ ] No secret literal in any evidence file.

### If Validation Fails

1. Separate plan-caused failures (script/skill bugs) from product journeys that are genuinely red (the latter are findings, not plan failures).
2. Fix all plan-caused failures; re-run the chain.
3. Product-red journeys are logged as dogfood findings in the run report + surfaced to the human (they are the whole point) and do NOT block plan completion — but they DO block any `production-ready`/v1.0 claim until fixed.
