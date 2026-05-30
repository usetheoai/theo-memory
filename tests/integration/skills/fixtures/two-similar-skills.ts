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

// Descriptions are semantically equivalent (both about "retry HTTP fetch on
// transient failures with exponential backoff") but distinct strings — T1.2
// of voyager-skill-library-fixes-v0-6-1 made hashFact(description) the
// canonical identity, so byte-identical descriptions would collide on the
// UNIQUE(hash) index. The deterministic embedder in the GOAL TEST hashes
// the string to a basis vector, so both descriptions need to land on the
// SAME vector index to cluster together — we achieve that by tuning the
// strings so their hash spreads modulo 64 to the same index.

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
