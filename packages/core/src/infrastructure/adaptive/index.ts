/**
 * Barrel for `@usetheo/memory/adaptive-local` — the key-free default
 * AdaptiveRetrievalPolicy impl (Roadmap Item 13, ADR D5). Subpath-isolated: the
 * default `@usetheo/memory` barrel does NOT statically import this module, so
 * consumers who do not opt into adaptive retrieval pay nothing.
 *
 * @see .claude/knowledge-base/plans/adaptive-retrieval-plan.md § ADR D5 + T4.1
 */
export {
  HeuristicAdaptiveRetrievalPolicy,
  type HeuristicAdaptiveRetrievalPolicyConfig,
} from './heuristic-policy.js';
