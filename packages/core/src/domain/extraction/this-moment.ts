/**
 * Whether a sentence says that something holds for the day it is said: "today", "tonight", "this
 * morning", "right now". The bare "now" of each language is left out on purpose: "I now live in
 * Lisbon" is not about the moment.
 */
const MARKERS: readonly string[] = [
  // English
  'today', 'tonight', 'right now', 'at the moment', 'this morning', 'this afternoon', 'this evening', 'just now',
  // Portuguese
  'hoje', 'neste momento', 'nesta manhã', 'esta manhã', 'nesta tarde', 'esta tarde', 'nesta noite', 'esta noite', 'agora há pouco', 'agora mesmo',
  // Spanish
  'hoy', 'ahora mismo', 'en este momento', 'esta mañana', 'esta tarde', 'esta noche',
  // Italian
  'oggi', 'in questo momento', 'stamattina', 'stasera', 'stanotte', 'questo pomeriggio', 'proprio adesso',
  // French
  "aujourd'hui", 'aujourd’hui', 'ce matin', 'ce soir', 'cet après-midi', 'à l’instant', "à l'instant",
  // German
  'heute', 'heute morgen', 'heute abend', 'in diesem moment', 'jetzt gerade',
];

const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${MARKERS.map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/ /gu, '\\s+')).join('|')})(?![\\p{L}\\p{N}_])`,
  'iu',
);

export function saysThisMoment(text: string): boolean {
  return PATTERN.test(text);
}
