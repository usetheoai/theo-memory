/**
 * Barrel re-exports for `@usetheo/memory/embedders`.
 *
 * @remarks
 * **Phase A** of the adapters portfolio roadmap. Exposes deterministic stub
 * (Cycle 1) + OpenAI (Cycle 2, MOVE-only lift from
 * `examples/chat-with-memory/lib/openai-adapters.ts`). Adapters are NOT
 * root-re-exported per ADR D4 of Cycle 1 + EC-3 of Cycle 2 — consumers go
 * through the subpath `@usetheo/memory/embedders/{stub,openai}` explicitly.
 * Item 24 adds three fetch-based adapters (ollama / voyage / google — zero new
 * dependency) to this kitchen-sink barrel for parity. The string-keyed
 * `createEmbedder` registry is DELIBERATELY NOT re-exported here: it lives only
 * at `@usetheo/memory/embedders/registry` so its bundle-isolation guarantee
 * (no static SDK pull) is the single path — re-exporting it from this barrel
 * (which statically pulls the openai/local SDKs) would defeat that guarantee.
 *
 * @see .claude/knowledge-base/plans/adapters-portfolio-roadmap.md
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T2.1
 * @see .claude/knowledge-base/plans/adapters-openai-cycle-2-plan.md § T2.1
 * @see .claude/knowledge-base/plans/embedder-registry-plan.md § T2.1-T2.3 + ADR D4
 * @see .claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md § F-wire-3
 */
export { DeterministicStubEmbedder } from './stub.js';
export { OpenAIEmbedder } from './openai.js';
export { LocalTransformerEmbedder } from './local.js';
export { OllamaEmbedder } from './ollama.js';
export type { OllamaEmbedderOptions } from './ollama.js';
export { VoyageEmbedder } from './voyage.js';
export type { VoyageEmbedderOptions } from './voyage.js';
export { GoogleEmbedder } from './google.js';
export type { GoogleEmbedderOptions } from './google.js';
