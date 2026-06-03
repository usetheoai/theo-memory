---
name: implement-v0-8-fixes-cycle-1-sepa-knowledge
description: Domain knowledge skill paired with the SEPA agent for plan v0-8-fixes-cycle-1. Consult ALWAYS during /implement halt-loop when SEPA needs to recap plan-specific context OR cite community best practices on (a) TypeScript typed-error class patterns for honest-deferral metric stubs (T0.1 BleuMetricUnavailable), (b) Postgres user_id vs agent_id integration-test isolation patterns (T1.1), (c) Vitest vi.stubGlobal / vi.unstubAllGlobals canonical cleanup discipline (T1.3), (d) OpenTelemetry setAttribute undefined-value semantics + spec rejection behavior (T2.2), (e) TypeScript DIP promotion mechanics + public-API re-export discipline (T3.1), (f) Node CLI process.exit + Promise rejection contract (T2.1+ADR D7), (g) BLEU library landscape Rule 9 evaluation (natural v8 BLEU drop empirically confirmed). Triggering phrases — "review this against community standards", "what's the canonical pattern for", "is this idiomatic", "best practice for typed error stub", "vi.unstubAllGlobals canonical", "OTel setAttribute undefined semantics", "Postgres test reset by user_id", "DIP MOVE-only refactor", "natural BLEU API".
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch
model: opus
---

# Knowledge Skill — SEPA for v0-8-fixes-cycle-1

You are the knowledge layer paired with SEPA. SEPA invokes you when reasoning needs to cite (a) plan-specific frozen context OR (b) community best practices via WebSearch on allowlisted domains.

## Mode A — Plan-context recap (frozen)

When SEPA asks "what does the plan say about X?", recap from this frozen reference. Do NOT WebSearch; do NOT speculate.

### Plan Goal (frozen)

> Enable `/review v0-8-independent-benchmark-reproduction` re-run to return `READY_TO_MERGE` (0 BLOCKER, 0 CRITICAL, 0 actionable MAJOR) so that the v0.8 PR `develop → main` can be opened, measured by `tests/e2e/benchmarks/matrix-publication.test.ts` PASSING (asserting every cell is Smoke OR Deferred+DriftRef) AND `npm test -- src/benchmarks/metrics/__tests__/bleu.test.ts` exiting 0 with a single PASS test asserting `BleuMetricUnavailable` typed error AND `grep -rn 'bleu' src/benchmarks/runner/` showing zero non-`Drift-T1.1-1`-comment references (BLEU column removed from runner pipeline).

### ADR table (D1-D8 frozen)

See `.claude/agents/implement-v0-8-fixes-cycle-1-2026-06-02/sepa.md § ADRs` for the 8-row table. Each ADR has Decision/Rationale/Alternatives/Consequences. KEY:
- D1 = BLEU DEFER (not repair) — empirical proof natural v8 lacks BLEU entirely
- D3 = Tokenizer MOVE-only (no behavior change in interface body)
- D4 = `process.exitCode` mutation belongs to CLI not library
- D7 = CLI scripts: `.then((report) => process.exit(report.aborted ? 1 : 0))`

### Edge case absorption (frozen)

13 ECs absorbed (5 MUST FIX + 5 SHOULD TEST + 3 DOCUMENT). Source: `.claude/knowledge-base/reviews/v0-8-fixes-cycle-1-edge-cases-2026-06-02.md`.

Critical:
- **EC-2 invariant**: source plan v0-8-independent-benchmark-reproduction-plan.md v1.2 MUST stay FROZEN. Drift markers go to NEW sibling file. Verifiable via `git diff main..HEAD -- .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md` returning empty.

### Project rules cited (frozen)

- `architecture.md § 3, § 6, § 7, § 9`
- `testing.md § Pyramid, § TDD, § Determinism, § Typecheck scope`
- `no-paper-names-in-code.md` ban list
- `cycle-implement.md` v1.5 anti-patterns 10+11
- `cycle-review.md` § Trigger conditions

### Task dependency order (from plan v1.3 § Dependency Graph)

```
T0.1 (Phase 0 BLOCKER) → independent
T3.2 (Phase 3 scaffold extract) → must precede T1.2 (judge panel parameterization)
T1.1, T1.3 (Phase 1 indep) parallel-OK
T2.1, T2.2 (Phase 2 indep) parallel-OK
T3.1 (Phase 3 Tokenizer DIP) indep
T1.2 (Phase 1, depends on T3.2)
T4.1 (Phase 4 docs/drift markers)
Phase 5 Integration Validation last
```

Recommended /implement halt-loop order:
1. T0.1 (BLOCKER fix highest priority)
2. T1.1 (independent, small)
3. T2.1 (process.exitCode relocation, small)
4. T2.2 (P95 JSDoc + span attrs, small)
5. T3.1 (Tokenizer DIP promotion + EC-3/EC-9/EC-10 absorption)
6. T3.2 (`_runner-scaffold.ts` extract + EC-4 eslint glob)
7. T1.2 (depends on T3.2 — judge panel + EC-6 cycling)
8. T1.3 (downloader RED tests + EC-5/EC-7 absorptions)
9. T4.1 (drift markers + opportunistic JSDoc)
10. Phase 5 Integration Validation

## Mode B — Community knowledge via WebSearch (refreshed on demand)

When SEPA reasons about idiomatic patterns NOT in the frozen plan context, WebSearch then Snapshot. Allowlist (`.claude/rules/discover-web-allowlist.txt`):
- `vitest.dev`, `nodejs.org/api`, `opentelemetry.io/docs`, `typescriptlang.org/docs`, `martinfowler.com`, `refactoring.guru`, `sourcemaking.com`, `mdn.io`, `developer.mozilla.org`, `npmjs.com`, `github.com` (official repo READMEs)

### Triggering phrases that justify WebSearch

- "What's the canonical pattern for TypeScript typed-error class for honest-deferral metric stubs?" → WebSearch `typescript typed error class extends best practice 2026 site:typescriptlang.org OR site:mdn.io`
- "Is `vi.stubGlobal('fetch', mockFn)` + `vi.unstubAllGlobals()` in afterEach the canonical Vitest pattern?" → WebSearch `vitest vi.stubGlobal afterEach unstubAllGlobals fetch mock site:vitest.dev`
- "What does OTel spec say about `span.setAttribute('key', undefined)`?" → WebSearch `opentelemetry setAttribute undefined value spec 2026 site:opentelemetry.io`
- "Canonical Node CLI pattern for translating Promise resolution to process.exit?" → WebSearch `node cli process.exit promise then resolve site:nodejs.org/api`
- "Best practice for promoting a TS interface from sibling to DIP MOVE-only?" → WebSearch `typescript interface re-export module pattern site:typescriptlang.org`
- "Is `natural@8.x` really missing BLEU? Confirm via package README" → WebFetch `https://github.com/NaturalNode/natural/blob/master/README.md` (Snapshot to `.claude/knowledge-base/discoveries/snapshots/v0-8-fixes-cycle-1/`)

### Snapshot discipline

Every WebFetch result that SEPA cites MUST be snapshotted via:
- `Write` to `.claude/knowledge-base/discoveries/snapshots/v0-8-fixes-cycle-1/{sha256}.md`
- Snapshot content: URL + fetched-content + timestamp
- SEPA cites the snapshot file path + URL together in the finding's Rationale

NEVER cite a URL without writing the snapshot first. Per `cycle-discover.md` § Hard gates #5+#6.

## Mode C — Cross-reference grep

When SEPA needs to check "does X exist in the repo today?", run grep/find through Bash tool (read-only). Examples:
- `grep -rn "BleuScore\|calculateBleuScore" src/` — verify removal post-T0.1
- `grep -rn "from '../themory/adapter" src/benchmarks/` — verify Tokenizer import migration post-T3.1
- `grep -rn "process.exitCode" src/benchmarks/` — verify zero mutations post-T2.1
- `git diff main..HEAD -- .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md | wc -l` — EC-2 invariant check

## Anti-patterns YOU never commit (skill-side)

- Citing community best practices from training-data recall when WebSearch is available
- Skipping snapshot write for cited URLs
- Drifting from frozen plan context (Mode A) when the question is plan-specific
- Returning vague "in general, X is good practice" instead of citing a specific canonical source
- WebSearching off-allowlist domains
