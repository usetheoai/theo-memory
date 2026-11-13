import type { Tracer } from '@opentelemetry/api';

import { emitEvent } from '../memory-event.js';

import { resolveEventTime, type EventTime, type TimeDirection } from './event-time.js';
import type { ExtractedEvidence } from './evidence.js';

/**
 * The time of an extracted fact (ADR-0035, stage 1): when its event is, and how long a passing
 * state holds.
 *
 * The write path used to drop every draft the extractor did not label durable, which also dropped
 * stated plans and dated events (#245). Nothing is dropped for its label now. The date of the
 * event is counted in code from the grounded quote and written into the fact, and a passing state
 * of the moment gets an end, so recall stops showing it after the day it was said while
 * `recall({ asOf })` still reaches it.
 */

export interface TimedDraft {
  readonly text: string;
  readonly evidence?: ExtractedEvidence | undefined;
}

export interface FactTime {
  /** The fact text, with the event date written in or corrected when one was resolved. */
  readonly text: string;
  readonly eventTime?: EventTime;
  /** Set for a passing state of the moment: the end of the UTC day it was said. */
  readonly expiresAt?: Date;
}

const ISO_DATE = /(?<!\d)\d{4}-\d{2}(?:-\d{2})?(?!\d)/g;

function directionOf(evidence: ExtractedEvidence): TimeDirection {
  return evidence.time === 'future' || evidence.time === 'past' ? evidence.time : 'unknown';
}

/** A second time expression in the same sentence makes the first one ambiguous. */
function namesAnotherTime(source: string, first: EventTime, observedAt: Date, language: string | undefined): boolean {
  const rest = source.replace(first.expression, ' ');
  return resolveEventTime(rest, observedAt, 'future', language) !== null
    || resolveEventTime(rest, observedAt, 'past', language) !== null;
}

type TextChange = 'none' | 'corrected' | 'appended';

function withDate(text: string, eventTime: EventTime): { readonly text: string; readonly change: TextChange } {
  const date = eventTime.granularity === 'day' ? eventTime.start : eventTime.start.slice(0, 7);
  const written = text.match(ISO_DATE) ?? [];
  if (written.some((value) => value === date || value.startsWith(`${date}-`))) return { text, change: 'none' };
  if (written.length === 0) return { text: `${text} (${date})`, change: 'appended' };
  const only = written[0];
  // Two dates in one fact: which one the quote corrects is not knowable from here.
  if (written.length > 1 || only === undefined) return { text, change: 'none' };
  return { text: text.replace(only, date), change: 'corrected' };
}

function endOfUtcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate(), 23, 59, 59, 999));
}

export function timeOfFact(draft: TimedDraft, observedAt: Date, language: string | undefined, tracer: Tracer | undefined): FactTime {
  const evidence = draft.evidence;
  if (evidence === undefined) return { text: draft.text };

  const source = evidence.sourceQuote ?? draft.text;
  let eventTime = resolveEventTime(source, observedAt, directionOf(evidence), language);
  if (eventTime !== null && namesAnotherTime(source, eventTime, observedAt, language)) {
    emitEvent(tracer, 'event_time_ambiguous', {});
    eventTime = null;
  }

  let text = draft.text;
  if (eventTime !== null) {
    const dated = withDate(draft.text, eventTime);
    text = dated.text;
    emitEvent(tracer, 'event_time_resolved', { granularity: eventTime.granularity, text_change: dated.change });
  }

  // A plan or a past event stays true as a statement. Only a state of the moment stops holding.
  const passes = evidence.durability !== 'durable' && evidence.time !== 'future' && evidence.time !== 'past' && eventTime === null;
  if (passes) emitEvent(tracer, 'short_lived_expiry_set', { durability: evidence.durability });

  return {
    text,
    ...(eventTime === null ? {} : { eventTime }),
    ...(passes ? { expiresAt: endOfUtcDay(observedAt) } : {}),
  };
}
