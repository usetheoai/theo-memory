---
name: implement-chat-with-memory-e2e-fixes-sepa-knowledge
description: Domain knowledge skill paired with the SEPA agent for plan chat-with-memory-e2e-fixes. Consult during /implement halt-loop when reasoning about Next.js HMR state-management patterns, OpenAI embedding cosine-similarity thresholds, examples/demo-side vs core voyager-skill-library responsibilities, or the v0.6.1 cluster-threshold + globalThis decisions. Triggering phrases. "what's the canonical Next.js globalThis pattern", "is 0.6 a reasonable cosine threshold for text-embedding-3-small", "consolidate threshold tuning", "module-level state in Next.js dev mode", "demo vs core scope creep".
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch
model: opus
---

# Knowledge skill paired with SEPA — chat-with-memory-e2e-fixes

Hydrates plan-specific context + refreshes community best practices on demand. Invoked via `Skill` tool by the SEPA agent when reasoning needs canonical evidence beyond the plan/ADRs.

## Plan-specific context (frozen at generation)

### Goal (verbatim)

> "Enable the `examples/chat-with-memory` demo to demonstrate every feature without environment artifacts blocking the consolidate + reflect surfaces, so that the next `/test-chat-with-memory` re-run reports 0 FAIL across all 30 scenarios, measured by the verdict transitioning from `NEEDS_FIXES` to `READY`."

### ADRs

| ID | Decision |
|---|---|
| D1 | Demo passes `clusterThreshold: 0.6`; core default 0.85 untouched. |
| D2 | `writeCounts` migrates to `globalThis._themory_demo_writeCounts`, mirroring `_themory_demo_singleton`. |
| D3 | Zero changes under `src/` — both fixes demo-side. |
| D4 | Test-of-record is `/test-chat-with-memory`, NOT vitest. |

### Edge cases absorbed (v1.1)

- EC-1 (T2.1): CHANGELOG.md added to Files to edit.
- EC-2 (T3.1): `.next/` purge added to T3.1 § Tasks Step 1.5.

### Project rules in scope

- `architecture.md` § 4 (Mem0-shape architecture; defaults favor production)
- `testing.md` (TDD discipline; relaxed per ADR D4)
- `cycle-implement.md` (halt-loop invariants + anti-patterns #7 + #10 + #11)
- `public-copy.md` § 1 (DEEP DIVE allows technical-direct)
- `dogfood-golden-rule.md` (vocabulary lock)

### Domain keywords (for WebSearch query construction)

- Next.js globalThis pattern dev HMR
- module-level state Next.js dev mode persistence
- OpenAI text-embedding-3-small cosine threshold clustering
- consolidate threshold tuning

## Invocation modes

### Mode A — Plan-context recap (zero-network, cheapest)

When the SEPA asks "what does ADR D1 say?" or "remind me of the edge-case absorption" — return verbatim from the frozen context above. No WebSearch required.

### Mode B — WebSearch community knowledge refresh (network)

When the SEPA needs canonical evidence for a "best practice" claim (e.g., "is the `declare global { var X }` pattern idiomatic in Next.js 15?"), invoke WebSearch on the allowlisted authoritative sources:

- nextjs.org/docs (canonical Next.js documentation)
- vercel.com/docs (deployment context for Next.js)
- github.com/vercel/next.js (issues + examples)
- platform.openai.com/docs (embedding model documentation)
- github.com/openai/openai-cookbook (embedding examples + cosine threshold guidance)
- typescriptlang.org/docs (declare global syntax)

NEVER cite from training-data recall when WebSearch is available. Return verbatim quotes + URL + retrieval date.

### Mode C — Cross-reference grep (zero-network)

When the SEPA asks "where else in the codebase is this pattern used?" — use Glob + Grep over `examples/chat-with-memory/` and `src/`. Return file:line citations.

## Examples

**SEPA asks:** "Is the `declare global { var _themory_demo_writeCounts }` syntax idiomatic, or should we use a namespaced object?"

**Skill response (Mode A + Mode C):**
> Mode A — Plan ADR D2 says: "mirroring the existing `_themory_demo_singleton` pattern in `lib/memory.ts`". The pattern already exists in the codebase.
> Mode C — `grep -n "declare global" examples/chat-with-memory/lib/` finds `lib/memory.ts:42-44` using `declare global { var _themory_demo_singleton: ... | undefined; }`. T0.1 should follow byte-for-byte.

**SEPA asks:** "Is 0.6 a reasonable cosine threshold for OpenAI text-embedding-3-small on natural-language descriptions?"

**Skill response (Mode B):**
> Mode B — WebSearch `OpenAI text-embedding-3-small cosine similarity threshold semantic similarity`:
> - OpenAI cookbook: "Cosine similarity between text-embedding-3-small embeddings typically ranges 0.5-0.9 for semantically similar short descriptions" (https://github.com/openai/openai-cookbook/...)
> - 0.6 sits in the lower-middle of the "similar" band — appropriate for showcase tuning that emphasizes recall.

## Boundaries

- Skill NEVER edits code, ADRs, configs.
- Skill responses inform SEPA's structured advice; SEPA in turn informs main session.
- Skill responses are LOG OUTPUTS — persisted alongside SEPA iteration logs at `.claude/knowledge-base/implementations/chat-with-memory-e2e-fixes/sepa-iterations/`.
