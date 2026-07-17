/**
 * Barrel for `@usetheo/memory/adaptive-local` — the key-free default
 * AdaptiveRetrievalPolicy impl (Roadmap Item 13, ADR D5). Subpath-isolated: the
 * default `@usetheo/memory` barrel does NOT statically import this module, so
 * consumers who do not opt into adaptive retrieval pay nothing.
 *
 */
export {
  HeuristicAdaptiveRetrievalPolicy,
  type HeuristicAdaptiveRetrievalPolicyConfig,
} from './heuristic-policy.js';
