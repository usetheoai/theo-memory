import { describe, expect, it } from 'vitest';

import { attachFactTime, factTimeFromPayload } from './memory-time.js';

const event = { start: '2025-05-10', end: '2025-05-10', granularity: 'day' as const, expression: 'tomorrow' };

describe('attachFactTime', () => {
  it('stamps the event time and the durability, and reads them back', () => {
    const payload: Record<string, string | number | boolean | null> = {};

    attachFactTime(payload, { durability: 'temporary' }, { eventTime: event }, false);

    expect(factTimeFromPayload(payload)).toEqual({ eventTime: event, durability: 'temporary' });
  });

  it('sets the end of a passing state', () => {
    const payload: Record<string, string | number | boolean | null> = {};

    attachFactTime(payload, { durability: 'temporary' }, { expiresAt: new Date('2025-05-09T23:59:59.999Z') }, false);

    expect(payload['expires_at']).toBe('2025-05-09T23:59:59.999Z');
  });

  it('keeps the deadline the caller gave', () => {
    const payload: Record<string, string | number | boolean | null> = { expires_at: '2030-01-01T00:00:00.000Z' };

    attachFactTime(payload, { durability: 'temporary' }, { expiresAt: new Date('2025-05-09T23:59:59.999Z') }, true);

    expect(payload['expires_at']).toBe('2030-01-01T00:00:00.000Z');
  });

  it('removes time fields a caller put in the metadata', () => {
    const payload: Record<string, string | number | boolean | null> = { event_start: '1999-01-01', durability: 'durable' };

    attachFactTime(payload, undefined, undefined, false);

    expect(payload).toEqual({});
  });
});

describe('factTimeFromPayload', () => {
  it('reads nothing from a row written before the time attributes existed', () => {
    expect(factTimeFromPayload({ text: 'user likes tea' })).toEqual({});
  });

  it('ignores a malformed event date', () => {
    expect(factTimeFromPayload({ event_start: 'soon', event_end: 'soon', event_granularity: 'day', event_expression: 'soon' })).toEqual({});
  });
});
