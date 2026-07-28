/**
 * M25 T2.2 — smoke import: the `@usetheo/memory/config` subpath resolves and
 * exposes the layered-config public surface (resolveConfig / loadConfig /
 * isSecretKey / maskSecret / ConfigParseError).
 *
 */
import { describe, expect, it } from 'vitest';

import {
  resolveConfig,
  loadConfig,
  isSecretKey,
  maskSecret,
  ConfigParseError,
} from '@usetheo/memory/config';

describe('@usetheo/memory/config subpath', () => {
  it('exports the layered-config surface as callable functions', () => {
    expect(typeof resolveConfig).toBe('function');
    expect(typeof loadConfig).toBe('function');
    expect(typeof isSecretKey).toBe('function');
    expect(typeof maskSecret).toBe('function');
    expect(ConfigParseError.prototype).toBeInstanceOf(Error);
  });
});
