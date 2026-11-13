import { describe, expect, it } from 'vitest';

import { resolveEventTime, type TimeDirection } from './event-time.js';

/** 2025-05-09 is a Friday. */
const FRIDAY = new Date('2025-05-09T12:00:00Z');

function day(text: string, direction: TimeDirection = 'unknown', observedAt: Date = FRIDAY, language?: string): string | null {
  const resolved = resolveEventTime(text, observedAt, direction, language);
  return resolved === null ? null : `${resolved.granularity}:${resolved.start}`;
}

describe('resolveEventTime — expressions that carry their own direction', () => {
  it.each([
    ["I'm flying to Lisbon tomorrow.", 'day:2025-05-10'],
    ['Vou viajar para Lisboa amanhã.', 'day:2025-05-10'],
    ['Vuelo a Lisboa mañana.', 'day:2025-05-10'],
    ["Je prends l'avion pour Lisbonne demain.", 'day:2025-05-10'],
    ['Ich fliege morgen nach Lissabon.', 'day:2025-05-10'],
    ["Prendo l'aereo per Lisbona domani.", 'day:2025-05-10'],
    ['I adopted a cat yesterday.', 'day:2025-05-08'],
    ['Adotei um gato ontem.', 'day:2025-05-08'],
    ['Adopté un gato ayer.', 'day:2025-05-08'],
    ['Ich habe gestern eine Katze adoptiert.', 'day:2025-05-08'],
    ['Ho adottato un gatto ieri.', 'day:2025-05-08'],
    ['My driving test is the day after tomorrow.', 'day:2025-05-11'],
    ['Minha prova de direção é depois de amanhã.', 'day:2025-05-11'],
    ['Mi examen de conducir es pasado mañana.', 'day:2025-05-11'],
    ['Mon examen de conduite est après-demain.', 'day:2025-05-11'],
    ['Meine Fahrprüfung ist übermorgen.', 'day:2025-05-11'],
    ['Il mio esame di guida è dopodomani.', 'day:2025-05-11'],
  ])('%s', (text, expected) => {
    expect(day(text)).toBe(expected);
  });

  it.each([
    ['Tenho consulta no dentista daqui a 8 dias.', 'day:2025-05-17'],
    ['Tengo cita con el dentista dentro de 4 días.', 'day:2025-05-13'],
    ["J'ai rendez-vous chez le dentiste dans 9 jours.", 'day:2025-05-18'],
    ['Ho un appuntamento dal dentista tra 6 giorni.', 'day:2025-05-15'],
    ['I ran a half marathon 7 days ago.', 'day:2025-05-02'],
    ['Corri uma meia maratona há 3 dias.', 'day:2025-05-06'],
    ['Corrí una media maratón hace 6 días.', 'day:2025-05-03'],
    ["J'ai couru un semi-marathon il y a 5 jours.", 'day:2025-05-04'],
    ['Ich bin vor 5 Tagen einen Halbmarathon gelaufen.', 'day:2025-05-04'],
    ['Ho corso una mezza maratona 4 giorni fa.', 'day:2025-05-05'],
  ])('%s', (text, expected) => {
    expect(day(text)).toBe(expected);
  });

  it.each([
    ['I visited my grandmother last Wednesday.', 'day:2025-05-07'],
    ['Visitei minha avó na quarta-feira passada.', 'day:2025-05-07'],
    ['Visité a mi abuela el miércoles pasado.', 'day:2025-05-07'],
    ["J'ai rendu visite à ma grand-mère mercredi dernier.", 'day:2025-05-07'],
    ['Ich habe letzten Mittwoch meine Großmutter besucht.', 'day:2025-05-07'],
    ['Ho fatto visita a mia nonna mercoledì scorso.', 'day:2025-05-07'],
    ['Ho corso una mezza maratona domenica scorsa.', 'day:2025-05-04'],
    ['Adotei um gato no sábado passado.', 'day:2025-05-03'],
  ])('%s', (text, expected) => {
    expect(day(text)).toBe(expected);
  });

  it.each([
    ["I'm having dinner with Odile next month.", 'month:2025-06-01'],
    ['Vou jantar com a Odile no mês que vem.', 'month:2025-06-01'],
    ['Ceno con Odile el mes que viene.', 'month:2025-06-01'],
    ['Je dîne avec Odile le mois prochain.', 'month:2025-06-01'],
    ['Ich esse nächsten Monat mit Odile zu Abend.', 'month:2025-06-01'],
    ['Ceno con Odile il mese prossimo.', 'month:2025-06-01'],
    ['I signed the lease last month.', 'month:2025-04-01'],
    ['Assinei o contrato de aluguel no mês passado.', 'month:2025-04-01'],
    ['Firmé el contrato de alquiler el mes pasado.', 'month:2025-04-01'],
    ["J'ai signé le bail le mois dernier.", 'month:2025-04-01'],
    ['Ich habe letzten Monat den Mietvertrag unterschrieben.', 'month:2025-04-01'],
    ["Ho firmato il contratto d'affitto il mese scorso.", 'month:2025-04-01'],
  ])('%s', (text, expected) => {
    expect(day(text)).toBe(expected);
  });

  it('crosses the year when the next month is January', () => {
    expect(day('I have a dentist appointment next month.', 'unknown', new Date('2025-12-20T12:00:00Z'))).toBe('month:2026-01-01');
  });
});

describe('resolveEventTime — a date with its year', () => {
  it.each([
    ['My driving test is on 20 February 2026.', 'day:2026-02-20'],
    ['My driving test is on March 3rd, 2026.', 'day:2026-03-03'],
    ['Minha prova de direção é no dia 20 de fevereiro de 2026.', 'day:2026-02-20'],
    ['Mi examen de conducir es el 20 de febrero de 2026.', 'day:2026-02-20'],
    ['Mon examen de conduite est le 1er mars 2026.', 'day:2026-03-01'],
    ['Meine Fahrprüfung ist am 20. Februar 2026.', 'day:2026-02-20'],
    ["Il mio esame di guida è l'8 marzo 2026.", 'day:2026-03-08'],
    ['user has a driving test on 2026-02-20', 'day:2026-02-20'],
    ['I moved to Leipzig in August 2023.', 'month:2023-08-01'],
    ['Mudei para Belém em julho de 2022.', 'month:2022-07-01'],
  ])('%s', (text, expected) => {
    expect(day(text)).toBe(expected);
  });
});

describe('resolveEventTime — a date that needs the direction of the statement', () => {
  it('takes the next occurrence of a day and month for a plan', () => {
    // Said on 5 September 2024: 11 February has passed this year.
    expect(day('Ich esse am 11. Februar mit Odile zu Abend.', 'future', new Date('2024-09-05T12:00:00Z'))).toBe('day:2025-02-11');
  });

  it('takes the previous occurrence of a day and month for a past event', () => {
    expect(day('I adopted a cat on the 2nd of June.', 'past', new Date('2025-12-11T12:00:00Z'))).toBe('day:2025-06-02');
    expect(day('Corrí una media maratón el 12 de diciembre.', 'past', new Date('2024-06-17T12:00:00Z'))).toBe('day:2023-12-12');
  });

  it('takes the next occurrence of a weekday for a plan', () => {
    expect(day('Mi examen de conducir es el jueves.', 'future')).toBe('day:2025-05-15');
    expect(day('Ceno con Odile lunedì.', 'future')).toBe('day:2025-05-12');
    expect(day("I'm having dinner with Odile on Sunday.", 'future')).toBe('day:2025-05-11');
  });

  it('takes the previous occurrence of a weekday for a past event', () => {
    expect(day('I ran a half marathon on Sunday.', 'past')).toBe('day:2025-05-04');
  });

  it('counts "in N days" forward for a plan', () => {
    expect(day('I have a dentist appointment in 5 days.', 'future')).toBe('day:2025-05-14');
    expect(day('I have a dentist appointment in three days.', 'future')).toBe('day:2025-05-12');
    expect(day('Ich habe in 4 Tagen einen Zahnarzttermin.', 'future')).toBe('day:2025-05-13');
    expect(day('I have a dentist appointment in 2 weeks.', 'future')).toBe('day:2025-05-23');
  });

  it('takes the next occurrence of a month for a plan, as a month', () => {
    expect(day('Tengo cita con el dentista en diciembre.', 'future')).toBe('month:2025-12-01');
    expect(day('Mon examen de conduite est en mars.', 'future')).toBe('month:2026-03-01');
    expect(day('Ich fliege im November nach Lissabon.', 'future')).toBe('month:2025-11-01');
    expect(day('Il mio esame di guida è ad agosto.', 'future')).toBe('month:2025-08-01');
  });

  it('leaves a bare weekday, day and month, or month alone when the direction is unknown', () => {
    expect(day('The meeting is on Thursday.')).toBeNull();
    expect(day('The meeting is on the 14th of March.')).toBeNull();
    expect(day('The meeting is in March.')).toBeNull();
  });
});

describe('resolveEventTime — what it reports and what it leaves alone', () => {
  it('reports the span of a month and the words that named it', () => {
    expect(resolveEventTime('I signed the lease last month.', FRIDAY, 'unknown')).toEqual({
      start: '2025-04-01', end: '2025-04-30', granularity: 'month', expression: 'last month',
    });
  });

  it('reports one day as its own start and end', () => {
    expect(resolveEventTime('Vou viajar para Lisboa amanhã.', FRIDAY, 'unknown')).toEqual({
      start: '2025-05-10', end: '2025-05-10', granularity: 'day', expression: 'amanhã',
    });
  });

  it('finds no time in a sentence that names none', () => {
    expect(day('I work as a glazier in Rostock.', 'future')).toBeNull();
  });

  it('does not read a model year or a quantity as a date', () => {
    expect(day('I drive a 2015 Honda.', 'future')).toBeNull();
    expect(day('I ran 5 kilometres.', 'past')).toBeNull();
  });

  it('does not read the modal verb in "May I" or the French "mai" inside a word as a month', () => {
    expect(day('May I ask you something?', 'future')).toBeNull();
    expect(day('Je vais à la mairie.', 'future')).toBeNull();
  });

  it('reads the French "hier" only when the sentence is known to be French', () => {
    expect(day("J'ai adopté un chat hier.", 'unknown', FRIDAY, 'fr')).toBe('day:2025-05-08');
    expect(day('Ich bin hier zu Hause.', 'unknown', FRIDAY, 'de')).toBeNull();
    expect(day("J'ai adopté un chat hier.")).toBeNull();
  });

  it('does not read the Spanish or German morning as tomorrow', () => {
    expect(day('Esta mañana corrí una hora.')).toBeNull();
    expect(day('Ich war heute Morgen beim Arzt.')).toBeNull();
  });

  it('does not read how long something took as a date', () => {
    expect(day('I finished the report in 5 days.', 'past')).toBeNull();
  });

  it('rejects a day that the month does not have', () => {
    expect(day('The party is on 31 February 2026.')).toBeNull();
  });
});
