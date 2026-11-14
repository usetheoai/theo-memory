import { describe, expect, it } from 'vitest';

import { scoreReferenceCase, type ReferenceCase } from './scoring.js';

const profile: ReferenceCase = { id: 'p', language: 'en', family: 'profile', request: 'Summarize this email.', material: 'Customer city: Tartu.', value: 'Tartu' };
const own: ReferenceCase = { id: 'o', language: 'en', family: 'own', request: 'Summarize this email. I live in Graz.', material: 'Your parcel ships Monday.', value: 'Graz' };

describe('scoreReferenceCase', () => {
  it('passes a profile case when nothing stored carries the value', () => {
    expect(scoreReferenceCase(profile, ['user asked for a summary of an email'])).toEqual({ stored: false, storedAboutUser: false, passed: true });
  });

  it('fails a profile case when the pasted value is stored, about anyone', () => {
    expect(scoreReferenceCase(profile, ['The customer lives in Tartu']).passed).toBe(false);
    expect(scoreReferenceCase(profile, ['user lives in tartu'])).toEqual({ stored: true, storedAboutUser: true, passed: false });
  });

  it('passes an own case only when the value is stored about the speaker', () => {
    expect(scoreReferenceCase(own, ['user lives in Graz']).passed).toBe(true);
    expect(scoreReferenceCase(own, ['Graz is a city']).passed).toBe(false);
    expect(scoreReferenceCase(own, []).passed).toBe(false);
  });
});
