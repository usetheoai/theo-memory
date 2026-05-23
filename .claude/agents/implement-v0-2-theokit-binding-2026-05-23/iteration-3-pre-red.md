# SEPA — Iteration 3 / Task T1.1 / Phase pre-RED

## Findings (condensed)
- Verified files: index.ts NEW, memory-from-ctx.test.ts NEW; types.ts (T0.2) exports ScopedContext cleanly.
- Imports: Memory/ScopedMemory from `../core/memory-store.js`; MissingScopeError from `../core/errors.js`; ScopedContext from `./types.js`. ESM `.js` extensions required.
- JSDoc MUST include EC-11 (future-tier deferral) + EC-12 (runtime no-check on memory param) verbatim per plan.
- Barrel re-exports: memoryFromCtx + type ScopedContext + MissingScopeError → single consumer import.
- Mock pattern: `vitest-mock-extended` `mock<Memory>()` gives auto-typed spies.
- Boundary: theokit/index.ts imports from ../core/ ONLY.
- Allowlist src/theokit/** symbol_fab active until 2026-06-22.

## Watch-outs
- EC-7 mutation test: use `structuredClone(ctx)` then deep-equal (NOT JSON.stringify — loses undefined distinction).
- EC-3 `any`-escape test: `as unknown as ScopedContext` double-cast required.
- State-c canonical message: "session-bearing TheoKit context" (covers EC-3, EC-6, empty, undefined userId).
- State-b canonical message: "authenticated session required".
- Spy assertion: `memory.user` called once with userId, returned chain wired via mockReturnValue.

## Proceed to RED.
