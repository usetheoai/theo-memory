import { describe, it, expect } from 'vitest';
import { composeTemporalWhere } from './temporal-where.js';

// T1.1 — the ADR-0011 bi-temporal predicate is extracted to a shared module so
// both the primary recall path AND graph-aware recall reuse ONE audited predicate
// (DRY). Two branches: asOf-omitted (currently-valid) and asOf-set (point-in-time).
describe('composeTemporalWhere', () => {
  it('returns the currently-valid filter with no params when asOf is omitted', () => {
    const t = composeTemporalWhere(undefined, 6);
    expect(t.sql).toBe('t_invalid IS NULL AND (expires_at IS NULL OR expires_at > NOW())');
    expect(t.params).toEqual([]);
    expect(t.nextParamIndex).toBe(6);
  });

  it('returns the null-safe bi-temporal clause with two bound params when asOf is set', () => {
    const asOf = new Date('2026-01-01T00:00:00.000Z');
    const t = composeTemporalWhere(asOf, 6);
    expect(t.params).toEqual([asOf, asOf]);
    expect(t.nextParamIndex).toBe(8);
    expect(t.sql).toContain('t_valid');
    expect(t.sql).toContain('t_invalid');
    expect(t.sql).toContain('$6');
    expect(t.sql).toContain('$7');
  });

  it('prefixes columns with the given table alias so it is safe inside a JOIN (graph expansion reuse)', () => {
    const omitted = composeTemporalWhere(undefined, 6, 'm.');
    expect(omitted.sql).toBe('m.t_invalid IS NULL AND (m.expires_at IS NULL OR m.expires_at > NOW())');

    const asOf = new Date('2026-01-01T00:00:00.000Z');
    const withAlias = composeTemporalWhere(asOf, 6, 'm.');
    expect(withAlias.sql).toContain('m.t_valid');
    expect(withAlias.sql).toContain('m.t_invalid');
    // the alias must NOT leak into the bound-param placeholders
    expect(withAlias.sql).toContain('$6');
    expect(withAlias.params).toEqual([asOf, asOf]);
  });
});
