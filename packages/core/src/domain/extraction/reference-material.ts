import type { Message } from '../message.js';

/**
 * Splits a write into what its author said and the reference material passed along with it (a
 * pasted document, an email, a tool result). Only what was said is extracted, logged and
 * embedded: the material never reaches the extractor, so nothing in it can become a memory,
 * whatever it says or asks for.
 */
export function splitReference(messages: readonly Message[]): { readonly said: readonly Message[]; readonly reference: readonly Message[] } {
  return {
    said: messages.filter((message) => message.reference !== true),
    reference: messages.filter((message) => message.reference === true),
  };
}
