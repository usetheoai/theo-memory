import { describe, expect, test } from 'vitest';

import { anchorsOverlap, differentPeriods, periodAnchors } from './period-anchor.js';

describe('periodAnchors', () => {
  test.each([
    ['Rafael sold 8,200 bottles in 2022', [{ year: 2022 }]],
    ['Ines visited Seville for a weekend in March 2024', [{ year: 2024, month: 3 }]],
    ['Amara saw 410 patients in the first quarter of 2023', [{ year: 2023, quarter: 1 }]],
    ['Revenue was 5,000 in Q3 2024', [{ year: 2024, quarter: 3 }]],
    ['Jonas escalou o Mont Blanc em julho de 2022', [{ year: 2022, month: 7 }]],
    ['Beatriz correu 1.450 km em 2023', [{ year: 2023 }]],
    ['Diego ganó 2.000 dólares en enero de 2024', [{ year: 2024, month: 1 }]],
    ['Lucia ha nuotato 12 km a maggio 2024', [{ year: 2024, month: 5 }]],
    ['Diego leyó 18 libros en 2022', [{ year: 2022 }]],
    ['Lea ist im Jahr 2021 nach Wien gezogen', [{ year: 2021 }]],
  ])('reads the period of %j', (text, expected) => {
    expect(periodAnchors(text)).toEqual(expected);
  });

  test.each([
    'Tomas drives a 2015 Honda Civic',
    'Hana now owns a 2023 Honda scooter',
    'Oskar is allergic to bee stings',
    'user feels like wearing green just for this morning',
    'Ines lives in a house in Braga since February 2024',
    'Desde março de 2024, Beatriz mora em Curitiba',
    'Lea wohnt seit 2021 in Wien',
    'Room 2024 is on the second floor',
  ])('finds no period in %j', (text) => {
    expect(periodAnchors(text)).toEqual([]);
  });

  test('a month inside a quarter phrase is not read twice', () => {
    expect(periodAnchors('In the second quarter of 2023, Amara saw 465 patients')).toEqual([{ year: 2023, quarter: 2 }]);
  });
});

describe('anchorsOverlap', () => {
  test('a bare year overlaps any month of that year', () => {
    expect(anchorsOverlap({ year: 2024 }, { year: 2024, month: 5 })).toBe(true);
  });

  test('a month overlaps the quarter that contains it and not another', () => {
    expect(anchorsOverlap({ year: 2023, month: 5 }, { year: 2023, quarter: 2 })).toBe(true);
    expect(anchorsOverlap({ year: 2023, month: 5 }, { year: 2023, quarter: 3 })).toBe(false);
  });

  test('different years never overlap', () => {
    expect(anchorsOverlap({ year: 2023 }, { year: 2024 })).toBe(false);
  });
});

describe('differentPeriods', () => {
  test('two counts for different years are about different periods', () => {
    expect(differentPeriods('Oskar planted 40 apple trees in 2022', 'Oskar planted 65 apple trees in 2023')).toBe(true);
  });

  test('two quarters of the same year are about different periods', () => {
    expect(differentPeriods('earned 12,000 euros in the first quarter of 2023', 'earned 15,500 euros in the second quarter of 2023')).toBe(true);
  });

  test('a fact without a period can be replaced by one that names when the new state began', () => {
    expect(differentPeriods('Beatriz mora em Campinas', 'Desde março de 2024, Beatriz mora em Curitiba')).toBe(false);
  });

  test('vehicle model years are not periods, so the update stands', () => {
    expect(differentPeriods('Tomas drives a 2015 Honda Civic', 'Tomas now drives a 2023 Toyota Prius')).toBe(false);
  });

  test('a correction that names the old year still overlaps it', () => {
    expect(differentPeriods('Kenji was born in 2015', 'Kenji was born in 2016, not in 2015')).toBe(false);
  });

  test('the same month in two texts is the same period', () => {
    expect(differentPeriods('swam 30 km in June 2023', 'swam 35 km in June 2023')).toBe(false);
  });
});
