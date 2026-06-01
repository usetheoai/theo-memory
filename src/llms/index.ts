/**
 * Barrel re-exports for `@usetheo/memory/llms`.
 *
 * @remarks
 * **Phase A** of the adapters portfolio roadmap. Exposes deterministic stub
 * (Cycle 1) + OpenAI (Cycle 2, MOVE-only lift from
 * `examples/chat-with-memory/lib/openai-adapters.ts`). Adapters are NOT
 * root-re-exported per ADR D4 of Cycle 1 + EC-3 of Cycle 2 — consumers go
 * through the subpath `@usetheo/memory/llms/{stub,openai}` explicitly.
 * Future cycles (anthropic, ollama, gemini, ...) add their adapters here as
 * the roadmap advances.
 *
 * @see .claude/knowledge-base/plans/adapters-portfolio-roadmap.md
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T2.1
 * @see .claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md § F-wire-3
 */
export { DeterministicStubLLM } from './stub.js';
export { OpenAILLM } from './openai.js';
