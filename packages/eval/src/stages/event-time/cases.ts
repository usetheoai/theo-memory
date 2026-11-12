/**
 * Generator of the event-time case set (ADR-0035, stage 1).
 *
 * Each case is one sentence said at `observedAt` that names when something happens, and the
 * calendar date it means. The date is chosen first and the wording is rendered from it, so the
 * expected answer never comes from a parser. The set is a pure function of the seed: the committed
 * `cases.json` is the output of `generateEventTimeCases()` and a test keeps the two equal.
 *
 * The sentences are templates written for this evaluation and share no text with any benchmark.
 */

export type EventTimeLanguage = 'en' | 'pt' | 'es' | 'fr' | 'de' | 'it';
export type EventTimeTense = 'plan' | 'past';
export type EventTimeKind =
  | 'tomorrow' | 'yesterday' | 'day-after-tomorrow' | 'in-n-days' | 'n-days-ago'
  | 'weekday-ahead' | 'weekday-back' | 'day-month-ahead' | 'day-month-back'
  | 'day-month-year' | 'next-month' | 'last-month' | 'month-name-ahead';

export interface EventTimeCase {
  readonly name: string;
  readonly language: EventTimeLanguage;
  readonly kind: EventTimeKind;
  readonly tense: EventTimeTense;
  /** ISO instant the sentence was said at; always noon UTC. */
  readonly observedAt: string;
  readonly text: string;
  /** `YYYY-MM-DD` for a day, `YYYY-MM` for a month. */
  readonly expected: string;
  readonly granularity: 'day' | 'month';
}

export const EVENT_TIME_SEED = 20261112;
const INSTANCES_PER_KIND = 2;
const DAY_MS = 86_400_000;

const LANGUAGES: readonly EventTimeLanguage[] = ['en', 'pt', 'es', 'fr', 'de', 'it'];

interface KindSpec {
  readonly kind: EventTimeKind;
  readonly tense: EventTimeTense;
  readonly granularity: 'day' | 'month';
}

const KINDS: readonly KindSpec[] = [
  { kind: 'tomorrow', tense: 'plan', granularity: 'day' },
  { kind: 'yesterday', tense: 'past', granularity: 'day' },
  { kind: 'day-after-tomorrow', tense: 'plan', granularity: 'day' },
  { kind: 'in-n-days', tense: 'plan', granularity: 'day' },
  { kind: 'n-days-ago', tense: 'past', granularity: 'day' },
  { kind: 'weekday-ahead', tense: 'plan', granularity: 'day' },
  { kind: 'weekday-back', tense: 'past', granularity: 'day' },
  { kind: 'day-month-ahead', tense: 'plan', granularity: 'day' },
  { kind: 'day-month-back', tense: 'past', granularity: 'day' },
  { kind: 'day-month-year', tense: 'plan', granularity: 'day' },
  { kind: 'next-month', tense: 'plan', granularity: 'month' },
  { kind: 'last-month', tense: 'past', granularity: 'month' },
  { kind: 'month-name-ahead', tense: 'plan', granularity: 'month' },
];

interface Wording {
  /** Sentence frames with `{E}` where the time expression goes. */
  readonly plan: readonly string[];
  readonly past: readonly string[];
  readonly months: readonly string[];
  /** Sunday first, as `Date.getUTCDay()` counts. */
  readonly weekdays: readonly string[];
  readonly tomorrow: string;
  readonly yesterday: string;
  readonly dayAfterTomorrow: string;
  readonly inDays: (n: number) => string;
  readonly daysAgo: (n: number) => string;
  readonly weekdayAhead: (weekday: number) => string;
  readonly weekdayBack: (weekday: number) => string;
  readonly dayMonth: (day: number, month: number) => string;
  readonly dayMonthYear: (day: number, month: number, year: number) => string;
  readonly nextMonth: string;
  readonly lastMonth: string;
  readonly inMonth: (month: number) => string;
}

function englishOrdinal(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';
  return `${day}${suffix}`;
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PT_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const PT_DAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ES_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ES_DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const FR_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DE_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const IT_MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const IT_DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

const at = (list: readonly string[], index: number): string => list[index] as string;
/** Portuguese weekdays are feminine except Saturday and Sunday. */
const ptArticle = (weekday: number): string => (weekday === 0 || weekday === 6 ? 'no' : 'na');
const ptLast = (weekday: number): string => (weekday === 0 || weekday === 6 ? 'passado' : 'passada');
/** Italian elides the article before a day number that starts with a vowel sound (8, 11). */
const itDay = (day: number): string => (day === 8 || day === 11 ? `l'${day}` : day === 1 ? 'il 1º' : `il ${day}`);
const itIn = (month: number): string => ([3, 7, 9].includes(month) ? 'ad' : 'a');

const WORDINGS: Readonly<Record<EventTimeLanguage, Wording>> = {
  en: {
    plan: ['I have a dentist appointment {E}.', "I'm flying to Lisbon {E}.", 'My driving test is {E}.', "I'm having dinner with Odile {E}."],
    past: ['I signed the lease {E}.', 'I ran a half marathon {E}.', 'I visited my grandmother {E}.', 'I adopted a cat {E}.'],
    months: EN_MONTHS, weekdays: EN_DAYS,
    tomorrow: 'tomorrow', yesterday: 'yesterday', dayAfterTomorrow: 'the day after tomorrow',
    inDays: (n) => `in ${n} days`, daysAgo: (n) => `${n} days ago`,
    weekdayAhead: (w) => `on ${at(EN_DAYS, w)}`, weekdayBack: (w) => `last ${at(EN_DAYS, w)}`,
    dayMonth: (d, m) => `on the ${englishOrdinal(d)} of ${at(EN_MONTHS, m)}`,
    dayMonthYear: (d, m, y) => `on ${d} ${at(EN_MONTHS, m)} ${y}`,
    nextMonth: 'next month', lastMonth: 'last month', inMonth: (m) => `in ${at(EN_MONTHS, m)}`,
  },
  pt: {
    plan: ['Tenho consulta no dentista {E}.', 'Vou viajar para Lisboa {E}.', 'Minha prova de direção é {E}.', 'Vou jantar com a Odile {E}.'],
    past: ['Assinei o contrato de aluguel {E}.', 'Corri uma meia maratona {E}.', 'Visitei minha avó {E}.', 'Adotei um gato {E}.'],
    months: PT_MONTHS, weekdays: PT_DAYS,
    tomorrow: 'amanhã', yesterday: 'ontem', dayAfterTomorrow: 'depois de amanhã',
    inDays: (n) => `daqui a ${n} dias`, daysAgo: (n) => `há ${n} dias`,
    weekdayAhead: (w) => `${ptArticle(w)} ${at(PT_DAYS, w)}`,
    weekdayBack: (w) => `${ptArticle(w)} ${at(PT_DAYS, w)} ${ptLast(w)}`,
    dayMonth: (d, m) => `no dia ${d} de ${at(PT_MONTHS, m)}`,
    dayMonthYear: (d, m, y) => `no dia ${d} de ${at(PT_MONTHS, m)} de ${y}`,
    nextMonth: 'no mês que vem', lastMonth: 'no mês passado', inMonth: (m) => `em ${at(PT_MONTHS, m)}`,
  },
  es: {
    plan: ['Tengo cita con el dentista {E}.', 'Vuelo a Lisboa {E}.', 'Mi examen de conducir es {E}.', 'Ceno con Odile {E}.'],
    past: ['Firmé el contrato de alquiler {E}.', 'Corrí una media maratón {E}.', 'Visité a mi abuela {E}.', 'Adopté un gato {E}.'],
    months: ES_MONTHS, weekdays: ES_DAYS,
    tomorrow: 'mañana', yesterday: 'ayer', dayAfterTomorrow: 'pasado mañana',
    inDays: (n) => `dentro de ${n} días`, daysAgo: (n) => `hace ${n} días`,
    weekdayAhead: (w) => `el ${at(ES_DAYS, w)}`, weekdayBack: (w) => `el ${at(ES_DAYS, w)} pasado`,
    dayMonth: (d, m) => `el ${d} de ${at(ES_MONTHS, m)}`,
    dayMonthYear: (d, m, y) => `el ${d} de ${at(ES_MONTHS, m)} de ${y}`,
    nextMonth: 'el mes que viene', lastMonth: 'el mes pasado', inMonth: (m) => `en ${at(ES_MONTHS, m)}`,
  },
  fr: {
    plan: ["J'ai rendez-vous chez le dentiste {E}.", "Je prends l'avion pour Lisbonne {E}.", 'Mon examen de conduite est {E}.', 'Je dîne avec Odile {E}.'],
    past: ["J'ai signé le bail {E}.", "J'ai couru un semi-marathon {E}.", "J'ai rendu visite à ma grand-mère {E}.", "J'ai adopté un chat {E}."],
    months: FR_MONTHS, weekdays: FR_DAYS,
    tomorrow: 'demain', yesterday: 'hier', dayAfterTomorrow: 'après-demain',
    inDays: (n) => `dans ${n} jours`, daysAgo: (n) => `il y a ${n} jours`,
    weekdayAhead: (w) => at(FR_DAYS, w), weekdayBack: (w) => `${at(FR_DAYS, w)} dernier`,
    dayMonth: (d, m) => `le ${d === 1 ? '1er' : d} ${at(FR_MONTHS, m)}`,
    dayMonthYear: (d, m, y) => `le ${d === 1 ? '1er' : d} ${at(FR_MONTHS, m)} ${y}`,
    nextMonth: 'le mois prochain', lastMonth: 'le mois dernier', inMonth: (m) => `en ${at(FR_MONTHS, m)}`,
  },
  de: {
    plan: ['Ich habe {E} einen Zahnarzttermin.', 'Ich fliege {E} nach Lissabon.', 'Meine Fahrprüfung ist {E}.', 'Ich esse {E} mit Odile zu Abend.'],
    past: ['Ich habe {E} den Mietvertrag unterschrieben.', 'Ich bin {E} einen Halbmarathon gelaufen.', 'Ich habe {E} meine Großmutter besucht.', 'Ich habe {E} eine Katze adoptiert.'],
    months: DE_MONTHS, weekdays: DE_DAYS,
    tomorrow: 'morgen', yesterday: 'gestern', dayAfterTomorrow: 'übermorgen',
    inDays: (n) => `in ${n} Tagen`, daysAgo: (n) => `vor ${n} Tagen`,
    weekdayAhead: (w) => `am ${at(DE_DAYS, w)}`, weekdayBack: (w) => `letzten ${at(DE_DAYS, w)}`,
    dayMonth: (d, m) => `am ${d}. ${at(DE_MONTHS, m)}`,
    dayMonthYear: (d, m, y) => `am ${d}. ${at(DE_MONTHS, m)} ${y}`,
    nextMonth: 'nächsten Monat', lastMonth: 'letzten Monat', inMonth: (m) => `im ${at(DE_MONTHS, m)}`,
  },
  it: {
    plan: ['Ho un appuntamento dal dentista {E}.', "Prendo l'aereo per Lisbona {E}.", 'Il mio esame di guida è {E}.', 'Ceno con Odile {E}.'],
    past: ["Ho firmato il contratto d'affitto {E}.", 'Ho corso una mezza maratona {E}.', 'Ho fatto visita a mia nonna {E}.', 'Ho adottato un gatto {E}.'],
    months: IT_MONTHS, weekdays: IT_DAYS,
    tomorrow: 'domani', yesterday: 'ieri', dayAfterTomorrow: 'dopodomani',
    inDays: (n) => `tra ${n} giorni`, daysAgo: (n) => `${n} giorni fa`,
    weekdayAhead: (w) => at(IT_DAYS, w), weekdayBack: (w) => `${at(IT_DAYS, w)} scorso`.replace('domenica scorso', 'domenica scorsa'),
    dayMonth: (d, m) => `${itDay(d)} ${at(IT_MONTHS, m)}`,
    dayMonthYear: (d, m, y) => `${itDay(d)} ${at(IT_MONTHS, m)} ${y}`,
    nextMonth: 'il mese prossimo', lastMonth: 'il mese scorso', inMonth: (m) => `${itIn(m)} ${at(IT_MONTHS, m)}`,
  },
};

/** Small seeded generator (mulberry32): the same seed always yields the same set. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

function addMonths(date: Date, months: number): { year: number; month: number } {
  const index = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  return { year: Math.floor(index / 12), month: index % 12 };
}

const isoMonth = (value: { year: number; month: number }): string => `${value.year}-${String(value.month + 1).padStart(2, '0')}`;

interface Rendered {
  readonly expression: string;
  readonly expected: string;
}

function render(spec: KindSpec, wording: Wording, observed: Date, between: (low: number, high: number) => number): Rendered {
  const day = (offset: number, expression: (target: Date) => string): Rendered => {
    const target = addDays(observed, offset);
    return { expression: expression(target), expected: isoDay(target) };
  };
  switch (spec.kind) {
    case 'tomorrow': return day(1, () => wording.tomorrow);
    case 'yesterday': return day(-1, () => wording.yesterday);
    case 'day-after-tomorrow': return day(2, () => wording.dayAfterTomorrow);
    case 'in-n-days': { const n = between(3, 9); return day(n, () => wording.inDays(n)); }
    case 'n-days-ago': { const n = between(3, 9); return day(-n, () => wording.daysAgo(n)); }
    case 'weekday-ahead': return day(between(2, 6), (t) => wording.weekdayAhead(t.getUTCDay()));
    case 'weekday-back': return day(-between(2, 6), (t) => wording.weekdayBack(t.getUTCDay()));
    case 'day-month-ahead': return day(between(20, 200), (t) => wording.dayMonth(t.getUTCDate(), t.getUTCMonth()));
    case 'day-month-back': return day(-between(20, 200), (t) => wording.dayMonth(t.getUTCDate(), t.getUTCMonth()));
    case 'day-month-year': return day(between(20, 400), (t) => wording.dayMonthYear(t.getUTCDate(), t.getUTCMonth(), t.getUTCFullYear()));
    case 'next-month': return { expression: wording.nextMonth, expected: isoMonth(addMonths(observed, 1)) };
    case 'last-month': return { expression: wording.lastMonth, expected: isoMonth(addMonths(observed, -1)) };
    case 'month-name-ahead': {
      const target = addMonths(observed, between(2, 10));
      return { expression: wording.inMonth(target.month), expected: isoMonth(target) };
    }
  }
}

export function generateEventTimeCases(seed: number = EVENT_TIME_SEED): readonly EventTimeCase[] {
  const next = seeded(seed);
  const between = (low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
  const firstDay = Date.UTC(2024, 0, 1, 12);
  const cases: EventTimeCase[] = [];
  for (const language of LANGUAGES) {
    const wording = WORDINGS[language];
    for (const spec of KINDS) {
      for (let instance = 0; instance < INSTANCES_PER_KIND; instance++) {
        const observed = new Date(firstDay + between(0, 729) * DAY_MS);
        const frames = spec.tense === 'plan' ? wording.plan : wording.past;
        const frame = at(frames, between(0, frames.length - 1));
        const rendered = render(spec, wording, observed, between);
        cases.push({
          name: `${language}-${spec.kind}-${instance + 1}`,
          language, kind: spec.kind, tense: spec.tense,
          observedAt: observed.toISOString(),
          text: frame.replace('{E}', rendered.expression),
          expected: rendered.expected,
          granularity: spec.granularity,
        });
      }
    }
  }
  return cases;
}
