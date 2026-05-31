/**
 * Fixture for THE GOAL TEST (T5.1): two semantically-equivalent skills with
 * syntactically-different implementations. Both express "retry an HTTP request
 * on transient failures with exponential backoff".
 *
 * The descriptions are tuned so a stub LLM can recognize them as a cluster +
 * emit a deterministic merged draft citing both source ids.
 */
export interface SkillFixture {
  readonly code: string;
  readonly description: string;
  readonly codeLanguage: 'typescript' | 'javascript';
}

// LOAD-BEARING INVARIANT — do not edit the two descriptions below without
// re-tuning both halves of the chain. Two opposing constraints must hold
// simultaneously:
//
//   (1) DISTINCT strings. T1.2 of voyager-skill-library-fixes-v0-6-1 made
//       hashFact(description) the canonical row hash. Byte-identical
//       descriptions collide on the UNIQUE(hash) index at insert time, so
//       the second add() would throw before the consolidate phase runs.
//
//   (2) SAME modulo-64 basis-vector bucket. The deterministic FixtureEmbedder
//       in tests/integration/skills/consolidate-two-skills.test.ts hashes
//       each description and sets `vector[hash % 64] = 1`. The cluster
//       phase needs both source skills to land on the SAME vector index;
//       otherwise sourceClusters.length stays at 0 and the GOAL TEST fails.
//
// The two strings below ('plain fetch:' and 'via axios:') were selected so
// `(hash(s) % 64) === 58` for both, while their full byte content differs.
// If either string is edited, recompute the bucket with the same hash recipe
// (`h = (h * 31 + charCode) >>> 0; bucket = h % 64`) and confirm both halves
// still land on the same index BEFORE running the GOAL TEST.

export const SKILL_FETCH: SkillFixture = {
  code: `export async function retryFetch(url: string, max = 3): Promise<Response> {
  for (let attempt = 0; attempt < max; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (err) {
      if (attempt === max - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
  }
  throw new Error('retryFetch: all attempts failed');
}`,
  description: 'plain fetch: retry HTTP request on transient failures with exponential backoff',
  codeLanguage: 'typescript',
};

export const SKILL_AXIOS: SkillFixture = {
  code: `import axios from 'axios';
export async function retryAxios(url: string, max = 3) {
  for (let attempt = 0; attempt < max; attempt += 1) {
    try {
      return await axios.get(url);
    } catch (err) {
      if (attempt === max - 1) throw err;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
    }
  }
}`,
  description: 'via axios: retry HTTP request on transient failures with exponential backoff',
  codeLanguage: 'typescript',
};
