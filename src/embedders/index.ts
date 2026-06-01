/**
 * Barrel re-exports for `@usetheo/memory/embedders`.
 *
 * Phase A of the adapters portfolio roadmap. Future adapters (openai, ollama,
 * huggingface, etc.) extend this barrel as their cycles ship.
 *
 * @see .claude/knowledge-base/plans/adapters-portfolio-roadmap.md
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 */
export { DeterministicStubEmbedder } from './stub.js';
