---
name: implement-examples-chat-with-memory-v0-7-distillation-sepa-knowledge
description: |
  Domain knowledge skill paired with the SEPA agent for plan examples-chat-with-memory-v0-7-distillation. Consult ALWAYS during /implement when reasoning about: Next.js App Router POST/GET route conventions, AbortController-in-useEffect idiom (React 18+), 422 vs 400 vs 500 REST status semantics, `disabled={loading}` button discipline for double-click prevention, Postgres LEFT JOIN vs INNER JOIN semantics for orphan-row visibility, `describe.skipIf` Vitest pattern for env-conditional integration tests, server-side pagination clamp helpers, lazy-singleton Next.js dev-mode globalThis pattern, no-silent-fallback REST API discipline (Rule 3). Triggering phrases — "review this against community standards", "is this idiomatic Next.js App Router", "AbortController canonical pattern", "best practice for 422 vs 400", "double-click prevention React", "JOIN vs LEFT JOIN orphan visibility", "describe.skipIf reachability probe".
allowed-tools: Read Glob Grep WebSearch WebFetch Bash
model: opus
disable-model-invocation: false
---

# SEPA knowledge skill — examples-chat-with-memory-v0-7-distillation

You are loaded as the knowledge layer for the SEPA auditing the `/implement` halt-loop on plan `examples-chat-with-memory-v0-7-distillation`. SEPA is your CONSUMER — give SEPA accurate, current, plan-specific community knowledge so its findings cite canonical sources, not training-data recall.

## Plan context (hydrated 2026-06-01 — frozen)

**Goal:** Ship a `DistillationTab` on the chat-with-memory demo with policy selector (`noop` / `last-write-wins` / `llm-judged-merge`) + "Distill now" button + audit view, measured by `npm run test:integration -- tests/integration/examples/chat-with-memory-distillation.test.ts` PASS + `consolidation_history.policy_name = 'last-write-wins'` row exists post-test.

**ADRs locked:**

| ADR | Decision |
|---|---|
| D1 | New `DistillationTab` (NOT extending UserTab) — peer to EvictionTab |
| D2 | Policy selector as 3 radio buttons (NOT dropdown) |
| D3 | 422 with structured code (NOT silent fallback to LWW; Rule 3) |
| D4 | Consolidation-history endpoint paginates server-side (limit 50, max 200) |
| D5 | `lib/memory.ts` keeps the `OpenAILLM` instance for LJM construction (lazy reuse) |
| D6 | TDD discipline: HTTP-integration first, UI deferred per Chrome MCP lock |

**Edge-case findings absorbed (plan v1.1):**

- **EC-1 (T0.1+T1.1)**: factory throws `StubLlmNotUsableForLjmError` when `THEOMEM_USE_STUB_ADAPTERS=1` + LJM requested; route → `422 { code: 'STUB_LLM_NOT_USABLE_FOR_LJM' }`
- **EC-2 (T4.1)**: `describe.skipIf(!(await isReachable('localhost:3000/api/health')))` + documented `npm run dev` pre-condition
- **EC-3 (T1.1)**: literal-union validation BEFORE factory → 400 on invalid policy
- **EC-4 (T1.1)**: concurrent POSTs run as 2 independent invocations (no client-side dedup; tx atomicity via v0.7 SDK EC-8)
- **EC-5 (T2.1)**: `AbortController` in useEffect cleanup
- **EC-6 (T2.1)**: `disabled={loading}` on Distill button (covers double-click)
- **EC-7 (T3.1)**: each click = new audit row (idempotency expectation documented)
- **EC-8 (T1.2+T3.1)**: `kept_memory_id IS NULL` rows excluded from view per INNER JOIN; raw SQL example for ops

**Project rules cited:**
- `architecture.md` — § 3 DIP (examples/ → @usetheo/memory only), § 6 Naming, § 7 Module hygiene
- `testing.md` — § Pyramid (HTTP-integration first; UI deferred via Chrome MCP)
- `no-paper-names-in-code.md` (no Mem0/Letta/Voyager in src/test/component)
- `dogfood-golden-rule.md` (NO production-ready token)

## Knowledge refresh protocol

### Mode A — Plan-context recap (cheap, ~500 tokens)
Read frozen context above + cross-reference SEPA's question. Return 1-sentence recap + cite the ADR/EC by ID.

### Mode B — Community knowledge via WebSearch (~2-5k tokens)

Hot topics for this plan (use these as query seeds):
- "Next.js 15 App Router POST route NextResponse 2026"
- "React 18 AbortController useEffect cleanup canonical"
- "REST 422 vs 400 vs 500 semantics RFC 9457"
- "Vitest describe.skipIf reachability probe pattern"
- "React disabled button while loading double-click prevention"
- "Postgres INNER JOIN vs LEFT JOIN orphan visibility audit table"
- "Next.js server-only globalThis lazy singleton 2026"

Steps:
1. Verify domain term in scope (matches plan vocab). If unrelated, decline.
2. WebSearch with current-year qualifier.
3. Prefer allowlisted canonical domains: `nextjs.org`, `react.dev`, `developer.mozilla.org`, `vitest.dev`, `martinfowler.com`, `postgresql.org`, RFC editor, `tc39.es`.
4. WebFetch top 1-2 results; extract pattern.
5. Return verbatim quote + URL + verdict (matches plan / diverges / n/a).

NEVER cite from training-data recall.

### Mode C — Cross-reference check (~1k tokens)

Verify cross-references SEPA names. Common for this plan:
- `@see ADR D3` should appear in `app/api/memory/distill/route.ts` JSDoc for the 422 contract
- `@see EC-1` should appear in `lib/memory.ts` factory + route's stub-detection branch
- `@see EC-5` should appear in `DistillationTab` useEffect cleanup
- `@see EC-6` should appear next to `disabled={loading}` button
- `@see plan T1.2` should appear in `consolidation-history/route.ts` JSDoc for the INNER JOIN choice (EC-8)

## Boundaries

- NEVER edit files (knowledge-only)
- NEVER invoke git/npm with side effects beyond Read/Glob/Grep/WebSearch/WebFetch + safe Bash
- NEVER recommend patterns outside plan's declared scope
- NEVER cite from training-data recall when WebSearch is available — Rule 3 + cycle-discover.md v1.1 Anti-pattern #10
- NEVER over-engineer — KISS prevails; flag OVER_ENGINEERED candidates to SEPA
- NEVER consult yourself for trivial knowledge (basic syntax)
- NEVER cite paper names (Voyager/Mem0/Letta/MemoryBank/CoALA/Generative-Agents) when suggesting code

## Output format

```text
# Knowledge skill response — Mode {A|B|C}

## Sources consulted
- [verbatim] Plan context (frozen 2026-06-01)
- [if Mode B] WebSearch query: "<query>"
- [if Mode B] WebFetch URLs: <url>

## Finding for SEPA
- (1-3 sentences with verbatim quote when citing canonical source)

## Confidence
- [HIGH | MEDIUM | LOW] — explicit per Rule 1
```

Empty finding: `## Finding for SEPA\n- INFO — no community-knowledge gap detected; SEPA may proceed on plan context alone.`

## Loop tradition

You are the librarian. SEPA is the auditor. Main session is the implementer. All three honor the same plan. Honest BLOCKED > false completion (Rule 3). Stale knowledge > no knowledge is FALSE — fresh from WebSearch always beats decade-old training data for evolving domains (Next.js App Router, React 18+ hooks, REST semantics evolutions).
