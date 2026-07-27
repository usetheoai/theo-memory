/**
 * RED-phase tests for src/core/memory-event.ts — T4.2 of v0-1-local-runtime plan v1.3.
 * 13-value enum (12 original + extraction_failed per EC-10 absorption).
 */
import { describe, expect, test, vi } from 'vitest';

import { MEMORY_EVENTS, emitEvent } from './memory-event.js';
import type { MemoryEvent } from './memory-event.js';

describe('MEMORY_EVENTS', () => {
  test('has 56 values (53 prior + M27 fact-gate drop + write-quality cleanup forgot/skipped)', () => {
    expect(MEMORY_EVENTS).toHaveLength(56);
  });

  test('includes reflection_draft_quarantined (M24 #145 — draft quarantine IGNORE decision is observable)', () => {
    expect(MEMORY_EVENTS).toContain('reflection_draft_quarantined');
  });

  test('includes the M27 write-quality events (fact-gate drop + reversible cleanup, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('extraction_fact_gate_dropped');
    expect(MEMORY_EVENTS).toContain('write_quality_cleanup_forgot');
    expect(MEMORY_EVENTS).toContain('write_quality_cleanup_skipped');
  });

  test('includes recall_cache_write_failed (#132 — cache write is best-effort, never breaks recall)', () => {
    expect(MEMORY_EVENTS).toContain('recall_cache_write_failed');
  });

  test('includes recency_collapse_applied (M22 #141 — collapse IGNORE decision is observable)', () => {
    expect(MEMORY_EVENTS).toContain('recency_collapse_applied');
  });

  test('includes category_auto_assigned + category_auto_dropped (auto-categorization, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('category_auto_assigned');
    expect(MEMORY_EVENTS).toContain('category_auto_dropped');
  });

  test('includes the recall-trace IGNORE/failure events (explainable-recall T3.1, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('recall_trace_write_failed');
    expect(MEMORY_EVENTS).toContain('recall_trace_truncated');
  });

  test('includes entity_noise_filtered (EG-2, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('entity_noise_filtered');
  });

  test('includes extraction_language_mismatch (EG-4 fixes-cycle-1, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('extraction_language_mismatch');
  });

  test('includes extraction_label_language_mismatch (EG-5, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('extraction_label_language_mismatch');
  });

  test('includes the 4 adaptive-retrieval literals (Item 13, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('retrieval_skipped');
    expect(MEMORY_EVENTS).toContain('retrieval_corrected');
    expect(MEMORY_EVENTS).toContain('retrieval_low_confidence');
    expect(MEMORY_EVENTS).toContain('retrieval_policy_failed');
  });

  test('includes the 2 graph-aware-recall literals (Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('recall_graph_expanded');
    expect(MEMORY_EVENTS).toContain('recall_graph_failed');
  });

  test('includes ontology_type_coerced (domain-ontologies T2.2, Princípio 3)', () => {
    expect(MEMORY_EVENTS).toContain('ontology_type_coerced');
  });

  test('includes tool_invocation_denied + skill_executed (agentic-skill-execution-sandbox T1.2)', () => {
    expect(MEMORY_EVENTS).toContain('tool_invocation_denied');
    expect(MEMORY_EVENTS).toContain('skill_executed');
  });

  test('includes recall_rerank_failed (cross-encoder-reranker T2.2, fail-soft ADR D4)', () => {
    expect(MEMORY_EVENTS).toContain('recall_rerank_failed');
  });

  test('includes retrieval_counted_failed (themory-scoped-forget-and-retrieval-counter T2.3, fail-soft)', () => {
    expect(MEMORY_EVENTS).toContain('retrieval_counted_failed');
  });

  test('includes entity_linking_failed (entity-extraction-nodes-slice1 T3.1, fail-soft Phase 7)', () => {
    expect(MEMORY_EVENTS).toContain('entity_linking_failed');
  });

  test('includes entity_edge_linked + entity_edge_linking_failed (slice2 T2.0, edge fail-soft)', () => {
    expect(MEMORY_EVENTS).toContain('entity_edge_linked');
    expect(MEMORY_EVENTS).toContain('entity_edge_linking_failed');
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
  /** A recording tracer stub: exposes the setAttribute/end spies the span receives. */
  function stubTracer() {
    const setAttribute = vi.fn();
    const end = vi.fn();
    const startActiveSpan = vi.fn((_name: string, fn: (span: { setAttribute: typeof setAttribute; end: typeof end }) => void) => {
      fn({ setAttribute, end });
    });
    const tracer = { startActiveSpan } as unknown as Parameters<typeof emitEvent>[0];
    return { tracer, startActiveSpan, setAttribute, end };
  }

  test('is a no-op when tracer is undefined (does not throw)', () => {
    expect(() => emitEvent(undefined, 'extraction_started')).not.toThrow();
  });

  test('calls tracer.startActiveSpan with the event name when provided', () => {
    const { tracer, startActiveSpan, setAttribute, end } = stubTracer();
    emitEvent(tracer, 'extraction_completed', { facts: 3 });
    expect(startActiveSpan).toHaveBeenCalledWith('extraction_completed', expect.any(Function));
    expect(setAttribute).toHaveBeenCalledWith('facts', 3);
    expect(end).toHaveBeenCalled();
  });

  test('passes through string attribute values', () => {
    const { tracer, setAttribute } = stubTracer();
    emitEvent(tracer, 'persist_completed', { scope: 'alice' });
    expect(setAttribute).toHaveBeenCalledWith('scope', 'alice');
  });
});
