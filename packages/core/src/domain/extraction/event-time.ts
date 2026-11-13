/**
 * Event time: the calendar date a sentence means, computed in code (ADR-0035, stage 1).
 *
 * The extractor used to do this arithmetic itself and write the date into the fact. A small model
 * is weak at it: on 156 sentences it stored the right date in half of the writes, put "11 February"
 * said in September into the year that had already passed, and often kept "in 4 days" as written,
 * which means nothing the day after. Here the wording is read by rules and the date is counted from
 * the instant the sentence was said, in English, Portuguese, Spanish, French, German and Italian.
 *
 * A bare weekday, a day and month with no year, or a bare month does not say which occurrence it
 * means; the direction of the statement does ("I fly on Thursday" against "I ran on Thursday").
 * With no direction such an expression is left unresolved: a wrong date is worse than none.
 *
 * Dates are UTC calendar dates of the reference instant, as the rest of the write path counts them.
 */

export type EventGranularity = 'day' | 'month';

/** Whether the statement is about something still to happen, something that happened, or neither is known. */
export type TimeDirection = 'future' | 'past' | 'unknown';

export interface EventTime {
  /** First day the expression covers, `YYYY-MM-DD`. */
  readonly start: string;
  /** Last day the expression covers, `YYYY-MM-DD`; equal to `start` for a day. */
  readonly end: string;
  readonly granularity: EventGranularity;
  /** The words of the sentence that named the time, as they were written. */
  readonly expression: string;
}

const DAY_MS = 86_400_000;
/** Not a letter or digit before, and none after: a word boundary that knows diacritics. */
const B0 = '(?<![\\p{L}\\p{N}])';
const B1 = '(?![\\p{L}\\p{N}])';

const MONTHS: Readonly<Record<string, number>> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  janeiro: 1, fevereiro: 2, 'março': 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  enero: 1, febrero: 2, marzo: 3, mayo: 5, junio: 6, julio: 7, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  janvier: 1, 'février': 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, 'août': 8, septembre: 9, octobre: 10, novembre: 11, 'décembre': 12,
  januar: 1, februar: 2, 'märz': 3, juni: 6, juli: 7, oktober: 10, dezember: 12,
  gennaio: 1, febbraio: 2, aprile: 4, maggio: 5, giugno: 6, luglio: 7, settembre: 9, ottobre: 10, dicembre: 12,
};

/** Sunday is 0, as `Date.getUTCDay()` counts. */
const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, 'segunda-feira': 1, 'terça-feira': 2, 'quarta-feira': 3, 'quinta-feira': 4, 'sexta-feira': 5, 'sábado': 6,
  lunes: 1, martes: 2, 'miércoles': 3, jueves: 4, viernes: 5,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6,
  domenica: 0, 'lunedì': 1, 'martedì': 2, 'mercoledì': 3, 'giovedì': 4, 'venerdì': 5, sabato: 6,
};

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, siete: 7, ocho: 8, nueve: 9, diez: 10,
  une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
  ein: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, dieci: 10,
};

/** Day and week units, with how many days each one is. */
const UNITS: Readonly<Record<string, number>> = {
  day: 1, days: 1, dia: 1, dias: 1, 'día': 1, 'días': 1, jour: 1, jours: 1, tag: 1, tage: 1, tagen: 1, giorno: 1, giorni: 1,
  week: 7, weeks: 7, semana: 7, semanas: 7, semaine: 7, semaines: 7, woche: 7, wochen: 7, settimana: 7, settimane: 7,
};

const alternatives = (table: Readonly<Record<string, number>>): string =>
  Object.keys(table).sort((a, b) => b.length - a.length).join('|');

const MONTH = `(${alternatives(MONTHS)})`;
const WEEKDAY = `(${alternatives(WEEKDAYS)})`;
const COUNT = `(\\d{1,3}|${alternatives(NUMBER_WORDS)})`;
const UNIT = `(${alternatives(UNITS)})`;

const rx = (body: string): RegExp => new RegExp(`${B0}(?:${body})${B1}`, 'iu');

interface Span {
  readonly start: Date;
  readonly end: Date;
  readonly granularity: EventGranularity;
}

interface Context {
  /** Noon UTC of the day the sentence was said. */
  readonly today: Date;
  readonly direction: TimeDirection;
}

/** The capture groups of the alternative that matched, in order. */
const captured = (match: RegExpExecArray): readonly string[] => match.slice(1).filter((group): group is string => group !== undefined);

interface Rule {
  /** Set when the wording means something else in another language; the rule then needs that language named. */
  readonly onlyIn?: string;
  readonly pattern: RegExp;
  /** `'none'` ends the search: the wording is a date, and it is not one that exists. */
  readonly resolve: (match: RegExpExecArray, context: Context) => Span | null | 'none';
}

const utcDay = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day, 12));
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
const iso = (date: Date): string => date.toISOString().slice(0, 10);
const oneDay = (date: Date): Span => ({ start: date, end: date, granularity: 'day' });
const lower = (value: string | undefined): string => (value ?? '').toLowerCase();

/** The day, or null when the month does not have it (31 February). */
function validDay(year: number, month: number, day: number): Date | null {
  const date = utcDay(year, month, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function wholeMonth(year: number, month: number): Span {
  return { start: utcDay(year, month, 1), end: new Date(Date.UTC(year, month, 0, 12)), granularity: 'month' };
}

function shiftedMonth(today: Date, months: number): Span {
  const index = today.getUTCFullYear() * 12 + today.getUTCMonth() + months;
  return wholeMonth(Math.floor(index / 12), (index % 12) + 1);
}

function count(raw: string | undefined): number | null {
  const text = lower(raw);
  const value = /^\d+$/.test(text) ? Number(text) : NUMBER_WORDS[text];
  return value === undefined || value <= 0 ? null : value;
}

/** Nearest occurrence of a weekday strictly after (`step` 1) or strictly before (`step` -1) today. */
function weekdayFrom(today: Date, weekday: number, step: 1 | -1): Date {
  const distance = (((weekday - today.getUTCDay()) * step) % 7 + 7) % 7;
  return addDays(today, step * (distance === 0 ? 7 : distance));
}

/** Nearest year in which the day and month fall after (future) or before (past) today. */
function dayMonthByDirection(month: number, day: number, context: Context): Date | null {
  if (context.direction === 'unknown') return null;
  const step = context.direction === 'future' ? 1 : -1;
  const year = context.today.getUTCFullYear();
  // Eight years covers 29 February, which only one year in four has.
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = validDay(year + step * offset, month, day);
    if (candidate !== null && (candidate.getTime() - context.today.getTime()) * step > 0) return candidate;
  }
  return null;
}

function monthByDirection(month: number, context: Context): Span | null {
  if (context.direction === 'unknown') return null;
  const year = context.today.getUTCFullYear();
  const current = context.today.getUTCMonth() + 1;
  if (context.direction === 'future') return wholeMonth(month < current ? year + 1 : year, month);
  return wholeMonth(month > current ? year - 1 : year, month);
}

function offsetRule(body: string, sign: 1 | -1, onlyForDirection?: TimeDirection): Rule {
  return {
    pattern: rx(body),
    resolve: (match, context) => {
      if (onlyForDirection !== undefined && context.direction !== onlyForDirection) return null;
      const [rawAmount, rawUnit] = captured(match);
      const amount = count(rawAmount);
      const unit = UNITS[lower(rawUnit)];
      return amount === null || unit === undefined ? null : oneDay(addDays(context.today, sign * amount * unit));
    },
  };
}

const fixedDay = (body: string, offset: number): Rule => ({ pattern: rx(body), resolve: (_, context) => oneDay(addDays(context.today, offset)) });
const fixedMonth = (body: string, offset: number): Rule => ({ pattern: rx(body), resolve: (_, context) => shiftedMonth(context.today, offset) });

function weekdayRule(body: string, step: 1 | -1 | 0): Rule {
  return {
    pattern: rx(body),
    resolve: (match, context) => {
      const weekday = WEEKDAYS[lower(captured(match)[0])];
      if (weekday === undefined) return null;
      const direction = step !== 0 ? step : context.direction === 'future' ? 1 : context.direction === 'past' ? -1 : 0;
      return direction === 0 ? null : oneDay(weekdayFrom(context.today, weekday, direction));
    },
  };
}

function dayMonthRule(body: string, groups: { day: number; month: number; year: number }): Rule {
  return {
    pattern: rx(body),
    resolve: (match, context) => {
      const day = Number(match[groups.day]);
      const month = MONTHS[lower(match[groups.month])];
      const year = match[groups.year];
      if (month === undefined || !Number.isInteger(day)) return null;
      if (year === undefined) {
        const date = dayMonthByDirection(month, day, context);
        return date === null ? null : oneDay(date);
      }
      const date = validDay(Number(year), month, day);
      return date === null ? 'none' : oneDay(date);
    },
  };
}

/** The Spanish and German words for "tomorrow" also mean "morning"; these lead-ins mark the morning. */
const NOT_MORNING_ES = '(?<!(?:esta|la|una|cada|toda|buena|misma|por la|de la)\\s)';
const NOT_MORNING_DE = '(?<!(?:heute|gestern|am|guten|jeden|der|den|einem|einen)\\s)';

/**
 * Tried in order; the first rule that matches and resolves wins. Longer wordings come before the
 * shorter ones they contain ("the day after tomorrow" before "tomorrow").
 */
const RULES: readonly Rule[] = [
  {
    pattern: rx('(\\d{4})-(\\d{2})-(\\d{2})'),
    resolve: (match) => {
      const date = validDay(Number(match[1]), Number(match[2]), Number(match[3]));
      return date === null ? null : oneDay(date);
    },
  },
  fixedDay("the day after tomorrow|depois de amanhã|pasado mañana|après-demain|übermorgen|dopodomani", 2),
  fixedDay("the day before yesterday|anteontem|anteayer|antes de ayer|avant-hier|vorgestern|l'altro ieri|altroieri", -2),
  fixedDay(`tomorrow|amanhã|${NOT_MORNING_ES}mañana|demain|${NOT_MORNING_DE}morgen|domani`, 1),
  fixedDay('yesterday|ontem|ayer|gestern|ieri', -1),
  // French "hier" is German "here".
  { ...fixedDay('hier', -1), onlyIn: 'fr' },
  offsetRule(`${COUNT} ${UNIT} ago|há ${COUNT} ${UNIT}|faz ${COUNT} ${UNIT}|hace ${COUNT} ${UNIT}|il y a ${COUNT} ${UNIT}|vor ${COUNT} ${UNIT}|${COUNT} ${UNIT} fa`, -1),
  offsetRule(`daqui a ${COUNT} ${UNIT}|dentro de ${COUNT} ${UNIT}|dans ${COUNT} ${UNIT}|(?:tra|fra) ${COUNT} ${UNIT}`, 1),
  // "in 5 days" also says how long something took ("I finished it in 5 days"), so it only counts for a plan.
  offsetRule(`in ${COUNT} ${UNIT}|em ${COUNT} ${UNIT}|en ${COUNT} ${UNIT}`, 1, 'future'),
  fixedMonth('next month|mês que vem|próximo mês|mes que viene|próximo mes|mois prochain|nächste[nr]? monat|mese prossimo|prossimo mese', 1),
  fixedMonth('last month|mês passado|mes pasado|mois dernier|(?:letzte|vorige)[nr]? monat|mese scorso|scorso mese', -1),
  weekdayRule(`last ${WEEKDAY}|(?:letzte[nr]?|vorige[nr]?) ${WEEKDAY}|${WEEKDAY} (?:passad[oa]|pasado|dernier|scors[oa])`, -1),
  weekdayRule(`next ${WEEKDAY}|nächste[nr]? ${WEEKDAY}|(?:próxim[oa]|prossim[oa]) ${WEEKDAY}|${WEEKDAY} (?:que vem|que viene|prochain|prossim[oa])`, 1),
  dayMonthRule(`(\\d{1,2})(?:st|nd|rd|th|er|º|\\.)?(?: of| de)? ${MONTH}(?:,?(?: de| of)? (\\d{4}))?`, { day: 1, month: 2, year: 3 }),
  dayMonthRule(`${MONTH} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?`, { day: 2, month: 1, year: 3 }),
  {
    pattern: rx(`${MONTH}(?: de| of)? (\\d{4})`),
    resolve: (match) => {
      const month = MONTHS[lower(match[1])];
      return month === undefined ? null : wholeMonth(Number(match[2]), month);
    },
  },
  weekdayRule(WEEKDAY, 0),
  {
    pattern: rx(`(?:in|em|en|im|a|ad) ${MONTH}`),
    resolve: (match, context) => {
      const month = MONTHS[lower(match[1])];
      return month === undefined ? null : monthByDirection(month, context);
    },
  },
];

/**
 * Reads the time a sentence names and counts it from `observedAt`. Returns null when the sentence
 * names no time, or names one that the direction does not settle. `language` is the ISO 639-1 code
 * of the sentence when it is known; a few wordings are only read with it.
 */
export function resolveEventTime(text: string, observedAt: Date, direction: TimeDirection, language?: string): EventTime | null {
  const context: Context = {
    today: utcDay(observedAt.getUTCFullYear(), observedAt.getUTCMonth() + 1, observedAt.getUTCDate()),
    direction,
  };
  for (const rule of RULES) {
    if (rule.onlyIn !== undefined && rule.onlyIn !== language) continue;
    const match = rule.pattern.exec(text);
    if (match === null) continue;
    const span = rule.resolve(match, context);
    if (span === 'none') return null;
    if (span !== null) {
      return { start: iso(span.start), end: iso(span.end), granularity: span.granularity, expression: match[0] };
    }
  }
  return null;
}
