import type { EventTime } from './extraction/event-time.js';

/**
 * The time attributes of a memory (ADR-0035): when its event is and how long its statement is
 * expected to hold. They ride in the flat payload under these keys.
 */
export type MemoryDurability = 'durable' | 'temporary' | 'tentative';

export const EVENT_START_KEY = 'event_start';
export const EVENT_END_KEY = 'event_end';
export const EVENT_GRANULARITY_KEY = 'event_granularity';
export const EVENT_EXPRESSION_KEY = 'event_expression';
export const DURABILITY_KEY = 'durability';

type Payload = Record<string, string | number | boolean | null>;

interface FactTimeLike {
  readonly eventTime?: EventTime;
  readonly expiresAt?: Date;
}

/**
 * Stamps the time attributes after caller metadata, so a flat field cannot impersonate them.
 * A deadline the caller gave wins over the one derived for a passing state.
 */
export function attachFactTime(
  payload: Payload,
  evidence: { readonly durability: MemoryDurability } | undefined,
  time: FactTimeLike | undefined,
  callerSetExpiry: boolean,
): void {
  for (const key of [EVENT_START_KEY, EVENT_END_KEY, EVENT_GRANULARITY_KEY, EVENT_EXPRESSION_KEY, DURABILITY_KEY]) delete payload[key];
  if (evidence !== undefined) payload[DURABILITY_KEY] = evidence.durability;
  if (time?.eventTime !== undefined) {
    payload[EVENT_START_KEY] = time.eventTime.start;
    payload[EVENT_END_KEY] = time.eventTime.end;
    payload[EVENT_GRANULARITY_KEY] = time.eventTime.granularity;
    payload[EVENT_EXPRESSION_KEY] = time.eventTime.expression;
  }
  if (time?.expiresAt !== undefined && !callerSetExpiry) payload['expires_at'] = time.expiresAt.toISOString();
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the time attributes back; a row written before ADR-0035, or with a malformed value, has none. */
export function factTimeFromPayload(payload: Readonly<Payload>): { readonly eventTime?: EventTime; readonly durability?: MemoryDurability } {
  const start = payload[EVENT_START_KEY];
  const end = payload[EVENT_END_KEY];
  const granularity = payload[EVENT_GRANULARITY_KEY];
  const expression = payload[EVENT_EXPRESSION_KEY];
  const durability = payload[DURABILITY_KEY];
  const hasEvent = typeof start === 'string' && DAY.test(start) && typeof end === 'string' && DAY.test(end)
    && (granularity === 'day' || granularity === 'month') && typeof expression === 'string';
  return {
    ...(hasEvent ? { eventTime: { start, end, granularity, expression } } : {}),
    ...(durability === 'durable' || durability === 'temporary' || durability === 'tentative' ? { durability } : {}),
  };
}
