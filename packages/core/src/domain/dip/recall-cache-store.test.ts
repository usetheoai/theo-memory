/**
 * T0.1 RED — RecallCacheStore 13th DIP contract tests.
 *
 * Asserts type shape + validator semantics for the cache config + the
 * `InvalidCacheConfig` typed error. Pure unit tests; ZERO I/O.
 *
 * @see Plan semantic-recall-cache-v1-5 § T0.1 + ADR D1+D2+D3
 * @see Blueprint § D1 (4-method DIP) + D2 (threshold default 0.8) + D3 (4 scope-tiers)
 * @see EC-1 absorption — IEEE 754 NaN/Infinity guard
 * @see EC-3 absorption — `repo` tier (skill scope per ADR-0010) is 4th tier
 */
import { describe, expect, it } from 'vitest';
import { InvalidCacheConfig } from '../errors.js';
import {
  validateRecallCacheStoreConfig,
  type RecallCacheStoreConfig,
  type ScopeTierTtlConfig,
} from './recall-cache-store.js';

describe('T0.1 — RecallCacheStore DIP + validator', () => {
  it('T0.1-RED-1 — throws InvalidCacheConfig on threshold = 1.5 (out of [0,1])', () => {
    expect(() => validateRecallCacheStoreConfig({ threshold: 1.5 })).toThrow(InvalidCacheConfig);
    expect(() => validateRecallCacheStoreConfig({ threshold: 1.5 })).toThrow(/threshold must be in \[0, 1\]/);
  });

  it('T0.1-RED-2 — throws InvalidCacheConfig on maxSizePerScope = 0 (non-positive)', () => {
    expect(() => validateRecallCacheStoreConfig({ maxSizePerScope: 0 })).toThrow(InvalidCacheConfig);
    expect(() => validateRecallCacheStoreConfig({ maxSizePerScope: 0 })).toThrow(/positive integer/);
  });

  it('T0.1-RED-3 — accepts threshold = 0.8 + maxSizePerScope = 1000 (defaults pass)', () => {
    expect(() => validateRecallCacheStoreConfig({ threshold: 0.8, maxSizePerScope: 1000 })).not.toThrow();
    expect(() => validateRecallCacheStoreConfig({})).not.toThrow();
  });

  it('T0.1-RED-4 (EC-1) — throws on threshold = NaN AND threshold = Infinity (IEEE 754 gap)', () => {
    expect(() => validateRecallCacheStoreConfig({ threshold: Number.NaN })).toThrow(InvalidCacheConfig);
    expect(() => validateRecallCacheStoreConfig({ threshold: Number.NaN })).toThrow(/finite number/);
    expect(() => validateRecallCacheStoreConfig({ threshold: Number.POSITIVE_INFINITY })).toThrow(InvalidCacheConfig);
    expect(() => validateRecallCacheStoreConfig({ threshold: Number.NEGATIVE_INFINITY })).toThrow(InvalidCacheConfig);
  });

  it('T0.1-RED-5 (EC-3) — ScopeTierTtlConfig requires 4th tier `repo` (skill scope per ADR-0010)', () => {
    // Type-level guarantee: declaring full config without `repo` must FAIL tsc.
    // We assert at runtime that defaults are honored when consumer provides 4-tier config.
    const fourTier: ScopeTierTtlConfig = { user: 86400, agent: 3600, session: 600, repo: 3600 };
    expect(() => validateRecallCacheStoreConfig({ ttlSecondsByScopeTier: fourTier })).not.toThrow();
    // `repo` tier missing from the partial config (TypeScript catches at compile) — runtime accepts undefined fields
  });

  it('T0.1-RED-6 (EC-3) — throws on ttlSecondsByScopeTier.session = -1 (negative TTL invalid)', () => {
    const config: RecallCacheStoreConfig = {
      ttlSecondsByScopeTier: { user: 86400, agent: 3600, session: -1, repo: 3600 },
    };
    expect(() => validateRecallCacheStoreConfig(config)).toThrow(InvalidCacheConfig);
    expect(() => validateRecallCacheStoreConfig(config)).toThrow(/ttlSecondsByScopeTier\.session.*non-negative/);
  });

  it('T0.1-RED-7 (EC-1+EC-3) — throws on ttlSecondsByScopeTier.repo = NaN (IEEE 754 guard extends to TTLs)', () => {
    const config: RecallCacheStoreConfig = {
      ttlSecondsByScopeTier: { user: 86400, agent: 3600, session: 600, repo: Number.NaN },
    };
    expect(() => validateRecallCacheStoreConfig(config)).toThrow(InvalidCacheConfig);
    expect(() => validateRecallCacheStoreConfig(config)).toThrow(/ttlSecondsByScopeTier\.repo.*non-negative finite/);
  });

  it('T0.1-RED-8 — accepts threshold = 0 boundary (cache disabled hit) and threshold = 1 boundary (exact-only)', () => {
    expect(() => validateRecallCacheStoreConfig({ threshold: 0 })).not.toThrow();
    expect(() => validateRecallCacheStoreConfig({ threshold: 1 })).not.toThrow();
  });

  it('T0.1-RED-9 (EC-13) — accepts maxSizePerScope = 1 (degenerate but valid) — README warns against < 10', () => {
    // EC-13 DOCUMENT absorption: validator allows >= 1; consumer is responsible for >= 10 per README guidance
    expect(() => validateRecallCacheStoreConfig({ maxSizePerScope: 1 })).not.toThrow();
  });

  it('T0.1-RED-10 — InvalidCacheConfig carries the received-value in message (debuggability)', () => {
    try {
      validateRecallCacheStoreConfig({ threshold: 2.5 });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidCacheConfig);
      expect((err as Error).message).toContain('2.5');
    }
  });
});
