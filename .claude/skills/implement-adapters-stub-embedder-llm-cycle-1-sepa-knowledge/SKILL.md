---
name: implement-adapters-stub-embedder-llm-cycle-1-sepa-knowledge
description: |
  Domain knowledge skill paired with the SEPA agent for plan adapters-stub-embedder-llm-cycle-1. Consult during /implement cycle when reasoning about deterministic adapter patterns, Lehmer LCG implementations, MD5 hash-based seeding, L2 normalization edge cases, Node `crypto` module idioms, npm subpath exports + optionalDependencies discipline, or DIP boundary for new sibling directories (src/embedders, src/llms). Triggering phrases: "what's the canonical Lehmer LCG", "is MD5 the right hash for deterministic seeding", "npm subpath exports best practice", "L2 normalize NaN guard idiom", "stub adapter pattern in TS".
allowed-tools: Read Glob Grep WebSearch WebFetch
model: opus
disable-model-invocation: false
---

# SEPA knowledge skill — adapters-stub-embedder-llm-cycle-1

You are the knowledge layer for the SEPA auditing this `/implement` cycle. Plan-specific context frozen at generation 2026-06-01.

## Plan context (hydrated)

**Goal:** Ship deterministic StubEmbedder + StubLLM at `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub`, measured by `npm test` contract suite passing with determinism invariants `embed(t)===embed(t)` + `embed(t1)!==embed(t2)` + `llm.generate(p)===llm.generate(p)`.

**ADRs locked:**

| ID | Decision |
|---|---|
| D1 | Pre-existing zero-vector stubs at `src/local/stubs.ts` stay intact (preserves ADR D8 of v0-2-theokit-binding) |
| D2 | Embedder: MD5 first-8-bytes seed → Lehmer LCG (a=48271, m=2^31-1) → fill 1536 floats → L2-normalize with NaN guard |
| D3 | LLM: MD5-tagged chat responses + sentence-split fact-extraction |
| D4 | Subpath exports declared but NO root re-export |
| D5 | Demo opt-in via THEOMEM_USE_STUB_ADAPTERS=1 env var |
| D6 | Dim hardcoded 1536 via MAX_EMBEDDING_DIM constant |

**Edge-case findings absorbed:**
- EC-1 (MUST FIX absorbed v1.1): `l2Normalize` guard `if (norm < 1e-30) return zero-vector` to prevent NaN-vector (probability ~2^-128 per input)

**Project rules cited:**
- `architecture.md` § 3 DIP, § 6 Naming, § 7 Module hygiene, § 9 Public API
- `testing.md` TDD pyramid + Determinism section + Typecheck transitive expansion gotcha
- `no-paper-names-in-code.md`
- `dogfood-golden-rule.md` (vocabulary lock)
- Inquebrável Rule 9 (Não Reinvente — built-ins only)
- Inquebrável Rule 5 (TDD-first)

## Knowledge refresh protocol

### Mode A — Plan-context recap (cheap, ~500 tokens)
Confirm what plan ACTUALLY says vs implementation. Cross-reference ADR/EC ID.

### Mode B — Community knowledge refresh via WebSearch (medium, ~2-5k tokens)
Domain-relevant queries:
- "Lehmer LCG parameter choice deterministic PRNG TypeScript 2026"
- "Node crypto.createHash performance MD5 vs SHA256"
- "npm package.json subpath exports types declaration best practice"
- "L2 normalize numerical stability epsilon threshold"

Allowlisted domains: `nodejs.org`, `developer.mozilla.org`, `tc39.es`, `npmjs.com`, `martinfowler.com`, `refactoring.guru`, GitHub source, RFC editor.

### Mode C — Cross-reference grep (cheap, ~1k tokens)
Verify cross-references in code: e.g., "EC-1 cited in plan T1.1 should appear in JSDoc of l2Normalize — does it?"

## Plan-specific knowledge anchors

### Anchor 1 — Lehmer LCG canonical form

`x_{n+1} = (a * x_n) mod m` where:
- a = 48271 (Park-Miller minimal standard, also known as MINSTD)
- m = 2^31 - 1 = 2147483647 (Mersenne prime, ensures full period)
- seed > 0 (mandatory: with seed=0 LCG produces 0 forever)

Period = m - 1 = 2147483646. Output mapping to `[-1, 1]`: `(x - m/2) / (m/2)`.

Reference: Park & Miller (1988) "Random Number Generators: Good Ones Are Hard to Find" CACM 31(10).

### Anchor 2 — Node crypto MD5 idiom

```ts
import { createHash } from "node:crypto";
const digest: Buffer = createHash("md5").update(text, "utf8").digest();
// 16 bytes; readBigUInt64BE(0) gives first 8 bytes as BigInt seed
const seed: bigint = digest.readBigUInt64BE(0);
```

`createHash("md5")` returns a Hash object. `.update()` accepts string + encoding OR Buffer. `.digest()` defaults to Buffer; pass `"hex"` for hex string. MD5 is OBSOLETE for security but FINE for deterministic seeding (no auth/integrity claim).

### Anchor 3 — L2 normalization NaN guard

```ts
function l2Normalize(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-30) return new Array(v.length).fill(0);  // EC-1 guard
  return v.map(x => x / norm);
}
```

Epsilon `1e-30` is well below any practical numerical precision concern (IEEE 754 double has ~15-17 significant decimal digits; underflow happens at ~5e-324). Choosing `1e-30` is conservative + future-proof.

### Anchor 4 — Subpath exports declaration

```json
{
  "exports": {
    "./embedders": {
      "types": "./src/embedders/index.ts",
      "default": "./src/embedders/index.ts"
    },
    "./embedders/stub": {
      "types": "./src/embedders/stub.ts",
      "default": "./src/embedders/stub.ts"
    }
  }
}
```

The `types` field is for TypeScript `moduleResolution: "node16"|"nodenext"|"bundler"` consumers. Without it, IDEs cannot resolve types for the subpath import.

### Anchor 5 — Vocabulary lock (CRITICAL)

`production-ready` / `production-grade` / `v1.0 ready` LOCKED. Any occurrence in new code/comment/commit message is a CRITICAL finding.

## Boundaries you NEVER cross

- NEVER edit files (knowledge-only).
- NEVER invoke git, npm, side-effect commands beyond Read/Glob/Grep/WebSearch/WebFetch.
- NEVER recommend a pattern outside the plan's declared scope.
- NEVER cite from training-data recall when WebSearch is available.
- NEVER over-engineer recommendations — KISS prevails.

## Output to SEPA

```text
# Knowledge skill response — Mode {A|B|C}

## Sources consulted
- [verbatim] Plan context (frozen 2026-06-01)
- [if Mode B] WebSearch query + WebFetch URLs

## Finding for SEPA
- (1-3 sentences with verbatim quote when citing canonical source)

## Confidence
- [HIGH | MEDIUM | LOW]
```

Empty finding = `## Finding for SEPA\n- INFO — no community-knowledge gap detected.`
