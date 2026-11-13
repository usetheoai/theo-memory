/**
 * Period anchors: the explicit calendar periods a fact's text is scoped to (#252).
 *
 * A fact about 2023 is not a version of the same kind of fact about 2024, so supersession on
 * write must not let one replace the other. The extractor's own labels proved unreliable for
 * this, so the signal is read from the text: a year after a temporal preposition ("in 2022",
 * "em 2023", "en 2024"), a month with its year ("March 2024", "julho de 2022") and a quarter
 * with its year ("the second quarter of 2023"), in English, Portuguese, Spanish, Italian, French
 * and German. A year without a temporal preposition, such as a vehicle model year ("a 2015 Honda"),
 * is not a period. A period introduced by "since" ("desde", "seit", "depuis") marks when a state
 * began, which is what an update looks like, so it is not counted either.
 */

export interface PeriodAnchor {
  readonly year: number;
  /** 1..12 when the text names a month. */
  readonly month?: number;
  /** 1..4 when the text names a quarter. */
  readonly quarter?: number;
}

const MONTHS: Readonly<Record<string, number>> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  enero: 1, febrero: 2, marzo: 3, mayo: 5, junio: 6, julio: 7, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  gennaio: 1, febbraio: 2, aprile: 4, maggio: 5, giugno: 6, luglio: 7, settembre: 9, ottobre: 10, dicembre: 12,
  janvier: 1, 'février': 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, 'août': 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, 'décembre': 12, decembre: 12,
  januar: 1, februar: 2, 'märz': 3, maerz: 3, juni: 6, juli: 7, oktober: 10, dezember: 12,
};

const QUARTERS: Readonly<Record<string, number>> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4,
  primeiro: 1, segundo: 2, terceiro: 3, quarto: 4,
  primer: 1, tercer: 3, cuarto: 4,
  primo: 1, secondo: 2, terzo: 3,
  premier: 1, 'deuxième': 2, deuxieme: 2, 'troisième': 3, troisieme: 3, 'quatrième': 4, quatrieme: 4,
  erste: 1, ersten: 1, zweite: 2, zweiten: 2, dritte: 3, dritten: 3, vierte: 4, vierten: 4,
};

const YEAR = '((?:19|20)\\d{2})';
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const QUARTER_WORDS = Object.keys(QUARTERS).sort((a, b) => b.length - a.length).join('|');
// Letters a month or quarter word may sit next to without being part of a longer word.
const L = 'A-Za-zÀ-ÿ';

const MONTH_YEAR = new RegExp(`(?<![${L}])(${MONTH_NAMES})(?![${L}])\\s*,?\\s+(?:(?:of|de|del|di)\\s+)?${YEAR}(?!\\d)`, 'giu');
const QUARTER_YEAR = new RegExp(
  `(?<![${L}])(${QUARTER_WORDS})\\s+(?:quarter|trimestre|quartal)\\s+(?:(?:of|de|del|di|du|des)\\s+)?${YEAR}(?!\\d)` + `|\\bQ([1-4])\\s*(?:of\\s+)?${YEAR}(?!\\d)`,
  'giu',
);
const PREPOSITION_YEAR = new RegExp(
  `(?<![${L}])(?:in|during|throughout|for|em|no|na|en|durante|nel|nell'|im|au|cours de)\\s+(?:(?:the\\s+year|o\\s+ano\\s+de|el\\s+a[nñ]o|l'anno|l'ann[ée]e|dem\\s+jahr|jahr)\\s+)?${YEAR}(?!\\d)`,
  'giu',
);
const SINCE_BEFORE = new RegExp(`(?:since|desde|seit|depuis|dal|dalla|dall'|a partir de)\\s+(?:(?:o|a|el|la|le|the|de)\\s+)?$`, 'iu');

/** The periods the text is explicitly scoped to; empty when it names none. */
export function periodAnchors(text: string): readonly PeriodAnchor[] {
  const anchors: PeriodAnchor[] = [];
  const taken: [number, number][] = [];
  const startsAfterSince = (index: number): boolean => SINCE_BEFORE.test(text.slice(Math.max(0, index - 24), index));
  const overlapsTaken = (start: number, end: number): boolean => taken.some(([s, e]) => start < e && end > s);

  for (const m of text.matchAll(QUARTER_YEAR)) {
    const index = m.index ?? 0;
    taken.push([index, index + m[0].length]);
    if (startsAfterSince(index)) continue;
    const quarter = m[1] !== undefined ? QUARTERS[m[1].toLowerCase()] : Number(m[3]);
    const year = Number(m[2] ?? m[4]);
    if (quarter !== undefined) anchors.push({ year, quarter });
  }
  for (const m of text.matchAll(MONTH_YEAR)) {
    const index = m.index ?? 0;
    if (overlapsTaken(index, index + m[0].length)) continue;
    taken.push([index, index + m[0].length]);
    if (startsAfterSince(index)) continue;
    const month = MONTHS[(m[1] ?? '').toLowerCase()];
    if (month !== undefined) anchors.push({ year: Number(m[2]), month });
  }
  for (const m of text.matchAll(PREPOSITION_YEAR)) {
    const index = m.index ?? 0;
    if (overlapsTaken(index, index + m[0].length)) continue;
    if (startsAfterSince(index)) continue;
    anchors.push({ year: Number(m[1]) });
  }
  return anchors;
}

const quarterOf = (month: number): number => Math.ceil(month / 3);

/** Whether two anchors can describe the same time: same year, and no finer part that differs. */
export function anchorsOverlap(a: PeriodAnchor, b: PeriodAnchor): boolean {
  if (a.year !== b.year) return false;
  if (a.month !== undefined && b.month !== undefined) return a.month === b.month;
  if (a.quarter !== undefined && b.quarter !== undefined) return a.quarter === b.quarter;
  if (a.month !== undefined && b.quarter !== undefined) return quarterOf(a.month) === b.quarter;
  if (a.quarter !== undefined && b.month !== undefined) return quarterOf(b.month) === a.quarter;
  return true;
}

/** True when both texts name periods and none of them can be the same time. */
export function differentPeriods(a: string, b: string): boolean {
  const left = periodAnchors(a);
  const right = periodAnchors(b);
  if (left.length === 0 || right.length === 0) return false;
  return !left.some((x) => right.some((y) => anchorsOverlap(x, y)));
}
