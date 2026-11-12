import type { Tracer } from '@opentelemetry/api';

import { emitEvent } from '../memory-event.js';
import type { MemoryEvidence } from '../memory-evidence.js';
import type { Message } from '../message.js';

export interface ExtractedEvidence {
  readonly kind: 'stated' | 'inferred';
  readonly durability: 'durable' | 'temporary' | 'tentative';
  readonly sourceQuote?: string | undefined;
  readonly confidence?: number | undefined;
}

/**
 * Drop temporary/tentative profile updates, and keep only grounded source quotes.
 * Legacy extractors without evidence remain supported and are labeled inferred.
 * A source quote is checked against NEW input, never against recalled memories.
 * @see docs/memory-semantics.md
 */
export function prepareExtractedEvidence<T extends {
  readonly text: string;
  readonly evidence?: ExtractedEvidence | undefined;
}>(items: readonly T[], messages: readonly Message[], tracer?: Tracer): readonly T[] {
  return items.flatMap((item) => {
    const evidence = item.evidence;
    if (evidence === undefined) return [item];
    if (evidence.durability !== 'durable') {
      emitEvent(tracer, 'extraction_evidence_dropped', { reason: evidence.durability });
      return [];
    }
    const quote = evidence.sourceQuote;
    const grounded = quote !== undefined && messages.some((m) => m.content.includes(quote));
    if (grounded) return [item];
    if (quote !== undefined || evidence.kind === 'stated') {
      emitEvent(tracer, 'extraction_evidence_downgraded', { reason: 'ungrounded_source' });
    }
    const { sourceQuote: _quote, ...rest } = evidence;
    return [{ ...item, evidence: { ...rest, kind: 'inferred' as const } }];
  });
}

/** Caller supplies source context; only the extractor decides per-fact interpretation. */
export function extractedMemoryEvidence(
  extracted: ExtractedEvidence | undefined,
  source: MemoryEvidence | undefined,
): MemoryEvidence {
  const { sourceQuote: _sourceQuote, confidence: _confidence, ...context } = source ?? {};
  return {
    ...context,
    kind: extracted?.kind ?? 'inferred',
    // Only per-fact quotes and confidence estimates survive extraction.
    ...(extracted?.sourceQuote !== undefined ? { sourceQuote: extracted.sourceQuote } : {}),
    ...(extracted?.confidence !== undefined ? { confidence: extracted.confidence } : {}),
  };
}
