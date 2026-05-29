/**
 * Hash-based dedup for the v0.1 write pipeline.
 *
 * Behavior: MD5 of the raw text bytes (utf-8). NO normalization (case,
 * NFC/NFD, whitespace). The text input is already post-LLM-extraction;
 * adding a normalization layer here would create silent semantic drift
 * between dedup-time and prompt-time hashes — per blueprint ADR D3.
 *
 * NFC vs NFD: 'café' (precomposed, 4 codepoints) and 'café' (decomposed,
 * 5 codepoints) hash to different values. This is intentional byte-level
 * dedup matching REDACTED's behavior (EC-6).
 *
 * @see .claude/knowledge-base/discoveries/blueprints/v0-1-local-runtime-blueprint.md § D3
 * @see .claude/knowledge-base/references/REDACTED/reference TS port/src/oss/src/memory/index.ts:735
 */
import { createHash } from 'node:crypto';

export function hashFact(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex');
}
