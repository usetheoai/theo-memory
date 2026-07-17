/**
 * Unit tests for applyOntologyToEntities (domain-ontologies T2.2 / ADR D2).
 * Pure post-parse coercion: out-of-vocab entity types → OTHER + observable event.
 */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test } from 'vitest';

import { BUILTIN_ONTOLOGIES, ONTOLOGY_FALLBACK_TYPE } from '../ontology.js';

import { applyOntologyToEntities } from './pipeline.js';

const setupTracer = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
};

describe('applyOntologyToEntities (T2.2)', () => {
  const med = BUILTIN_ONTOLOGIES.medical;

  test('in-vocab entity types pass through verbatim', () => {
    const out = applyOntologyToEntities(
      [{ name: 'fever', type: 'Symptom' }, { name: 'ibuprofen', type: 'Medication' }],
      med,
      undefined,
    );
    expect(out.map((e) => e.type)).toEqual(['Symptom', 'Medication']);
  });

  test('out-of-vocab entity type coerces to OTHER', () => {
    const out = applyOntologyToEntities([{ name: 'Gandalf', type: 'Wizard' }], med, undefined);
    expect(out[0]?.type).toBe(ONTOLOGY_FALLBACK_TYPE);
    expect(out[0]?.name).toBe('Gandalf');
  });

  test('coercion emits an observable ontology_type_coerced event', () => {
    const { tracer, exporter } = setupTracer();
    applyOntologyToEntities([{ name: 'Gandalf', type: 'Wizard' }], med, tracer);
    const spans = exporter.getFinishedSpans().map((s) => s.name);
    expect(spans).toContain('ontology_type_coerced');
  });

  test('entities without a type are left untouched (no coercion, no event)', () => {
    const { tracer, exporter } = setupTracer();
    const out = applyOntologyToEntities([{ name: 'x' }], med, tracer);
    expect(out[0]?.type).toBeUndefined();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test('does not mutate the input array or its items', () => {
    const input = [{ name: 'Gandalf', type: 'Wizard' }];
    const out = applyOntologyToEntities(input, med, undefined);
    expect(input[0]?.type).toBe('Wizard'); // original untouched
    expect(out[0]?.type).toBe(ONTOLOGY_FALLBACK_TYPE);
  });
});
