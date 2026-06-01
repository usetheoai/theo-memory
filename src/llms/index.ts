/**
 * Barrel re-exports for `@usetheo/memory/llms`.
 *
 * @remarks
 * **Phase A** of the adapters portfolio roadmap. This barrel currently
 * exposes a single deterministic stub adapter and has no production
 * runtime callers — only smoke tests at `__tests__/exports.test.ts`. This
 * is INTENTIONAL portfolio scaffolding per ADR D4 of the source plan
 * (debug adapters NOT root-re-exported). Future cycles (openai, anthropic,
 * ollama) add their adapters here as the roadmap advances; once a
 * production adapter ships, this barrel becomes a primary import target.
 *
 * @see .claude/knowledge-base/plans/adapters-portfolio-roadmap.md
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 * @see .claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md § F-wire-3
 */
export { DeterministicStubLLM } from './stub.js';
