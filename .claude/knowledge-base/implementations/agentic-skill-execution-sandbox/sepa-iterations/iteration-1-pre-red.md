# SEPA pre-RED — iteration 1 — T1.1 (MODE=TIGHT)

MAJOR findings: import `../skill.js` (`.js` suffix, `import type`, NodeNext); args type = `Readonly<Record<string,unknown>>` mirrored byte-for-byte in test-d; `opts?` optional trailing param (`[..., SkillExecutionOptions?]`); `output: unknown` (NOT any); all 4 options optional `number`; barrel `export type {...}` in domain/index.ts (mirror :213 UsageCounterStore) — verify core index.ts `export *` flow (no duplicate shadow); test-d beside port imports `./skill-executor.js`; RED = module-absent typecheck error. No paper names; cite plan § T1.1 + ADR D1.

Cost note: SEPA general-purpose ~200k tokens/call. Per token-budget.md, full 3× SEPA reserved for high-risk tasks (esp. T1.3); trivial tasks fold post-GREEN into pre-COMMIT.
