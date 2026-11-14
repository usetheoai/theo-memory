import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface History {
  readonly id: string;
  readonly language: string;
  readonly messages: readonly { readonly date: string; readonly kind: string; readonly text: string }[];
  readonly questions: readonly { readonly kind: string; readonly expected: string; readonly notExpected: readonly string[] }[];
}

describe('the committed update histories', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const histories = JSON.parse(readFileSync(resolve(here, 'histories.json'), 'utf8')) as History[];

  it('has sixteen histories of thirty-six messages, half in English and half in Portuguese', () => {
    expect(histories).toHaveLength(16);
    expect(histories.filter((h) => h.language === 'en')).toHaveLength(8);
    for (const history of histories) expect(history.messages, history.id).toHaveLength(36);
  });

  it('dates the messages of a history in the order they are written', () => {
    for (const history of histories) {
      const dates = history.messages.map((m) => m.date);
      expect([...dates].sort(), history.id).toEqual(dates);
      expect(new Set(dates).size, history.id).toBe(dates.length);
    }
  });

  it('asks only for values a message of the history states, and the current value is the last of its chain', () => {
    for (const history of histories) {
      for (const question of history.questions) {
        const stating = history.messages.filter((m) => m.text.includes(question.expected));
        expect(stating.length, `${history.id} ${question.expected}`).toBeGreaterThan(0);
        if (question.kind !== 'own-current') continue;
        const last = stating[stating.length - 1]?.date ?? '';
        for (const earlier of question.notExpected) {
          const own = history.messages.filter((m) => m.kind.startsWith('own-') && m.text.includes(earlier));
          for (const message of own) expect(message.date < last, `${history.id} ${earlier}`).toBe(true);
        }
      }
    }
  });
});
