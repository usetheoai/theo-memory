/**
 * Unit tests for the domain ontology registry + resolver (Item 15 T1.1).
 */
import { describe, expect, test } from 'vitest';

import { InvalidOntology } from './errors.js';
import {
  BUILTIN_ONTOLOGIES,
  ONTOLOGY_FALLBACK_TYPE,
  resolveOntology,
  validateOntology,
  type Ontology,
} from './ontology.js';

describe('BUILTIN_ONTOLOGIES registry', () => {
  test('has exactly the 4 domain keys medical/legal/code/support', () => {
    expect(Object.keys(BUILTIN_ONTOLOGIES).sort()).toEqual(['code', 'legal', 'medical', 'support']);
  });

  test('every built-in has non-empty entityTypes (incl. OTHER) + relationTypes', () => {
    for (const o of Object.values(BUILTIN_ONTOLOGIES)) {
      expect(o.entityTypes.length).toBeGreaterThan(0);
      expect(o.entityTypes).toContain(ONTOLOGY_FALLBACK_TYPE);
      expect(o.relationTypes.length).toBeGreaterThan(0);
      expect(o.description).toBeDefined();
    }
  });
});

describe('resolveOntology', () => {
  test('resolves a built-in key to its ontology', () => {
    expect(resolveOntology('medical')).toBe(BUILTIN_ONTOLOGIES.medical);
    expect(resolveOntology('code').name).toBe('code');
  });

  test('resolves + validates a custom Ontology object', () => {
    const custom: Ontology = {
      name: 'finance',
      entityTypes: ['Account', 'Transaction', ONTOLOGY_FALLBACK_TYPE],
      relationTypes: ['debits', 'credits'],
    };
    expect(resolveOntology(custom)).toBe(custom);
  });

  test('throws InvalidOntology on an unknown built-in key', () => {
    expect(() => resolveOntology('bogus')).toThrow(InvalidOntology);
  });

  test('throws InvalidOntology on a custom ontology missing the OTHER fallback', () => {
    const bad: Ontology = { name: 'x', entityTypes: ['Foo'], relationTypes: ['bar'] };
    expect(() => resolveOntology(bad)).toThrow(InvalidOntology);
  });

  test('throws InvalidOntology on empty entityTypes / relationTypes / blank name', () => {
    expect(() => validateOntology({ name: '', entityTypes: ['OTHER'], relationTypes: ['x'] })).toThrow(
      InvalidOntology,
    );
    expect(() => validateOntology({ name: 'x', entityTypes: [], relationTypes: ['x'] })).toThrow(
      InvalidOntology,
    );
    expect(() => validateOntology({ name: 'x', entityTypes: ['OTHER'], relationTypes: [] })).toThrow(
      InvalidOntology,
    );
  });
});
