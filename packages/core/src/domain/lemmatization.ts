/**
 * BM25 token preprocessing for the v0.1 retrieval pipeline.
 *
 * Pipeline: lowercase → split on /\W+/ → drop STOP_WORDS → stem.
 *
 * Stemmer selection: tries to load the optional peer `natural` (Porter
 * stemmer, BM25 industry standard). When `natural` is absent (consumers
 * who opted out of the optional install), falls back to in-house
 * `simpleStem` — a suffix-rule stemmer of ~80 % quality for English.
 *
 * STOP_WORDS is English-only at v0.1 (EC-7: Portuguese / other languages
 * pass through unaltered). Multilingual support deferred to v0.2+.
 *
 */

// Try to load `natural` (optional peer). Use createRequire for CommonJS interop
// without bringing it into the bundle when not installed.
import { createRequire } from 'node:module';

interface NaturalModule {
  readonly PorterStemmer: { stem(word: string): string };
}

let naturalModule: NaturalModule | null = null;
try {
  const req = createRequire(import.meta.url);
  // Load the Porter stemmer from its own module. The package entry point pulls in
  // natural's storage plugins, which call `require('dotenv').config()` on load and
  // would copy the consumer's `.env` into `process.env`.
  naturalModule = { PorterStemmer: req('natural/lib/natural/stemmers/porter_stemmer') as NaturalModule['PorterStemmer'] };
} catch {
  naturalModule = null;
}

/**
 * Minimum English stop-word set ported from the upstream reference. Set lookup is O(1).
 * Extend at v0.2+ for multilingual support.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'do', 'does', 'doing', 'don', 'for', 'from', 'further', 'had', 'has', 'have',
  'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me',
  'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 's', 'same', 'she', 'should', 'so', 'some', 'such', 't', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until',
  'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'will', 'with', 'you', 'your', 'yours', 'yourself',
  'yourselves',
]);

/**
 * In-house suffix-rule stemmer for English when `natural` is not installed.
 * ~80 % stem quality vs Porter. Used as fallback only.
 */
export function simpleStem(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length <= 1) {
    return lower;
  }
  // 'ing' suffix (e.g., running -> runn)
  if (lower.length > 4 && lower.endsWith('ing')) {
    return lower.slice(0, -3);
  }
  // 'ly' suffix (e.g., quickly -> quick)
  if (lower.length > 3 && lower.endsWith('ly')) {
    return lower.slice(0, -2);
  }
  // 'ed' suffix (e.g., walked -> walk)
  if (lower.length > 3 && lower.endsWith('ed')) {
    return lower.slice(0, -2);
  }
  // trailing 's' but preserve 'ss' (e.g., cats -> cat, pass -> pass)
  if (lower.length > 2 && lower.endsWith('s') && !lower.endsWith('ss')) {
    return lower.slice(0, -1);
  }
  return lower;
}

function stem(word: string): string {
  if (naturalModule !== null) {
    return naturalModule.PorterStemmer.stem(word);
  }
  return simpleStem(word);
}

/**
 * Tokenize + drop stop words + stem. Returns the BM25-ready token array.
 * Order of input tokens is preserved (BM25 ignores order, but tests assert presence).
 */
export function lemmatizeForBm25(text: string): readonly string[] {
  const tokens = text.toLowerCase().split(/\W+/).filter((tok) => tok.length > 0);
  const out: string[] = [];
  for (const tok of tokens) {
    if (STOP_WORDS.has(tok)) {
      continue;
    }
    out.push(stem(tok));
  }
  return out;
}
