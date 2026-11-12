/**
 * Scoring of the event-time case set: did the stored memory carry the date the sentence meant?
 *
 * The write path is told to write an absolute date into the fact as `YYYY-MM-DD` (a day) or
 * `YYYY-MM` (a month), so the check is a search for that string in what was stored.
 */

export type EventTimeOutcome = 'correct' | 'wrong-date' | 'undated' | 'not-stored';

const ISO_DATE = /(?<!\d)\d{4}-\d{2}(?:-\d{2})?(?!\d)/g;

/**
 * - `not-stored`: the write stored nothing for the sentence.
 * - `correct`: some stored text carries the expected date. A month is also met by a day inside it.
 * - `wrong-date`: the stored text carries an absolute date, and none is the expected one.
 * - `undated`: something was stored with no absolute date at all.
 */
export function classifyEventTime(storedTexts: readonly string[], expected: string): EventTimeOutcome {
  if (storedTexts.length === 0) return 'not-stored';
  const dates = storedTexts.flatMap((text) => text.match(ISO_DATE) ?? []);
  if (dates.some((date) => date === expected || date.startsWith(`${expected}-`))) return 'correct';
  return dates.length > 0 ? 'wrong-date' : 'undated';
}
