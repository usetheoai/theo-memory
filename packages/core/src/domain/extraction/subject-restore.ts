import type { Tracer } from '@opentelemetry/api';

import { entityKeysNamedIn, normalizeEntityKey } from '../entity-key.js';
import { emitEvent } from '../memory-event.js';

import type { LlmEntity, RelationTriple } from './entity-linking.js';

const SPEAKER_TOKENS = new Set(['user', 'assistant']);
const USER_WORD = /(?<![\p{L}\p{N}_])user(?![\p{L}\p{N}_])/giu;

function names(text: string, name: string): boolean {
  return entityKeysNamedIn(text, [normalizeEntityKey(name)]).length > 0;
}

/**
 * Puts a named person back as the subject of a fact the extractor wrote about `user`.
 *
 * A third-person sentence with no speaker prefix ("Perrine travaille comme apicultrice.") is
 * sometimes extracted as "user travaille comme apicultrice", which records the person's
 * attribute as the user's (#257). The same draft still carries the truth: its relation says
 * Perrine does it. The fact is rewritten only when exactly one PERSON of the draft has a
 * relation whose destination the fact names, and no relation has `user` doing the same; any
 * doubt leaves the fact as the extractor wrote it.
 */
export function restoreNamedSubject<T extends { readonly text: string }>(
  facts: readonly T[],
  entities: readonly LlmEntity[] | undefined,
  relations: readonly RelationTriple[] | undefined,
  tracer: Tracer | undefined,
): readonly T[] {
  if (entities === undefined || relations === undefined || relations.length === 0) return facts;
  const people = entities
    .filter((e) => (e.type ?? '').toUpperCase() === 'PERSON' && !SPEAKER_TOKENS.has(e.name.trim().toLowerCase()))
    .map((e) => e.name);
  let restored = 0;
  const result = facts.map((fact) => {
    if (!names(fact.text, 'user')) return fact;
    const doneHere = relations.filter((r) => names(fact.text, r.destination));
    if (doneHere.some((r) => SPEAKER_TOKENS.has(r.source.trim().toLowerCase()))) return fact;
    const candidates = people.filter((p) => !names(fact.text, p) && doneHere.some((r) => normalizeEntityKey(r.source) === normalizeEntityKey(p)));
    if (candidates.length !== 1) return fact;
    restored += 1;
    return { ...fact, text: fact.text.replace(USER_WORD, candidates[0] as string) };
  });
  if (restored > 0) emitEvent(tracer, 'extraction_subject_restored', { restored });
  return result;
}
