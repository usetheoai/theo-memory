/**
 * M25 T1.2 RED — pure secret predicate + mask.
 *
 */
import { describe, expect, it } from 'vitest';

import { isSecretKey, maskSecret } from './secrets.js';

describe('isSecretKey', () => {
  it('secret_key_detected: KEY/SECRET/TOKEN/PASSWORD/BOOTSTRAP match (case-insensitive)', () => {
    for (const key of [
      'OPENAI_API_KEY',
      'THEMEMORY_API_KEY',
      'THEMORY_OIDC_CLIENT_SECRET',
      'X_TOKEN',
      'X_PASSWORD',
      'THEMORY_ADMIN_BOOTSTRAP_TOKEN',
      'X_BOOTSTRAP',
      'lower_secret_case',
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it('non_secret_key: config-surface non-secret keys are not flagged', () => {
    for (const key of ['THEOMEM_PG_URI', 'OPENAI_CHAT_MODEL', 'HOST', 'PORT', 'NODE_ENV']) {
      expect(isSecretKey(key)).toBe(false);
    }
  });
});

describe('maskSecret', () => {
  it('mask_hides_value: leaks no original character', () => {
    const masked = maskSecret('sk-1234567890abcdef');
    expect(masked).toBe('••••');
    expect(masked).not.toContain('sk');
    expect(masked).not.toContain('1234');
  });
});
