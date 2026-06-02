# SEPA — Iteration 4 / Task T1.1 / Phase pre-RED

## Findings (verbatim, abridged)

### CRITICAL
- **C1: Post-install deps-audit re-gate is GATING.** Sequence MUST be: (1) `npm install --save-optional @xenova/transformers@^2.17.0`; (2) `npm audit --json` parse for HIGH/CRIT on sharp/onnxruntime-web/@huggingface/jinja; (3) if HIGH/CRIT surfaces → HALT iteration → loop back to /deps-audit (Stop Condition #5). Do NOT write local.ts until clean.
- **C2: L2 normalization delegated to Xenova pipeline option `{ pooling: 'mean', normalize: true }`.** Do NOT re-implement L2 in adapter (DRY vs StubEmbedder).

### MAJOR
- **M1:** Lazy singleton with Promise type — race-safe per JS single-thread invariant (sync null check + Promise assignment, mirrors OpenAI precedent).
- **M2:** Tensor → array conversion. `embed(text)` → 1D `Array.from(output.data)`. `embedBatch(texts)` → concatenated Float32Array of length `batch * dim`; slice per row.
- **M3:** Empty batch shortcut required (`if (texts.length === 0) return []`) matching OpenAIEmbedder.
- **M4:** Barrel re-export in `src/embedders/index.ts` — subpath only, not root.
- **M5:** JSDoc — no paper names; describe behavior; @see plan + ADR D1; lazy singleton + Promise type doc; --no-optional consumer guidance; first-use model download caveat; embedding dim 384.
- **M6:** Test path `src/embedders/__tests__/local.test.ts` reachable by vitest.contract.config.ts ✓.

### Suggested 7 RED tests
1. embed(text) returns unit-norm vector (L2 = 1.0 ± 1e-6)
2. embed(text) returns length === 384
3. embed('same') !== embed('different')
4. embed('same') twice returns identical vector
5. embedBatch([]) returns []
6. embedBatch(['a', 'b']) returns length-2 array, each row dim 384, rows differ
7. Two .embed() calls hit pipeline() initializer ONCE (lazy singleton)

## Decision applied by main session
1. C1 ACCEPTED — install first, audit, halt if HIGH/CRIT. Order: install → audit → RED tests → GREEN impl.
2. C2 ACCEPTED — `{ pooling: 'mean', normalize: true }` on every pipeline call.
3. All MAJOR accepted; 7 RED tests adopted.

agent_id: aeba2fad389b198ab
