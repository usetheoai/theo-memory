/**
 * LLM-importance scoring per plan v0-4a-reflection-pipeline § T5.1 + ADR D8.
 *
 * Calls the LLM with a small prompt asking for a 1-10 importance rating;
 * parses the response into a number; clamps to [1, 10]; throws
 * ImportanceScoringError on unparseable responses.
 *
 * Cache discipline: scores are persisted on the `memories.llm_importance_score`
 * column at write time, in [0, 1] (`normalizeImportanceRating`). T5.2 adds the hash-keyed cache lookup that skips this
 * function when an identical-content memory already has a cached score.
 *
 * EC-16 (cache invalidation on prompt version bump): out of scope for v0.4a.
 * When IMPORTANCE_PROMPT_VERSION bumps in a future release, the release PR
 * MUST include a migration `UPDATE memories SET llm_importance_score = NULL;`
 * OR an explicit ADR explaining why old scores remain acceptable. Tracked
 * as F-importance-prompt-versioning.
 *
 */
import type { LLM } from '../dip/llm.js';
import { ImportanceScoringError } from '../errors.js';

/** Prompt version. Bump on prompt-shape change. See EC-16 for invalidation policy. */
export const IMPORTANCE_PROMPT_VERSION = '1.0';

const IMPORTANCE_PROMPT_SYSTEM =
  'You are an importance rater for a personal memory system.' +
  ' Given a memory, rate its likely future relevance on a 1-10 scale' +
  ' (1 = trivial detail, 10 = critical long-term fact). Reply with JUST the number.';

/**
 * Parse a number from the LLM response.
 *
 * Strategy: extract the FIRST contiguous run of digits (with optional decimal)
 * from the response. Tolerates surrounding text like "Importance: 7" or
 * "approximately 8 out of 10".
 */
function parseScore(raw: string): number {
  const trimmed = raw.trim();
  const match = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (match === null) {
    throw new ImportanceScoringError(raw, 'no number found in response');
  }
  const matchStr = match[1];
  if (matchStr === undefined) {
    throw new ImportanceScoringError(raw, 'no number found in response');
  }
  const parsed = Number.parseFloat(matchStr);
  if (Number.isNaN(parsed)) {
    throw new ImportanceScoringError(raw, `parsed value is NaN: "${matchStr}"`);
  }
  return parsed;
}

/**
 * Score the importance of a memory text. Returns a number in [1, 10] (clamped).
 *
 * @throws ImportanceScoringError when the LLM response has no parseable number
 */
export async function scoreImportance(text: string, llm: LLM): Promise<number> {
  const response = await llm.generateChat([
    { role: 'system', content: IMPORTANCE_PROMPT_SYSTEM },
    { role: 'user', content: text },
  ]);
  const raw = response.content;
  const parsed = parseScore(raw);
  // Clamp to [1, 10]
  return Math.max(1, Math.min(10, parsed));
}

/**
 * Hash-keyed importance score cache (T5.2 + ADR D8).
 *
 * Looks up `store.getImportanceByHash(hash)`; on hit returns the cached score
 * WITHOUT invoking the LLM. On miss, rates via `scoreImportance`, maps the rating
 * to [0, 1] with `normalizeImportanceRating`, persists it via
 * `store.setImportanceByHash`, and returns it.
 *
 * CLAUDE.md Item 5 acceptance verbatim: "LLM-importance score persisted on
 * first write; second-write same content does NOT re-invoke LLM."
 *
 * Wiring into the v0.1 extraction pipeline (`runExtractionPipeline`) is
 * DEFERRED to F-importance-pipeline-wiring followup — this helper is the
 * load-bearing primitive; pipeline integration is a downstream consumer.
 */
/**
 * Map a 1-10 rating onto the [0, 1] importance that `memories.llm_importance_score` holds and
 * `TriadicScoringPolicy` reads (`MemoryItem.llmImportanceScore`). Ratings outside [1, 10] are
 * clamped first. Storing the raw rating let importance outweigh recency and frequency together
 * and stretched half-lives up to 29 times the base (#239).
 */
export function normalizeImportanceRating(rating: number): number {
  return (Math.max(1, Math.min(10, rating)) - 1) / 9;
}

/** Stores importance in [0, 1] keyed by content hash. */
export interface ImportanceCacheStore {
  getImportanceByHash(hash: string): Promise<number | null>;
  setImportanceByHash(hash: string, score: number): Promise<void>;
}

export async function scoreAndCacheImportance(
  text: string,
  hash: string,
  store: ImportanceCacheStore,
  llm: LLM,
): Promise<number> {
  const cached = await store.getImportanceByHash(hash);
  if (cached !== null) {
    return cached;
  }
  const score = normalizeImportanceRating(await scoreImportance(text, llm));
  await store.setImportanceByHash(hash, score);
  return score;
}
