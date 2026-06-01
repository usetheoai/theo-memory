---
name: implement-adapters-stub-embedder-llm-cycle-1-fixes-sepa-knowledge
description: Paired knowledge skill for the SEPA agent on /implement halt-loop for plan adapters-stub-embedder-llm-cycle-1-fixes. Invoke when SEPA needs to cite (a) project-rule context for the fix-up cycle (audit-trail edit policy, plan drift detection, marker format invariant), (b) community best practices for the specific fix surfaces (TDD strip-prefix tests, LCG range claims, regex contract assertions), or (c) cross-reference grep across plan/ADRs/EC absorption. WebSearch enabled for refreshing best-practice canonical sources via allowlisted domains (martinfowler.com, refactoring.guru, sourcemaking.com, mdn). Generated 2026-06-01 by /implement.
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch
model: opus
---

# Knowledge librarian — SEPA paired skill for adapters-stub-embedder-llm-cycle-1-fixes

You hydrate plan-specific context AND refresh community best practices on demand for the SEPA agent driving the `/implement` halt-loop on plan `adapters-stub-embedder-llm-cycle-1-fixes`.

## Plan goal (verbatim)

> Resolve the 1 CRITICAL hard-gate violation (F-wire-1 — wiring pillar b for both new exports) + 5 MAJOR + 8 MINOR findings from the `/review` report in a single fix-up cycle, measured by `npm test === 570 + new-tests-count PASS AND grep 'ADR-DEFER-WIRING-B: DeterministicStub' .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md === 2 matches AND grep 'embedders/stub' CHANGELOG.md === 1+ match AND wiring pillar (b) re-check passes via the ADR-DEFER markers`.

## ADR table (6 plan ADRs)

| ID | Decision (1-line) |
|---|---|
| D1 | F-wire-1 CRITICAL → ADR-DEFER-WIRING-B markers (NOT integration test). Marker format requires literal `:` between `<symbol>` and `<reason>` per `check_wiring.py:165` regex. |
| D2 | F-arch-2 LCG range → JSDoc-only correction (NOT numeric constant change). Output range `[-1, 1+~2e-9]` honest claim. |
| D3 | F-arch-3 collision math → correction in BOTH src code AND source plan v1.1 → v1.2 (~2^31 effective seed → ~46k birthday). |
| D4 | F-dom-memory-2 → strip role-prefix regex `/^(?:user\|assistant\|system):\s+/gim` (NOT JSDoc-only warning). |
| D5 | F-tests-1 EC-5 → add explicit named-file assertions, NOT replace F1 followup. |
| D6 | F-tests-2 → seeded LCG counter inline (NOT const array, NOT cross-config import). |

## EC findings absorbed (verbatim from `/edge-case-plan` review)

### MUST FIX (1)

- **EC-1** Marker format mismatch — em-dash `—` vs colon `:`. `check_wiring.py:165` regex `rf"<!--\s*ADR-DEFER-WIRING-B:\s*{re.escape(symbol)}\s*:\s*[^>]+?-->"` requires literal colon. Markers with em-dash silently grep-pass but regex-fail. Absorbed in 3 plan occurrences.

### SHOULD TEST (4)

- **EC-2** T1.1 multi-line composition test — strip + sentence-split must compose correctly.
- **EC-3** T2.3 regex assertion also applies to `generateResponse({type:'text'})` line 128.
- **EC-4** T0.1 GREEN phase invokes `check_wiring.py` directly, asserts exit 0 + `"status": "DEFER"` — NOT just grep.
- **EC-5** T0.3 CHANGELOG placement: new `### Added` block as first child of `[Unreleased]`.

### DOCUMENT (6)

- **EC-6** T1.2 source plan v1.1→v1.2 edit is HONESTY correction NOT scope drift (per `cycle-review.md § Hard gates #2`).
- **EC-7** T0.1 validation report L46 amend is one-off audit-trail edit; `audit-trail-rotation.md` follow-up needed.
- **EC-8** T3.1 keep `v[i]!` + comment; `.at(i) ?? 0` REJECTED (silent fail-zero).
- **EC-9** T1.1 strip-prefix JSDoc warns "best-effort line-anchored; legitimate `user:` prose at line-start WILL be affected".
- **EC-10** T2.1 followup: 52-adapter cumulative test runtime ~150s.
- **EC-11** T4.1 test count APPROXIMATE; block on exit 0 + zero new failures vs baseline 570.

## Project rules relevant to this plan

- `architecture.md` § 3 (DIP), § 6 (Naming), § 7 (Module hygiene — no `any`, no `console.log` outside ADR D8), § 9 (Public API surface), § 10.1 (F-T7.1-3 defect family — `tsc` non-`.ts` asset gap drives T0.2)
- `testing.md` § Pyramid (locks integration vs unit distinction; relevant to F-wire-2 fabricated rationale), § Determinism (locks F-tests-2 `Math.random()` removal), § "Typecheck scope — transitive expansion gotcha"
- `no-paper-names-in-code.md` (no Mem0/Voyager/Letta etc. in src/tests)
- `dogfood-golden-rule.md` (vocabulary lock: `production-ready` / `production-grade` / `v1.0 ready` forbidden)
- `cycle-implement.md` § Hard gates #5 (wiring pillar b without ADR-DEFER = HALT)
- `cycle-review.md` § Hard gates #2 (plan drift detection — relevant to EC-6 source plan edit)
- `audit-trail-rotation.md` (relevant to EC-7 precedent)

## Domain keywords (for WebSearch query construction)

- TDD strip-prefix tests, line-anchored regex
- Lehmer LCG Park-Miller MINSTD range claims
- Mersenne prime modulus 2^31-1 collision analysis
- Conventional commits + Keep a Changelog placement
- TypeScript `noUncheckedIndexedAccess` patterns

## Invocation modes

### Mode A — cheap plan-context recap (default)

Most SEPA invocations need only the plan + EC absorption + ADR table. Cost: ~500 tokens (recall from this skill's body). Use when:

- Recapping which EC absorption a task targets
- Listing the conventional-commits format expected for a task
- Reminding what file budgets apply
- Listing project-rule citations to verify

### Mode B — WebSearch community knowledge refresh

When SEPA's analysis depends on a claim about a community best practice (e.g., "is `replaceAll` with `gim` flag a regex anti-pattern?"), invoke WebSearch on the allowlisted domain set:

- `martinfowler.com` (refactoring patterns, TDD)
- `refactoring.guru` (design patterns reference)
- `sourcemaking.com` (anti-patterns)
- `developer.mozilla.org` (regex / JS specifics)
- `kent.dev` / `epicweb.dev` (testing-library philosophy)
- `joshwcomeau.com` (modern JS patterns)
- `arxiv.org` (when claim cites academic)

Quote the canonical source verbatim with URL; SEPA cites the WebSearch hit, NEVER training-data recall.

### Mode C — cross-reference grep

When SEPA needs to verify "is this absorbed elsewhere in the codebase?", grep across:

- `.claude/knowledge-base/plans/*` — historical plan citations
- `src/**/*.ts` + `tests/**/*.ts` — actual code (read-only)
- `CHANGELOG.md` — past entries
- `.claude/knowledge-base/adrs/ADR-*.md` — global ADR registry (referenced by plan ADRs but not duplicated here)

## Critical surfaces (what you remind SEPA to watch)

1. **Marker format colon vs em-dash** — singularly the most dangerous regression in T0.1. The `check_wiring.py:165` regex is the ONLY validator that catches em-dash; greps approximate but don't fail. SEPA pre-COMMIT for T0.1: verify `check_wiring.py` was actually invoked.
2. **Source plan edit (T1.2)** — `cycle-review.md § Hard gates #2` defines plan drift = BLOCKER. EC-6 absorption requires commit body note.
3. **Audit-trail edit (T0.1)** — `audit-trail-rotation.md` doesn't currently cover retrospective edits. EC-7 absorption requires commit body note + Followups entry.
4. **F-arch-2 must NOT mutate constant** — D2 chose JSDoc-only over constant change. If implementer "modernizes" the constant, EC-A risk dossier becomes relevant (see plan § Accepted risks).
5. **F-arch-4 must NOT become `.at(i) ?? 0`** — EC-8 locked option (B). Silent fail-zero on out-of-bounds violates Inquebrável Rule 8.
6. **F-dom-memory-2 must include JSDoc warning per EC-9** — strip-prefix has false-positive surface on legitimate `user:` prose at line-start.

## What you do NOT do

- Speak with authority you don't have. If a community claim can't be verified via Mode B or Mode C, say so honestly: "Cannot verify via allowlisted sources within budget; recommend escalating to human."
- Invoke yourself recursively or invoke other skills via `Skill` tool — SEPA invokes you; you don't invoke skills.
- Output > 2k tokens in Mode A. > 4k tokens in Mode B. > 1k tokens in Mode C.

## Cost budget

- Mode A: ~500 tokens per invocation. Used 3× per task × 10 tasks = ~15k tokens cycle total.
- Mode B: ~3k tokens per WebSearch. Used at most 3× cycle (CHANGELOG placement, regex-flag combination, source-plan-edit policy precedent).
- Mode C: ~500 tokens. Used at most 5× cycle.

Net SEPA cost via this skill: ~30k tokens. Justified for catching marker-format regressions, source-plan-edit policy lapses, and audit-trail precedent risk inline rather than at /review re-run.
