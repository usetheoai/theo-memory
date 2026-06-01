/**
 * DeterministicStubLLM — debug-only LLM with pure-function determinism.
 *
 * Three contract surfaces per plan ADR D3:
 *   - `generateChat(messages)` returns `{ content: "stub-response:<hex>",
 *     role: "assistant" }` where `<hex>` is the 4-char hex prefix of
 *     `MD5(JSON.stringify(messages))`. Same input → same tag.
 *   - `generateResponse(messages, {type:'json'})` returns JSON conforming to
 *     `AdditiveExtractionSchema` from `src/core/extraction/prompt.ts:89`:
 *     `{ memory: [{ id: "1"|"2"|"3", text: <sentence> }, ...] }`. Up to 3
 *     entries derived from concatenated user-role content split on sentence
 *     terminators (`.!?`). If no terminators are present, the whole content
 *     is one entry. If no user content is present, `{ memory: [] }`.
 *   - `generateResponse(messages, {type:'text'})` mirrors `generateChat`'s
 *     CONTENT field but returns a DIFFERENT shape `{ text: string }` (not
 *     `{ content, role }`). **F-arch-6 absorption:** the shape divergence
 *     is INTENTIONAL — `generateResponse` is the DIP signature for
 *     extraction-style calls returning structured data, so its return
 *     shape varies per `responseFormat.type`. Consumers reading
 *     `(await generateResponse(_, { type: 'text' })).text` get the same
 *     string as `(await generateChat(_)).content` — just a different field
 *     name. Asserted in `__tests__/stub.test.ts` regex-locked by
 *     STUB_CONTENT_RE.
 *
 * The `tools?` parameter is part of the DIP signature (per
 * `src/core/dip/llm.ts:22-26`) but stub behavior is `tools`-independent.
 *
 * **F-arch-8 absorption (i18n caveat):** `SENTENCE_SPLIT_RE = /[.!?]+\s+/`
 * is Latin-script-only. CJK punctuation (`。`, `！`, `？`), Arabic
 * punctuation (`؟`), and other non-Latin terminators are NOT matched. For
 * F-T4.1-2 debug (English-language test inputs) this is sufficient; the
 * production OpenAI adapter handles arbitrary text via the LLM itself.
 *
 * @experimental — debug only. Sentence-split pseudo-extraction is sufficient
 *   for F-T4.1-2 race-condition reproducibility but not for actual recall.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T1.2
 * @see src/core/extraction/prompt.ts § AdditiveExtractionSchema
 * @see .claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md § F-arch-6 + F-arch-8
 */
import { createHash } from 'node:crypto';

import type { LLM } from '../core/dip/llm.js';
import type { LLMResponse, Message } from '../core/message.js';

const MAX_EXTRACTION_FACTS = 3;
/** Sentence terminators per common English convention. */
const SENTENCE_SPLIT_RE = /[.!?]+\s+/;
/**
 * F-dom-memory-2 absorption: production call site at
 * `src/core/extraction/pipeline.ts:230` passes a SINGLE synthetic user-role
 * message whose `.content` is `messages.map((m) => `${m.role}: ${m.content}`).join('\n')`.
 * Stripping the line-anchored role prefix BEFORE sentence-split prevents
 * dedup-hash pollution when stub is wired through pipeline.ts paths.
 *
 * EC-9 absorption (best-effort caveat): legitimate prose containing
 * `user:` / `assistant:` / `system:` at line-start (e.g., quoting chat logs)
 * WILL be affected. Acceptable because the stub is `@experimental — debug
 * only`; the production OpenAI adapter does NOT apply this heuristic.
 */
const ROLE_PREFIX_RE = /^(?:user|assistant|system):\s+/gim;

function tagFromMessages(messages: readonly Message[]): string {
  const serialized = JSON.stringify(messages);
  return createHash('md5').update(serialized, 'utf8').digest('hex').slice(0, 4);
}

function concatUserContent(messages: readonly Message[]): string {
  const joined = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');
  return joined.replace(ROLE_PREFIX_RE, '');
}

function extractFacts(text: string): readonly { id: string; text: string }[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  const sentences = trimmed
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.replace(/[.!?]+\s*$/, '').trim())
    .filter((s) => s !== '');
  const candidates = sentences.length === 0 ? [trimmed] : sentences;
  return candidates.slice(0, MAX_EXTRACTION_FACTS).map((text, i) => ({
    id: String(i + 1),
    text,
  }));
}

function chatContent(tag: string): string {
  return `stub-response:${tag}`;
}

export class DeterministicStubLLM implements LLM {
  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract returns Promise; pure-function impl
  async generateChat(messages: readonly Message[]): Promise<LLMResponse> {
    return {
      content: chatContent(tagFromMessages(messages)),
      role: 'assistant',
    };
  }

  async generateResponse(
    messages: readonly Message[],
    responseFormat?: { readonly type: 'json' | 'text' },
    _tools?: readonly unknown[],
  ): Promise<unknown> {
    void _tools;
    if (responseFormat?.type === 'json') {
      return { memory: extractFacts(concatUserContent(messages)) };
    }
    // Default + 'text' type mirror generateChat's textual output.
    const tag = tagFromMessages(messages);
    return await Promise.resolve({ text: chatContent(tag) });
  }
}
