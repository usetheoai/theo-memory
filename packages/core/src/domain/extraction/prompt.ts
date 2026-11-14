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
 */
import { z } from 'zod';

import type { MemoryItem } from '../memory-item.js';
import type { Message } from '../message.js';
import { ONTOLOGY_FALLBACK_TYPE, type Ontology } from '../ontology.js';

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
  'relates to an existing memory that stays true. NEVER emit `linked_memory_ids` as bare numbers; the',
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
  'Represent the first-person speaker (the author of the message) as ONE consistent entity',
  'named exactly "user" in both `entities` and `relations` — NEVER variants like "I", "me",',
  '"eu", "Usuário", or "You" for self-statements. This keeps the speaker a single node.',
  '',
  'Also include `relations`: factual triples connecting those entities — each',
  '`{ "source": "<entity>", "relationship": "<verb phrase>", "destination": "<entity>" }`.',
  'Use the entity SURFACE NAMES exactly as they appear (not ids). Be generous: emit a',
  'relation for every stated link between two entities — covering employment, location,',
  'usage, composition, membership, education, ownership/acquisition, and reporting/hierarchy.',
  'Omit `entities`/`relations` only when the text genuinely has none.',
  '',
  'LANGUAGE: identify the language of the input messages from their words, not from the',
  'proper names in them ("Kwame listens to opera" is English). Write every fact (`memory[].text`),',
  'entity name and `relationship` label in that SAME language and script; NEVER translate,',
  'transliterate or mix languages inside one fact. Preserve all accents/diacritics ("São Paulo",',
  '"José", "Müller"; never "Sao Paulo", "Jose"). One example per language: the English input',
  '"I work as a data scientist" yields "user works as a data scientist" with the label "works as";',
  'the Portuguese input "Eu moro em Lisboa" yields "user mora em Lisboa" with the label "mora em";',
  'the Spanish input "Mi hermana vive en Cádiz" yields "la hermana de user vive en Cádiz" with the',
  'label "vive en".',
  'MULTI-WORD LABELS: every token of a compound entity name or relationship label must be in',
  'the SAME language. Half-translating a compound is FORBIDDEN: the Portuguese "engenheiro',
  'mecânico" stays "engenheiro mecânico" (never "engineer mecânico" or "mechanical engineer"),',
  'and the English "mechanical engineer" stays "mechanical engineer" (never "engenheiro mechanical").',
  'The literal token "user" (the speaker) is the one allowed exception to the input-language rule.',
  '',
  'EVIDENCE DISCIPLINE:',
  '- Distinguish directly stated information from inferred patterns; never mark either as verified.',
  '- Add evidence to each fact: kind (stated or inferred), durability (durable, temporary,',
  '  or tentative), sourceQuote (an exact excerpt of a NEW message), and optional confidence [0,1].',
  '- Add time to the evidence, read from the tense of the source: future for something still to',
  '  happen (a plan, an appointment), past for something that already happened, present for a',
  '  state that holds now.',
  '- Do not turn a passing mood, hypothetical, suggestion, or one-off choice into a durable preference.',
  '- "Maybe I will wear yellow today" yields NO durable preference. "I usually prefer dark',
  '  colors" is a stated durable preference. "I bought a blue jacket" is a stated event,',
  '  not independent verification of a purchase and not evidence of a permanent color preference.',
  '- When NEW input explicitly describes the SAME choice across multiple INDEPENDENT sessions,',
  '  preserve the reported observation as stated AND extract one bounded pattern as inferred.',
  '  For example: five independent choices of plain outfits support an inferred preference for',
  '  simple clothing. Cite the exact repeated-observation sentence, use cautious wording such as',
  '  "appears to prefer", and retain the event/context boundary. A lack of an explicitly stated',
  '  preference does not negate evidence of a pattern. Do not persist that absence as a preference.',
  '  This rule NEVER applies to repetitions or summaries of ONE source, a one-off choice, or a hypothetical.',
  '- DURABILITY means useful truth beyond this turn; it does NOT mean a fact can never change.',
  '  Explicit purchases, returns, moves and current profile updates are durable facts/events.',
  '  Preserve their past/current tense and dates. "Yesterday" and "last month" do NOT make an event temporary.',
  '  An assistant recommendation can be recorded as the durable event "assistant recommended X";',
  '  it is NEVER a user preference or a user decision unless the user actually confirmed it.',
  '  Temporary means disposable working context such as a passing mood or an undecided one-off trial.',
  '- A repeated summary of one purchase is still ONE stated purchase, never a newly inferred purchase.',
  '  Do not emit "never explicitly stated a preference" as a fact or as the inferred pattern.',
  'Event example (do not echo):',
  'Input: "I bought a blue jacket yesterday."',
  'Output: { "memory": [{ "id": "1", "text": "user bought a blue jacket yesterday",',
  '  "evidence": { "kind": "stated", "durability": "durable", "sourceQuote": "I bought a blue jacket yesterday." } }] }',
  '- Durability and epistemic certainty are separate: a well-supported recurring pattern is',
  '  durable even when cautiously phrased as "appears to prefer". Mark it kind=inferred,',
  '  durability=durable. Use tentative for a source that is undecided, hypothetical or speculative.',
  'Pattern example (do not echo):',
  'Input: "In five independent sessions Alex selected plain clothing rather than ornate outfits."',
  'Output: { "memory": [',
  '  { "id": "1", "text": "Alex selected plain clothing rather than ornate outfits in five independent sessions",',
  '    "evidence": { "kind": "stated", "durability": "durable", "sourceQuote": "In five independent sessions Alex selected plain clothing rather than ornate outfits." } },',
  '  { "id": "2", "text": "Alex appears to prefer plain clothing in similar situations",',
  '    "evidence": { "kind": "inferred", "durability": "durable", "confidence": 0.7, "sourceQuote": "In five independent sessions Alex selected plain clothing rather than ornate outfits." } }',
  '] }',
  '- Infer patterns only from supporting evidence; preserve uncertainty and do not treat',
  '  repetitions of your own summaries as independent confirmations.',
  '- Descriptions extracted from audio/video are contextual observations, not retained raw media.',
  '',
  'DURABLE-FACT DISCIPLINE (what a `memory[].text` fact MUST be):',
  '- ATOMIC: one idea per fact. SPLIT a multi-fact turn into several facts — NEVER emit one',
  '  paragraph-length "fact". A 400-word narration becomes several short facts, or none.',
  '- DECLARATIVE: a statement, never a question. A turn that only asks something',
  '  ("Shall I proceed?", "Quer que eu prossiga?") yields NO fact.',
  '- THIRD PERSON: name the subject; NEVER first-person conversational voice. Rewrite',
  '  "My recommendation: use an allowlist" as the fact "An allowlist is recommended".',
  '- DROP conversational filler: greetings, acknowledgements, meta-chatter ("let me", "I will",',
  '  "here is what I did") carry no durable fact — return them as nothing.',
  'When a turn contains no durable fact, return an EMPTY `memory` array — this is correct, not a failure.',
  '',
  'Few-shot (durable-fact discipline — do NOT echo these):',
  'Input (assistant): "Quer que eu prossiga com o escopo estreito, ou prefere outro corte?"',
  'Output: { "memory": [] }',
  'Input (assistant): "Minha recomendação: allowlist com sunset <= 90 dias."',
  'Output: { "memory": [{ "id": "1", "text": "Recomenda-se uma allowlist com sunset <= 90 dias" }] }',
  'Input (assistant): "Atualizei o hono de 4.12.25 para 4.12.31, fechando tres advisories, e o alvo de deploy e container Linux."',
  'Output: { "memory": [{ "id": "1", "text": "hono foi atualizado de 4.12.25 para 4.12.31, fechando tres advisories" }, { "id": "2", "text": "O alvo de deploy e container Linux" }] }',
  'Input (assistant): "Ok, vou continuar."',
  'Output: { "memory": [] }',
  '',
  'Output format (strict JSON, no prose):',
  '{ "memory": [{ "id": "<seq>", "text": "<fact>", "attributed_to": "<peer-id>", "category"?: "<label>", "linked_memory_ids"?: ["1", "2"], "evidence"?: { "kind": "stated|inferred", "durability": "durable|temporary|tentative", "time"?: "future|past|present", "sourceQuote"?: "<exact excerpt>", "confidence"?: 0.8 } }],',
  '  "entities"?: [{ "name": "<entity>", "type": "<PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER>" }],',
  '  "relations"?: [{ "source": "<entity>", "relationship": "<verb phrase>", "destination": "<entity>" }] }',
].join('\n');

function renderExistingMemories(existing: readonly MemoryItem[]): string {
  if (existing.length === 0) {
    return '';
  }
  const lines = existing.map((m, i) => {
    const evidence = m.evidence === undefined ? '' : ` [evidence=${escapeMarkdownHeaders(JSON.stringify(m.evidence))}]`;
    return `${i + 1}. ${escapeMarkdownHeaders(m.text)}${evidence}`;
  });
  return `## Existing Memories\n${lines.join('\n')}\n`;
}

/**
 * The turns of the same scope that preceded the New Messages (MessageLog.recent). They let the
 * extractor resolve references a new turn depends on ("she", "that class", "the same place"),
 * and they are never a source of facts: those turns were extracted when they were new.
 */
function renderPreviousMessages(messages: readonly Message[]): string {
  if (messages.length === 0) {
    return '';
  }
  const lines = messages.map((m) => `${m.role}: ${escapeMarkdownHeaders(m.content)}`);
  return [
    '## Previous Messages',
    'Context only: the turns that came before the New Messages in this conversation. Use them to',
    'resolve who or what the New Messages refer to. Do not extract facts from Previous Messages.',
    ...lines,
    '',
  ].join('\n');
}

function renderNewMessages(messages: readonly Message[]): string {
  const lines = messages.map((m) => `${m.role}: ${escapeMarkdownHeaders(m.content)}`);
  return `## New Messages\n${lines.join('\n')}\n`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * Anchors relative time expressions (RememberOptions.observedAt). Without it the extractor
 * has no date to resolve "last Friday" against and stores the phrase unanchored, which
 * loses the event's time for good. The date is the UTC calendar date of the instant.
 */
export function renderReferenceTimeDirective(referenceTime: Date): string {
  const iso = referenceTime.toISOString();
  const day = iso.slice(0, 10);
  const weekday = WEEKDAY_NAMES[referenceTime.getUTCDay()] ?? '';
  return [
    `REFERENCE TIME: the New Messages were sent on ${day} (${weekday}), ${iso.slice(11, 16)} UTC.`,
    'Resolve every relative time expression in them (today, yesterday, last Friday, this weekend,',
    'two weeks ago, next month) against that date and write the absolute date into the fact:',
    'a day as YYYY-MM-DD, a week or weekend as its date range, a month as YYYY-MM, a year as YYYY.',
    'Keep the original wording next to the date only when it adds meaning. Never state a date',
    'the messages do not imply; an expression that cannot be resolved stays as written.',
  ].join('\n');
}

export interface PromptResult {
  readonly prompt: string;
  readonly uuidByInt: Map<number, string>;
}

/**
 * Render the domain-ontology directive (Item 15 / ADR D2). When an ontology is
 * configured, this steers the LLM toward the domain vocabulary — entity types +
 * relation types are CONSTRAINED to the ontology's lists (the generic
 * `PERSON|ORG|...` enum in SYSTEM_PROMPT is overridden by this higher-priority
 * directive). Post-parse validation (`extraction/pipeline.ts`) enforces it.
 */
export function renderOntologyDirective(ontology: Ontology): string {
  const desc = ontology.description !== undefined && ontology.description.length > 0
    ? ` (${ontology.description})`
    : '';
  return [
    `DOMAIN ONTOLOGY: "${ontology.name}"${desc}.`,
    `For \`entities[].type\`, use ONLY these types: ${ontology.entityTypes.join(', ')}.`,
    `If an entity does not fit any of those, use "${ONTOLOGY_FALLBACK_TYPE}".`,
    `For \`relations[].relationship\`, prefer these relation types: ${ontology.relationTypes.join(', ')}.`,
  ].join('\n');
}

/**
 * Render the auto-categorization directive (auto-categorization-write-pipeline).
 * Instructs the LLM to assign each fact a single lowercase `category`, preferring
 * a label from the fixed taxonomy, or a short (≤ 64-char) free-form label when none
 * fits (hybrid — ADR D2). An empty taxonomy omits the "Prefer one of:" clause
 * (pure free-form mode — EC-4).
 */
export function renderCategoryDirective(taxonomy: readonly string[]): string {
  const prefer =
    taxonomy.length > 0 ? ` Prefer one of: ${taxonomy.join(', ')}.` : '';
  return (
    'CATEGORY: assign each `memory[]` fact a single lowercase `category` label.' +
    prefer +
    ' If none fits, use a short (max 64 chars) lowercase label.'
  );
}

/**
 * Compose the extraction prompt + the integer→UUID mapping that the response
 * resolution step uses to translate `linked_memory_ids: ['1']` back to real UUIDs.
 *
 * When `ontology` is provided (Item 15), its vocabulary directive is prepended
 * (highest priority) so the LLM is steered to the domain types. When
 * `categoryTaxonomy` is provided (default-on auto-categorization), the category
 * directive is prepended. Both absent → byte-identical to prior output.
 */
export function generateAdditiveExtractionPrompt(
  existing: readonly MemoryItem[],
  newMessages: readonly Message[],
  customInstructions?: string,
  ontology?: Ontology,
  detectedLanguage?: { readonly name: string },
  categoryTaxonomy?: readonly string[],
  attributedTo?: string,
  referenceTime?: Date,
  previousMessages?: readonly Message[],
): PromptResult {
  const uuidByInt = new Map<number, string>();
  existing.forEach((m, i) => uuidByInt.set(i + 1, m.id));

  // M29 (#160): the first-person speaker token, derived from the turn's authoritative
  // attribution (options.attributedTo, set by the kit's Stop hook). Any value other than
  // 'assistant' (a user id, undefined) keeps the default `user` speaker — every existing
  // caller stays byte-identical. When the turn is the assistant's, a HIGH-PRIORITY prefix
  // overrides the default `user` speaker baked into SYSTEM_PROMPT (same override mechanism
  // the ontology/language prefixes use — see the renderOntologyDirective note). Grounded in
  // Agent-context discipline: "For agent actions, use
  // direct statements: 'Agent recommended [X]'" + attribute correctly.
  const speakerRoles = new Set(newMessages.map((message) => message.role));
  const hasMixedSpeakers = speakerRoles.size > 1;
  const speakerToken = attributedTo === 'assistant' ? 'assistant' : 'user';
  const speakerPrefix = hasMixedSpeakers
    ? 'SOURCE SPEAKER ATTRIBUTION (HIGHEST PRIORITY — overrides the default "user" speaker rule): '
      + 'each line in New Messages is prefixed by its authoritative source role. Assign every '
      + 'extracted fact to the role that authored the supporting statement and set '
      + '`attributed_to` to that exact role. A single batch may contain both user and assistant '
      + 'facts; never transfer a claim between speakers or assign all facts to one default role. '
      + 'Keep assistant statements attributed to assistant, even when they describe the user.\n\n'
    : speakerToken === 'assistant'
    ? 'SPEAKER IDENTITY (HIGHEST PRIORITY — overrides the default "user" speaker rule in the '
      + 'system prompt below): the author of the NEW messages is the ASSISTANT/agent, NOT the '
      + 'user. Represent the first-person speaker as ONE consistent entity named exactly '
      + '"assistant" in `entities`, `relations`, AND each `memory[].text` fact — NEVER "user" '
      + 'for the assistant\'s own statements or actions. Frame the assistant\'s actions in third '
      + 'person as "assistant <verb>" (e.g. the assistant message "I recommend an allowlist" '
      + 'yields the fact "assistant recommended an allowlist", NOT "user recommended an '
      + 'allowlist"). Reserve "user" ONLY for facts the user explicitly stated. Set '
      + '`attributed_to` to "assistant" for the assistant\'s own facts.\n\n'
    : '';

  const customPrefix = customInstructions !== undefined && customInstructions.length > 0
    ? `${customInstructions}\n\n`
    : '';

  const ontologyPrefix = ontology !== undefined
    ? `${renderOntologyDirective(ontology)}\n\n`
    : '';

  const categoryPrefix = categoryTaxonomy !== undefined
    ? `${renderCategoryDirective(categoryTaxonomy)}\n\n`
    : '';

  // EG-4 fixes-cycle-1 (D1): when the input language was detected deterministically
  // upstream, inject the EXPLICIT target-language name as the highest-priority line.
  // A concrete "write in English" instruction is followed far more reliably than the
  // model self-detecting (live-test 2026-06-23: self-detect stored EN inputs as PT).
  const languagePrefix = detectedLanguage !== undefined
    ? `LANGUAGE DIRECTIVE: the input language is ${detectedLanguage.name}. Write ALL facts `
      + `(\`memory[].text\`), entity names, and relationship labels in ${detectedLanguage.name} — `
      + `NEVER translate or transliterate. The literal token "${speakerToken}" (the speaker) is the only `
      + 'exception.\n\n'
    : '';

  const referencePrefix = referenceTime !== undefined ? `${renderReferenceTimeDirective(referenceTime)}\n\n` : '';

  const prompt = [
    speakerPrefix + languagePrefix + referencePrefix + ontologyPrefix + categoryPrefix + customPrefix
      + SYSTEM_PROMPT,
    '',
    renderExistingMemories(existing),
    renderPreviousMessages(previousMessages ?? []),
    renderNewMessages(newMessages),
  ]
    .filter((part) => part.length > 0)
    .join('\n');

  return { prompt, uuidByInt };
}

/** The evidence the extractor attaches to one fact. One schema for the response and for the repair before it. */
export const ExtractedEvidenceSchema = z
  .object({
    kind: z.enum(['stated', 'inferred']),
    durability: z.enum(['durable', 'temporary', 'tentative']),
    sourceQuote: z.string().trim().min(1).max(4000).optional(),
    confidence: z.number().finite().min(0).max(1).optional(),
    time: z.enum(['future', 'past', 'present']).optional(),
  })
  .strict();

/** Zod schema for the LLM's additive-extraction JSON response. `relations` is
 *  OPTIONAL (slice2 T2.2) — LLMs that omit it still parse (back-compat). Endpoint
 *  fields are surface strings (resolved to entity ids by name downstream). */
export const AdditiveExtractionSchema = z.object({
  memory: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      attributed_to: z.string().optional(),
      category: z.string().optional(),
      linked_memory_ids: z.array(z.string()).optional(),
      evidence: ExtractedEvidenceSchema.optional(),
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
