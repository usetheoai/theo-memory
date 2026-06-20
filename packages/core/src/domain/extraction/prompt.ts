/**
 * Additive-extraction LLM prompt composer + Zod response schema +
 * markdown-header escape — T4.1 of v0-1-local-runtime plan v1.3.
 *
 * Composes the prompt sent to the LLM during the Phase 4 extraction pipeline.
 * Existing memories rendered with sequential integer IDs (1, 2, ...) to keep
 * the LLM token-count low + reduce UUID hallucination (blueprint Recommendation 5);
 * `uuidByInt` maps those integers back to the real UUIDs at response-resolution time.
 *
 * EC-4 defense: user-controlled text (existing-memory text + new-message content)
 * is passed through `escapeMarkdownHeaders` BEFORE template interpolation. A line
 * starting with `## ` becomes `\#\# ` so the LLM cannot mistake injected user
 * text for an authoritative section header.
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T4.1 + EC-4
 * @see .claude/knowledge-base/references/REDACTED/reference TS port/src/oss/src/prompts/ (REDACTED reference prompt)
 */
import { z } from 'zod';

import type { MemoryItem } from '../memory-item.js';
import type { Message } from '../message.js';

/**
 * Escape line-start markdown headers in user-controlled text.
 * Replaces `^## ` (start-of-line) with `\#\# ` — defeats prompt injection where
 * user text contains a fake section delimiter that the LLM might trust.
 */
export function escapeMarkdownHeaders(text: string): string {
  return text.replace(/^##\s/gm, '\\#\\# ');
}

const SYSTEM_PROMPT = [
  'You are a memory extractor for a long-term agent memory system.',
  'Given existing memories (numbered for reference) and new conversation messages,',
  'output JSON with new facts to persist. Use the integer ids — FORMATTED AS JSON STRINGS,',
  'e.g. "1", "2" (with quotes) — in `linked_memory_ids` when a new fact references or',
  'relates to an existing memory. NEVER emit `linked_memory_ids` as bare numbers; the',
  'array MUST contain quoted string elements.',
  '',
  '`attributed_to` is the perspective owner of the fact — the peer ID it belongs to.',
  'Accept ARBITRARY string values: a user id, agent id, "system" for self-statements,',
  'or any peer identifier supplied in conversation context. NOT restricted to a fixed',
  'vocabulary.',
  '',
  'Also include `entities`: the distinct named entities mentioned in the text — people,',
  'organizations, places, products, and salient concepts — each `{ "name": "<entity>",',
  '"type": "<PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER>" }`. These are the graph NODES.',
  'Extract a node for every entity that participates in a stated fact; omit pure filler.',
  '',
  'Also include `relations`: factual triples connecting those entities — each',
  '`{ "source": "<entity>", "relationship": "<verb phrase>", "destination": "<entity>" }`.',
  'Use the entity SURFACE NAMES exactly as they appear (not ids). Be generous: emit a',
  'relation for every stated link between two entities (employment "works at", location',
  '"lives in"/"located in", usage "uses"/"built with", composition "part of", membership',
  '"member of", education "studied at", ownership/acquisition "acquired"/"owns", reporting',
  '"reports to"). Omit `entities`/`relations` only when the text genuinely has none.',
  '',
  'LANGUAGE: detect the language of the input and emit every entity and relation SURFACE',
  'NAME in the ORIGINAL language and script. NEVER translate or transliterate, and PRESERVE',
  'all accents/diacritics (keep "São Paulo", "José", "Müller" — never "Sao Paulo", "Jose").',
  '',
  'Output format (strict JSON, no prose):',
  '{ "memory": [{ "id": "<seq>", "text": "<fact>", "attributed_to": "<peer-id>", "linked_memory_ids"?: ["1", "2"] }],',
  '  "entities"?: [{ "name": "<entity>", "type": "<PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER>" }],',
  '  "relations"?: [{ "source": "<entity>", "relationship": "<verb phrase>", "destination": "<entity>" }] }',
].join('\n');

function renderExistingMemories(existing: readonly MemoryItem[]): string {
  if (existing.length === 0) {
    return '';
  }
  const lines = existing.map((m, i) => `${i + 1}. ${escapeMarkdownHeaders(m.text)}`);
  return `## Existing Memories\n${lines.join('\n')}\n`;
}

function renderNewMessages(messages: readonly Message[]): string {
  const lines = messages.map((m) => `${m.role}: ${escapeMarkdownHeaders(m.content)}`);
  return `## New Messages\n${lines.join('\n')}\n`;
}

export interface PromptResult {
  readonly prompt: string;
  readonly uuidByInt: Map<number, string>;
}

/**
 * Compose the extraction prompt + the integer→UUID mapping that the response
 * resolution step uses to translate `linked_memory_ids: ['1']` back to real UUIDs.
 */
export function generateAdditiveExtractionPrompt(
  existing: readonly MemoryItem[],
  newMessages: readonly Message[],
  customInstructions?: string,
): PromptResult {
  const uuidByInt = new Map<number, string>();
  existing.forEach((m, i) => uuidByInt.set(i + 1, m.id));

  const customPrefix = customInstructions !== undefined && customInstructions.length > 0
    ? `${customInstructions}\n\n`
    : '';

  const prompt = [
    customPrefix + SYSTEM_PROMPT,
    '',
    renderExistingMemories(existing),
    renderNewMessages(newMessages),
  ]
    .filter((part) => part.length > 0)
    .join('\n');

  return { prompt, uuidByInt };
}

/** Zod schema for the LLM's additive-extraction JSON response. `relations` is
 *  OPTIONAL (slice2 T2.2) — LLMs that omit it still parse (back-compat). Endpoint
 *  fields are surface strings (resolved to entity ids by name downstream). */
export const AdditiveExtractionSchema = z.object({
  memory: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      attributed_to: z.string().optional(),
      linked_memory_ids: z.array(z.string()).optional(),
    }),
  ),
  entities: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  relations: z
    .array(
      z.object({
        source: z.string(),
        relationship: z.string(),
        destination: z.string(),
      }),
    )
    .optional(),
});

export type AdditiveExtractionResponse = z.infer<typeof AdditiveExtractionSchema>;
