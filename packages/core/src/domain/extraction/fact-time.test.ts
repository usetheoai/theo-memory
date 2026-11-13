import type { Tracer } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import { timeOfFact, type TimedDraft } from './fact-time.js';

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

/** 2025-05-09 is a Friday. */
const SAID = new Date('2025-05-09T15:30:00Z');
const END_OF_DAY = new Date('2025-05-09T23:59:59.999Z');

function draft(text: string, sourceQuote: string, durability: 'durable' | 'temporary' | 'tentative', time?: 'future' | 'past' | 'present'): TimedDraft {
  return { text, evidence: { kind: 'stated', durability, sourceQuote, ...(time === undefined ? {} : { time }) } };
}

describe('timeOfFact — the date of the event', () => {
  it('counts a relative date from when the sentence was said and writes it into the fact', () => {
    const result = timeOfFact(draft('user is flying to Lisbon tomorrow', "I'm flying to Lisbon tomorrow.", 'temporary', 'future'), SAID, 'en', undefined);

    expect(result.eventTime).toEqual({ start: '2025-05-10', end: '2025-05-10', granularity: 'day', expression: 'tomorrow' });
    expect(result.text).toBe('user is flying to Lisbon tomorrow (2025-05-10)');
  });

  it('replaces a date the extractor counted wrong', () => {
    const said = new Date('2024-09-05T12:00:00Z');

    const result = timeOfFact(draft('user isst am 2024-02-11 mit Odile zu Abend', 'Ich esse am 11. Februar mit Odile zu Abend.', 'durable', 'future'), said, 'de', undefined);

    expect(result.text).toBe('user isst am 2025-02-11 mit Odile zu Abend');
  });

  it('leaves a fact that already carries the right date', () => {
    const result = timeOfFact(draft('user adopted a cat on 2025-05-08', 'I adopted a cat yesterday.', 'durable', 'past'), SAID, 'en', undefined);

    expect(result.text).toBe('user adopted a cat on 2025-05-08');
    expect(result.eventTime?.start).toBe('2025-05-08');
  });

  it('writes a month as a month', () => {
    const result = timeOfFact(draft('user has a dentist appointment next month', 'I have a dentist appointment next month.', 'temporary', 'future'), SAID, 'en', undefined);

    expect(result.text).toBe('user has a dentist appointment next month (2025-06)');
  });

  it('uses the direction of the statement for a bare weekday', () => {
    const plan = timeOfFact(draft('user runs on Sunday', 'I run on Sunday.', 'durable', 'future'), SAID, 'en', undefined);
    const past = timeOfFact(draft('user ran on Sunday', 'I ran on Sunday.', 'durable', 'past'), SAID, 'en', undefined);

    expect([plan.eventTime?.start, past.eventTime?.start]).toEqual(['2025-05-11', '2025-05-04']);
  });

  it('resolves nothing when the sentence names two times', () => {
    const events: Recorded[] = [];
    const fact = draft('user booked a flight for 2026-03-03', 'Yesterday I booked a flight for 3 March 2026.', 'durable', 'past');

    const result = timeOfFact(fact, SAID, 'en', recordingTracer(events));

    expect(result).toEqual({ text: 'user booked a flight for 2026-03-03' });
    expect(events).toEqual([{ event: 'event_time_ambiguous', attributes: {} }]);
  });

  it('leaves the text alone when it carries two dates', () => {
    const result = timeOfFact(draft('user flies on 2025-05-12, back on 2025-05-20', "I'm flying tomorrow.", 'durable', 'future'), SAID, 'en', undefined);

    expect(result.text).toBe('user flies on 2025-05-12, back on 2025-05-20');
  });

  it('reports a resolved date and how the text changed', () => {
    const events: Recorded[] = [];

    timeOfFact(draft('user is flying to Lisbon tomorrow', "I'm flying to Lisbon tomorrow.", 'durable', 'future'), SAID, 'en', recordingTracer(events));

    expect(events).toEqual([{ event: 'event_time_resolved', attributes: { granularity: 'day', text_change: 'appended' } }]);
  });

  it('does nothing to a fact that names no time', () => {
    const result = timeOfFact(draft('user is allergic to penicillin', "I'm allergic to penicillin.", 'durable', 'present'), SAID, 'en', undefined);

    expect(result).toEqual({ text: 'user is allergic to penicillin' });
  });

  it('does nothing to a draft with no evidence', () => {
    expect(timeOfFact({ text: 'user likes tea' }, SAID, 'en', undefined)).toEqual({ text: 'user likes tea' });
  });
});

describe('timeOfFact — how long a passing state holds', () => {
  it('ends a passing state of the moment with the day it was said', () => {
    const events: Recorded[] = [];

    const result = timeOfFact(draft('user tiene mucho sueño', 'Ahora mismo tengo muchísimo sueño.', 'temporary', 'present'), SAID, 'es', recordingTracer(events));

    expect(result.expiresAt).toEqual(END_OF_DAY);
    expect(events).toEqual([{ event: 'short_lived_expiry_set', attributes: { durability: 'temporary' } }]);
  });

  it('gives a lasting state no end', () => {
    const result = timeOfFact(draft('user works as a glazier', 'I work as a glazier.', 'durable', 'present'), SAID, 'en', undefined);

    expect(result.expiresAt).toBeUndefined();
  });

  it('gives a plan no end, whatever its label', () => {
    const result = timeOfFact(draft('user is picking up his sister at six', "I'm picking up my sister from the airport at six.", 'temporary', 'future'), SAID, 'en', undefined);

    expect(result.expiresAt).toBeUndefined();
  });

  it('gives a past event no end, whatever its label', () => {
    const result = timeOfFact(draft('Ines visited Seville for a weekend', 'Ines visited Seville for a weekend.', 'temporary', 'past'), SAID, 'en', undefined);

    expect(result.expiresAt).toBeUndefined();
  });

  it('ends a passing statement whose direction the extractor did not say', () => {
    const result = timeOfFact(draft('user feels like wearing the red scarf', 'I feel like wearing the red scarf, no idea why.', 'tentative'), SAID, 'en', undefined);

    expect(result.expiresAt).toEqual(END_OF_DAY);
  });

  it('keeps a dated statement whose direction the extractor did not say', () => {
    const result = timeOfFact(draft('user has an exam tomorrow', 'I have an exam tomorrow.', 'temporary'), SAID, 'en', undefined);

    expect(result.expiresAt).toBeUndefined();
    expect(result.eventTime?.start).toBe('2025-05-10');
  });
});
