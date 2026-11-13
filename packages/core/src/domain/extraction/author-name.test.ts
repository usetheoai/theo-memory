import { describe, expect, it } from 'vitest';

import type { Message } from '../message.js';

import { nameAuthorAsSubject, nameAuthorInGraph, showAuthorNames, soleAuthor } from './author-name.js';

const maeve: Message = { role: 'user', name: 'Maeve', content: 'I play the banjo on the porch.' };
const bram: Message = { role: 'user', name: 'Bram', content: 'I live in Graz.' };
const unnamed: Message = { role: 'user', content: 'I am allergic to sesame.' };
const fact = (text: string, sourceQuote?: string) => ({ text, evidence: sourceQuote === undefined ? undefined : { sourceQuote } });

describe('showAuthorNames', () => {
  it('writes the name into the text of a named message and leaves the others alone', () => {
    const shown = showAuthorNames([maeve, unnamed]);
    expect(shown[0]?.content).toBe('Maeve: I play the banjo on the porch.');
    expect(shown[1]).toBe(unnamed);
  });

  it('treats a blank name as no name', () => {
    const blank: Message = { role: 'user', name: '  ', content: 'hello' };
    expect(showAuthorNames([blank])[0]).toBe(blank);
  });
});

describe('soleAuthor', () => {
  it('is the name when every message has the same one', () => {
    expect(soleAuthor([maeve, { ...maeve, content: 'And the oboe.' }])).toBe('Maeve');
  });

  it('is undefined with two authors or with an unnamed message', () => {
    expect(soleAuthor([maeve, bram])).toBeUndefined();
    expect(soleAuthor([maeve, unnamed])).toBeUndefined();
    expect(soleAuthor([unnamed])).toBeUndefined();
  });
});

describe('nameAuthorAsSubject', () => {
  it('names the author of the message the quote comes from', () => {
    const shown = showAuthorNames([maeve, bram]);
    const out = nameAuthorAsSubject([fact('user plays the banjo', 'I play the banjo'), fact('user lives in Graz', 'I live in Graz.')], shown, undefined);
    expect(out.map((f) => f.text)).toEqual(['Maeve plays the banjo', 'Bram lives in Graz']);
  });

  it('accepts a quote that includes the name prefix and differs in case or spacing', () => {
    const out = nameAuthorAsSubject([fact('user plays the banjo', 'maeve:  I play the Banjo')], showAuthorNames([maeve, bram]), undefined);
    expect(out[0]?.text).toBe('Maeve plays the banjo');
  });

  it('leaves a fact from an unnamed message as the speaker', () => {
    const out = nameAuthorAsSubject([fact('user is allergic to sesame', 'I am allergic to sesame.')], showAuthorNames([maeve, unnamed]), undefined);
    expect(out[0]?.text).toBe('user is allergic to sesame');
  });

  it('leaves a fact whose quote is not found when the write has two authors', () => {
    const out = nameAuthorAsSubject([fact('user owns a dog')], showAuthorNames([maeve, bram]), undefined);
    expect(out[0]?.text).toBe('user owns a dog');
  });

  it('names the only author of the write when the fact has no quote', () => {
    const out = nameAuthorAsSubject([fact('user plays the banjo')], showAuthorNames([maeve]), undefined);
    expect(out[0]?.text).toBe('Maeve plays the banjo');
  });

  it('leaves a quote that two authors both wrote', () => {
    const same: Message = { role: 'user', name: 'Bram', content: 'I play the banjo on the porch.' };
    const out = nameAuthorAsSubject([fact('user plays the banjo', 'I play the banjo on the porch.')], showAuthorNames([maeve, same]), undefined);
    expect(out[0]?.text).toBe('user plays the banjo');
  });

  it('does not touch a fact that already names someone and has no speaker token', () => {
    const facts = [fact('Rhys plays the oboe', 'I play the banjo')];
    expect(nameAuthorAsSubject(facts, showAuthorNames([maeve]), undefined)[0]).toBe(facts[0]);
  });

  it('does nothing when no message has a name', () => {
    const facts = [fact('user is allergic to sesame', 'I am allergic to sesame.')];
    expect(nameAuthorAsSubject(facts, [unnamed], undefined)).toBe(facts);
  });

  it('replaces the speaker token inside the sentence, not a longer word', () => {
    const out = nameAuthorAsSubject([fact('la hermana de user vive en Cádiz; username unknown')], showAuthorNames([maeve]), undefined);
    expect(out[0]?.text).toBe('la hermana de Maeve vive en Cádiz; username unknown');
  });
});

describe('nameAuthorInGraph', () => {
  const entities = [{ name: 'user', type: 'PERSON' }, { name: 'banjo', type: 'PRODUCT' }];
  const relations = [{ source: 'User', relationship: 'plays', destination: 'banjo' }];

  it('names the one author in entities and relations', () => {
    const out = nameAuthorInGraph(entities, relations, 'Maeve');
    expect(out.entities).toEqual([{ name: 'Maeve', type: 'PERSON' }, { name: 'banjo', type: 'PRODUCT' }]);
    expect(out.relations).toEqual([{ source: 'Maeve', relationship: 'plays', destination: 'banjo' }]);
  });

  it('keeps the speaker when the write has no single named author', () => {
    const out = nameAuthorInGraph(entities, relations, undefined);
    expect(out.entities).toBe(entities);
    expect(out.relations).toBe(relations);
  });
});
