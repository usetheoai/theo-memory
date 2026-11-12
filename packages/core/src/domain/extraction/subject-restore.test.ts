import type { Tracer } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import { restoreNamedSubject } from './subject-restore.js';

interface Recorded { event: string; attributes: Record<string, unknown> }

function recordingTracer(sink: Recorded[]): Tracer {
  return {
    startActiveSpan(name: string, fn: (span: unknown) => void): void {
      const attributes: Record<string, unknown> = {};
      fn({ setAttribute: (k: string, v: unknown) => { attributes[k] = v; }, end: () => undefined });
      sink.push({ event: name, attributes });
    },
  } as unknown as Tracer;
}

const perrine = [{ name: 'Perrine', type: 'PERSON' }, { name: 'apicultrice', type: 'CONCEPT' }];
const swapped = [{ id: '1', text: 'user travaille comme apicultrice' }];

describe('restoreNamedSubject', () => {
  it('puts the person back when a relation of the draft has that person doing what the fact says', () => {
    const relations = [{ source: 'Perrine', relationship: 'travaille comme', destination: 'apicultrice' }];

    const result = restoreNamedSubject(swapped, perrine, relations, undefined);

    expect(result.map((r) => r.text)).toEqual(['Perrine travaille comme apicultrice']);
  });

  it('leaves the fact alone without a relation that points to the person', () => {
    const result = restoreNamedSubject(swapped, perrine, [], undefined);

    expect(result).toEqual(swapped);
  });

  it('leaves the fact alone when a relation has the user doing what the fact says', () => {
    // "I told Perrine I am a beekeeper": the user is the beekeeper.
    const facts = [{ id: '1', text: 'user is a beekeeper' }];
    const relations = [
      { source: 'user', relationship: 'is', destination: 'beekeeper' },
      { source: 'Perrine', relationship: 'was told about', destination: 'beekeeper' },
    ];

    const result = restoreNamedSubject(facts, [{ name: 'Perrine', type: 'PERSON' }], relations, undefined);

    expect(result).toEqual(facts);
  });

  it('leaves the fact alone when two people could be the subject', () => {
    const relations = [
      { source: 'Perrine', relationship: 'travaille comme', destination: 'apicultrice' },
      { source: 'Gatien', relationship: 'travaille comme', destination: 'apicultrice' },
    ];

    const result = restoreNamedSubject(swapped, [...perrine, { name: 'Gatien', type: 'PERSON' }], relations, undefined);

    expect(result).toEqual(swapped);
  });

  it('leaves a fact that already names the person', () => {
    const facts = [{ id: '1', text: 'user said that Perrine travaille comme apicultrice' }];
    const relations = [{ source: 'Perrine', relationship: 'travaille comme', destination: 'apicultrice' }];

    const result = restoreNamedSubject(facts, perrine, relations, undefined);

    expect(result).toEqual(facts);
  });

  it('reports each restored subject', () => {
    const events: Recorded[] = [];
    const relations = [{ source: 'Perrine', relationship: 'travaille comme', destination: 'apicultrice' }];

    restoreNamedSubject(swapped, perrine, relations, recordingTracer(events));

    expect(events).toEqual([{ event: 'extraction_subject_restored', attributes: { restored: 1 } }]);
  });
});
