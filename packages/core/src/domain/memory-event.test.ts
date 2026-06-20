/**
 * RED-phase tests for src/core/memory-event.ts — T4.2 of v0-1-local-runtime plan v1.3.
 * 13-value enum (12 original + extraction_failed per EC-10 absorption).
 */
import { describe, expect, test, vi } from 'vitest';

import { MEMORY_EVENTS, emitEvent } from './memory-event.js';
import type { MemoryEvent } from './memory-event.js';

describe('MEMORY_EVENTS', () => {
  test('has 21 values (20 prior + entity_linking_failed from entity-extraction-nodes-slice1 T3.1)', () => {
    expect(MEMORY_EVENTS).toHaveLength(21);
  });

  test('includes entity_linking_failed (entity-extraction-nodes-slice1 T3.1, fail-soft Phase 7)', () => {
    expect(MEMORY_EVENTS).toContain('entity_linking_failed');
  });

  test('includes getall_temporal_fallback (dashboard-memories-tab-standardization T2.2, ADR D2 + EC-7)', () => {
    expect(MEMORY_EVENTS).toContain('getall_temporal_fallback');
  });

  test('includes extraction_failed (EC-10 absorption)', () => {
    expect(MEMORY_EVENTS).toContain('extraction_failed');
  });

  test('includes dedup_collision_confirmed (principles-alignment-hardening T1.1, ADR D2)', () => {
    expect(MEMORY_EVENTS).toContain('dedup_collision_confirmed');
  });

  test('includes extraction_zero_facts (principles-alignment-hardening T3.1, ADR D2)', () => {
    expect(MEMORY_EVENTS).toContain('extraction_zero_facts');
  });

  test('includes recall_threshold_filtered (principles-alignment-hardening T4.1, ADR D2)', () => {
    expect(MEMORY_EVENTS).toContain('recall_threshold_filtered');
  });

  test('includes the 8 write-phase _completed events', () => {
    const expected: MemoryEvent[] = [
      'extraction_completed',
      'embedding_batch_completed',
      'persist_completed',
      'history_persisted',
      'entity_linked',
      'messages_saved',
    ];
    for (const e of expected) {
      expect(MEMORY_EVENTS).toContain(e);
    }
  });
});

describe('emitEvent', () => {
  test('is a no-op when tracer is undefined (does not throw)', () => {
    expect(() => emitEvent(undefined, 'extraction_started')).not.toThrow();
  });

  test('calls tracer.startActiveSpan with the event name when provided', () => {
    const setAttribute = vi.fn();
    const end = vi.fn();
    const startActiveSpan = vi.fn((_name: string, fn: (span: { setAttribute: typeof setAttribute; end: typeof end }) => void) => {
      fn({ setAttribute, end });
    });
    const tracer = { startActiveSpan } as unknown as Parameters<typeof emitEvent>[0];
    emitEvent(tracer, 'extraction_completed', { facts: 3 });
    expect(startActiveSpan).toHaveBeenCalledWith('extraction_completed', expect.any(Function));
    expect(setAttribute).toHaveBeenCalledWith('facts', 3);
    expect(end).toHaveBeenCalled();
  });

  test('passes through string attribute values', () => {
    const setAttribute = vi.fn();
    const end = vi.fn();
    const startActiveSpan = vi.fn((_name: string, fn: (span: { setAttribute: typeof setAttribute; end: typeof end }) => void) => {
      fn({ setAttribute, end });
    });
    const tracer = { startActiveSpan } as unknown as Parameters<typeof emitEvent>[0];
    emitEvent(tracer, 'persist_completed', { scope: 'alice' });
    expect(setAttribute).toHaveBeenCalledWith('scope', 'alice');
  });
});
