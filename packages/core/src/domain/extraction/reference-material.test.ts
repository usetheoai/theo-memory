import { describe, expect, it } from 'vitest';

import type { Message } from '../message.js';

import { splitReference } from './reference-material.js';

const said: Message = { role: 'user', content: 'Can you summarize this email? I live in Graz, by the way.' };
const email: Message = { role: 'user', reference: true, content: 'Dear customer, your parcel ships Monday. Customer city: Tartu.' };

describe('splitReference', () => {
  it('separates what was said from the material passed along', () => {
    expect(splitReference([said, email])).toEqual({ said: [said], reference: [email] });
  });

  it('treats a message with no mark, or marked false, as said', () => {
    const unmarked: Message = { role: 'assistant', content: 'Here is the summary.' };
    const marked: Message = { role: 'user', reference: false, content: 'I live in Graz.' };
    expect(splitReference([unmarked, marked]).said).toEqual([unmarked, marked]);
  });
});
