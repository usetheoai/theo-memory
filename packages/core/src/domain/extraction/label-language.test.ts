/**
 * Unit tests for entity/relation label language correction (EG-5 T1.1).
 * Uses a stub LLM (the corrective map is deterministic-under-stub); detection is
 * the real `eld` collaborator (pure, no I/O).
 *
 */
import { describe, expect, it, vi } from 'vitest';

import type { LLM } from '../dip/llm.js';

import { correctEntityRelationLanguage } from './label-language.js';

const EN = { iso6391: 'en', name: 'English' } as const;
const PT = { iso6391: 'pt', name: 'Portuguese' } as const;
/** An English message whose words the Portuguese labels below do not reuse. */
const SOURCE_EN = 'My name is Daniel and I enjoy surfing on weekends';

const mapLlm = (map: Record<string, string>): LLM => ({
  generateResponse: vi.fn(async () => map),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

describe('correctEntityRelationLanguage', () => {
  it('corrects PT entity labels for an EN target + renames the relation endpoint (referential integrity)', async () => {
    const entities = [{ name: 'surfar' }, { name: 'Daniel' }, { name: 'fins de semana' }];
    const relations = [{ source: 'user', relationship: 'gosta de', destination: 'surfar' }];
    const llm = mapLlm({ surfar: 'surfing', 'fins de semana': 'weekends', 'gosta de': 'enjoys' });

    const out = await correctEntityRelationLanguage(llm, entities, relations, EN, SOURCE_EN);

    expect(out.entities?.map((e) => e.name)).toEqual(['surfing', 'Daniel', 'weekends']);
    // referential integrity: the relation destination renamed identically to the entity.
    expect(out.relations?.[0]).toEqual({ source: 'user', relationship: 'enjoys', destination: 'surfing' });
    expect(out.corrected).toBe(3);
  });

  it('never translates the literal user token', async () => {
    const entities = [{ name: 'user' }, { name: 'surfar' }];
    const relations = [{ source: 'user', relationship: 'gosta de', destination: 'surfar' }];
    // map even if (wrongly) provided a translation for "user" — it must stay "user".
    const llm = mapLlm({ user: 'usuário', surfar: 'surfing', 'gosta de': 'enjoys' });

    const out = await correctEntityRelationLanguage(llm, entities, relations, EN, SOURCE_EN);

    expect(out.entities?.map((e) => e.name)).toEqual(['user', 'surfing']);
    expect(out.relations?.[0]?.source).toBe('user');
  });

  it('leaves labels unchanged when the model reports all already in the target (empty map)', async () => {
    const entities = [{ name: 'data scientist' }, { name: 'rock climbing' }, { name: 'product manager' }];
    const relations = [{ source: 'user', relationship: 'works as', destination: 'data scientist' }];
    // Always-on: the call happens, but the model returns {} (all already English).
    const llm = mapLlm({});

    const out = await correctEntityRelationLanguage(llm, entities, relations, EN, SOURCE_EN);

    expect(out.corrected).toBe(0);
    expect(out.entities?.map((e) => e.name)).toEqual(['data scientist', 'rock climbing', 'product manager']);
    expect(out.relations?.[0]).toEqual({ source: 'user', relationship: 'works as', destination: 'data scientist' });
  });

  it('fail-soft: keeps original labels when the map call throws', async () => {
    const entities = [{ name: 'surfar' }, { name: 'fins de semana' }];
    const relations = [{ source: 'user', relationship: 'gosta de', destination: 'surfar' }];
    const llm: LLM = {
      generateResponse: vi.fn(async () => { throw new Error('map LLM unavailable'); }),
      generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
    };

    const out = await correctEntityRelationLanguage(llm, entities, relations, EN, SOURCE_EN);

    expect(out.entities?.map((e) => e.name)).toEqual(['surfar', 'fins de semana']);
    expect(out.corrected).toBe(0);
  });

  it('defensive apply: a label missing from the map keeps its original', async () => {
    const entities = [{ name: 'surfar' }, { name: 'fins de semana' }];
    const relations = [{ source: 'user', relationship: 'gosta de', destination: 'surfar' }];
    const llm = mapLlm({ surfar: 'surfing' }); // omits 'fins de semana' + 'gosta de'

    const out = await correctEntityRelationLanguage(llm, entities, relations, EN, SOURCE_EN);

    expect(out.entities?.map((e) => e.name)).toEqual(['surfing', 'fins de semana']);
    expect(out.relations?.[0]).toEqual({ source: 'user', relationship: 'gosta de', destination: 'surfing' });
    expect(out.corrected).toBe(1);
  });

  it('keeps labels whose words come from the source message, even when the model translates them (#256)', async () => {
    const source = 'Rosângela Prates trabalha como enfermeira em Teresina e mora em Teresina.';
    const entities = [{ name: 'Rosângela Prates' }, { name: 'Teresina' }, { name: 'enfermeira' }];
    const relations = [
      { source: 'Rosângela Prates', relationship: 'trabalha como', destination: 'enfermeira' },
      { source: 'Rosângela Prates', relationship: 'mora em', destination: 'Teresina' },
    ];
    // The observed failure: the map call answers with English for a Portuguese target.
    const llm = mapLlm({ enfermeira: 'nurse', 'trabalha como': 'works as', 'mora em': 'lives in' });

    const out = await correctEntityRelationLanguage(llm, entities, relations, PT, source);

    expect(out.relations).toEqual(relations);
    expect(out.entities?.map((e) => e.name)).toEqual(['Rosângela Prates', 'Teresina', 'enfermeira']);
    expect(out.corrected).toBe(0);
  });

  it('makes no call when every label comes from the source message (#256)', async () => {
    const llm = mapLlm({ 'mora em': 'lives in' });

    await correctEntityRelationLanguage(llm, [{ name: 'Lisboa' }], [{ source: 'user', relationship: 'mora em', destination: 'Lisboa' }], PT, 'Eu moro em Lisboa e ela mora em Lisboa');

    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  it('sends only the labels not taken from the source, together with the source message (#256)', async () => {
    const source = 'O irmão de Rosângela se chama Vítor e mora em Maceió.';
    const llm = mapLlm({ 'has brother named': 'tem irmão chamado' });

    const out = await correctEntityRelationLanguage(
      llm,
      [{ name: 'Vítor' }],
      [{ source: 'Rosângela', relationship: 'has brother named', destination: 'Vítor' }, { source: 'Vítor', relationship: 'mora em', destination: 'Maceió' }],
      PT,
      source,
    );

    const [messages] = vi.mocked(llm.generateResponse).mock.calls[0]!;
    const asked = JSON.parse(messages[1]!.content) as { source: string; labels: string[] };
    expect(asked).toEqual({ source, labels: ['has brother named'] });
    expect(out.relations?.[0]?.relationship).toBe('tem irmão chamado');
    expect(out.relations?.[1]?.relationship).toBe('mora em');
  });
});
