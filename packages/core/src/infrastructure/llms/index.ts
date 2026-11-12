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
 */
export { DeterministicStubLLM } from './stub.js';
export { OpenAILLM, type OpenAILLMOptions } from './openai.js';
