import { describe, expect, it } from 'vitest';

import { carries } from './scoring.js';

describe('carries', () => {
  it('finds the value whatever its case or spacing', () => {
    expect(carries('You paid 340  Euros for it.', '340 euros')).toBe(true);
  });

  it('ignores a leading article of the value', () => {
    expect(carries('I ordered lamb stew', 'the lamb stew')).toBe(true);
    expect(carries('Pedi polvo grelhado', 'o polvo grelhado')).toBe(true);
  });

  it('rejects an answer without the value', () => {
    expect(carries('unknown', '340 euros')).toBe(false);
    expect(carries('You paid 34 euros', '340 euros')).toBe(false);
  });
});
