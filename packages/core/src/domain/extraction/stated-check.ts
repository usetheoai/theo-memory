import type { Tracer } from '@opentelemetry/api';
import { z } from 'zod';

import type { LLM } from '../dip/llm.js';
import { emitEvent } from '../memory-event.js';
import type { Message } from '../message.js';

/**
 * The second look at a message the extractor returned nothing for.
 *
 * The extraction prompt tells the model that a turn which only asks something yields no fact,
 * and the model applies that to a question that also states one: "As someone who lives in
 * Velmora, which bank should I pick?" came back empty in five writes of six (#282). Rules and
 * examples added to that prompt moved its other outputs, so the check is a call of its own, with
 * one narrow question, made only when extraction is empty.
 */
export const STATED_CHECK_PROMPT = [
  'You read one message that a person sent to an assistant and list what the person states about',
  'themself as already true: where they live or work, their family, pets, health, belongings,',
  'habits, tastes.',
  'A statement counts wherever it sits, including inside a question or a request: someone who asks',
  'something "as a person who has X" or "since I do Y" is stating X or Y.',
  'Leave out what the person only asks about, considers or might do, and everything that is about',
  'someone else.',
  'Reply with JSON: {"facts": [{"about": "<what is true of the person, as a short phrase in the',
  'language of the message that begins with the verb and has no subject, such as: lives in Graz,',
  'mora em Coimbra>", "quote": "<the exact words of the message that state it>", "lasting": <true',
  'when it stays true for weeks or longer, false for a passing state of the moment>}]}. When the',
  'message states nothing about its author, reply {"facts": []}.',
].join(' ');

const ResponseSchema = z.object({
  facts: z.array(z.object({ about: z.string().trim().min(1), quote: z.string().trim().min(1), lasting: z.boolean().optional() })),
});

export interface StatedFact {
  readonly id: string;
  readonly text: string;
  readonly evidence: { readonly kind: 'stated'; readonly durability: 'durable' | 'temporary'; readonly sourceQuote: string };
}

function plain(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Asks, for each message written by a user, what its author states about themself. A fact is
 * kept only when its quote is found in the message. A failed or malformed call recovers nothing
 * and is counted in `extraction_stated_check_failed`; it never fails the write.
 */
export async function recoverStatedFacts(llm: LLM, messages: readonly Message[], tracer: Tracer | undefined): Promise<readonly StatedFact[]> {
  const recovered: StatedFact[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    try {
      const raw = await llm.generateResponse(
        [
          { role: 'system', content: STATED_CHECK_PROMPT },
          { role: 'user', content: message.content },
        ],
        { type: 'json' },
      );
      const parsed = ResponseSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
      const said = plain(message.content);
      for (const fact of parsed.facts) {
        if (!said.includes(plain(fact.quote))) continue;
        recovered.push({
          id: String(recovered.length + 1),
          // The subject is written here, so it is the speaker token in every language.
          text: `user ${fact.about}`,
          evidence: { kind: 'stated', durability: fact.lasting === false ? 'temporary' : 'durable', sourceQuote: fact.quote },
        });
      }
    } catch (error) {
      emitEvent(tracer, 'extraction_stated_check_failed', { error: error instanceof Error ? error.name : 'UnknownError' });
    }
  }
  if (recovered.length > 0) emitEvent(tracer, 'extraction_stated_check_recovered', { facts: recovered.length });
  return recovered;
}
