import { describe, expect, it } from 'vitest';

import { saysThisMoment } from './this-moment.js';

describe('saysThisMoment', () => {
  it.each([
    'I am exhausted today',
    'Just for this morning I feel like wearing green',
    'I am at the airport right now',
    'Estou cansado hoje',
    'Só nesta manhã estou com vontade de usar verde',
    'Estoy agotada ahora mismo',
    'Stasera sono stanco',
    "Aujourd'hui je suis fatigué",
    'Heute bin ich müde',
    'TONIGHT I feel like pasta',
  ])('reads a day or moment marker in %s', (text) => {
    expect(saysThisMoment(text)).toBe(true);
  });

  it.each([
    'I practise kendo, usually on weekday evenings',
    'I now live in Lisbon',
    'Agora moro em Coimbra',
    'I am applying for a master’s programme abroad',
    'Je travaille maintenant à Lyon',
    'The todayish mood of the office',
    'Ahora trabajo en Cádiz',
  ])('reads none in %s', (text) => {
    expect(saysThisMoment(text)).toBe(false);
  });
});
