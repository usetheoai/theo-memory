/**
 * M25 T1.1 RED — pure layered-config resolver.
 *
 */
import { describe, expect, it } from 'vitest';

import { resolveConfig } from './resolve.js';

describe('resolveConfig — later layer wins', () => {
  it('later_layer_wins: last layer setting a key supplies the value + source', () => {
    const out = resolveConfig([
      { name: 'defaults', values: { k: 'a' } },
      { name: 'project', values: { k: 'b' } },
    ]);
    expect(out.value['k']).toBe('b');
    expect(out.source['k']).toBe('project');
  });
});

describe('resolveConfig — source attribution per key', () => {
  it('source_attribution_per_key: each key attributed to the highest layer that set it', () => {
    const out = resolveConfig([
      { name: 'defaults', values: { a: 1, b: 1, c: 1 } },
      { name: 'env', values: { b: 2 } },
      { name: 'flags', values: { c: 3 } },
    ]);
    expect(out.value).toEqual({ a: 1, b: 2, c: 3 });
    expect(out.source).toEqual({ a: 'defaults', b: 'env', c: 'flags' });
  });
});

describe('resolveConfig — deep merge nested objects', () => {
  it('deep_merge_nested_objects: nested object keys merge, not replace', () => {
    const out = resolveConfig([
      { name: 'defaults', values: { nested: { x: 1, keep: true } } },
      { name: 'project', values: { nested: { y: 2 } } },
    ]);
    expect(out.value['nested']).toEqual({ x: 1, keep: true, y: 2 });
  });
});

describe('resolveConfig — empty', () => {
  it('empty_layers_yield_empty: no layers → empty value + source', () => {
    const out = resolveConfig([]);
    expect(out.value).toEqual({});
    expect(out.source).toEqual({});
  });
});
