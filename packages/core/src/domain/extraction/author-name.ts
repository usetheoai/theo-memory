import type { Tracer } from '@opentelemetry/api';

import { emitEvent } from '../memory-event.js';
import type { Message } from '../message.js';

import type { LlmEntity, RelationTriple } from './entity-linking.js';

const USER_WORD = /(?<![\p{L}\p{N}_])user(?![\p{L}\p{N}_])/giu;

function authorName(message: Message): string | undefined {
  const name = message.name?.replace(/\s+/gu, ' ').trim();
  return name === undefined || name.length === 0 ? undefined : name;
}

function plain(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Writes the author's name into the text of each message that carries one, as `Name: text`. This
 * is the form the extractor reads, the form a source quote is checked against, and the form the
 * message log keeps, so a later write still sees who said what.
 */
export function showAuthorNames(messages: readonly Message[]): readonly Message[] {
  return messages.map((message) => {
    const name = authorName(message);
    // Applied at both entries of the pipeline, so a line that already shows its name is left alone.
    if (name === undefined || message.content.startsWith(`${name}: `)) return message;
    return { ...message, content: `${name}: ${message.content}` };
  });
}

/** The one named author of a write, or undefined when a message has no name or the names differ. */
export function soleAuthor(messages: readonly Message[]): string | undefined {
  const names = new Set(messages.map(authorName));
  const [only] = [...names];
  return names.size === 1 ? only : undefined;
}

/**
 * Names the author in a fact the extractor wrote about `user`.
 *
 * The extractor calls the first-person speaker `user`. When the caller says who wrote a message,
 * that is the wrong subject: "user plays the banjo" under a line Maeve wrote is not found by a
 * question about Maeve (#244). The author of a fact is read from the message its source quote
 * comes from. The fact is rewritten only when that points to one named author; a quote found
 * under two authors, or under a message with no name, leaves the fact as it is. A fact with no
 * quote in the messages takes the name only when the whole write has one named author.
 */
export function nameAuthorAsSubject<T extends { readonly text: string; readonly evidence?: { readonly sourceQuote?: string | undefined } | undefined }>(
  facts: readonly T[],
  shown: readonly Message[],
  tracer: Tracer | undefined,
): readonly T[] {
  if (!shown.some((message) => authorName(message) !== undefined)) return facts;
  const whole = soleAuthor(shown);
  const contents = shown.map((message) => plain(message.content));
  let named = 0;
  const result = facts.map((fact) => {
    USER_WORD.lastIndex = 0;
    if (!USER_WORD.test(fact.text)) return fact;
    const quote = fact.evidence?.sourceQuote === undefined ? '' : plain(fact.evidence.sourceQuote);
    const from = quote === '' ? [] : shown.filter((_, index) => (contents[index] as string).includes(quote));
    const authors = new Set(from.map(authorName));
    const [only] = [...authors];
    const author = from.length === 0 ? whole : authors.size === 1 ? only : undefined;
    if (author === undefined) return fact;
    named += 1;
    return { ...fact, text: fact.text.replace(USER_WORD, author) };
  });
  if (named > 0) emitEvent(tracer, 'extraction_author_named', { named });
  return result;
}

function rename(value: string, author: string): string {
  return value.trim().toLowerCase() === 'user' ? author : value;
}

/**
 * Names the author in the entities and relations of a write that has one named author. A write
 * with several authors keeps `user` there: a relation does not say which message it came from.
 */
export function nameAuthorInGraph(
  entities: readonly LlmEntity[] | undefined,
  relations: readonly RelationTriple[] | undefined,
  author: string | undefined,
): { readonly entities: readonly LlmEntity[] | undefined; readonly relations: readonly RelationTriple[] | undefined } {
  if (author === undefined) return { entities, relations };
  return {
    entities: entities?.map((entity) => (rename(entity.name, author) === entity.name ? entity : { name: author, type: 'PERSON' })),
    relations: relations?.map((relation) => ({
      ...relation,
      source: rename(relation.source, author),
      destination: rename(relation.destination, author),
    })),
  };
}
