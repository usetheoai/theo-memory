/**
 * M4 governance FX (/review M4-R1 + M4-R2) — the recall-trace env resolvers.
 * These are the OPERATOR-reachable surface: the per-workspace opt-out and the
 * validated retention window. Deterministic env save/restore, no I/O.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_RECALL_TRACE_MAX_AGE_SECONDS,
  resolveRecallTraceDisabledWorkspaces,
  resolveRecallTraceMaxAgeSeconds,
} from '../recall-trace-env.js';

const OPTOUT = 'THEOMEM_RECALL_TRACE_DISABLED_WORKSPACES';
const MAXAGE = 'THEOMEM_RECALL_TRACE_MAX_AGE_SECONDS';

describe('resolveRecallTraceDisabledWorkspaces (FX1 M4-R1 — operator opt-out)', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = { [OPTOUT]: process.env[OPTOUT] };
    delete process.env[OPTOUT];
  });
  afterEach(() => {
    if (saved[OPTOUT] === undefined) delete process.env[OPTOUT];
    else process.env[OPTOUT] = saved[OPTOUT];
  });

  it('returns [] when unset (no workspace opted out)', () => {
    expect(resolveRecallTraceDisabledWorkspaces()).toEqual([]);
  });
  it('returns [] for an empty / whitespace-only value', () => {
    process.env[OPTOUT] = '   ';
    expect(resolveRecallTraceDisabledWorkspaces()).toEqual([]);
  });
  it('parses a CSV, trimming whitespace and dropping empty entries', () => {
    process.env[OPTOUT] = 'wsA, , wsB ,,wsC';
    expect(resolveRecallTraceDisabledWorkspaces()).toEqual(['wsA', 'wsB', 'wsC']);
  });
  it('parses a single workspace', () => {
    process.env[OPTOUT] = 'tenant-42';
    expect(resolveRecallTraceDisabledWorkspaces()).toEqual(['tenant-42']);
  });
});

describe('resolveRecallTraceMaxAgeSeconds (FX2 M4-R2 — validated window)', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = { [MAXAGE]: process.env[MAXAGE] };
    delete process.env[MAXAGE];
  });
  afterEach(() => {
    if (saved[MAXAGE] === undefined) delete process.env[MAXAGE];
    else process.env[MAXAGE] = saved[MAXAGE];
  });

  it('defaults to 30 days when unset', () => {
    expect(resolveRecallTraceMaxAgeSeconds()).toBe(DEFAULT_RECALL_TRACE_MAX_AGE_SECONDS);
    expect(DEFAULT_RECALL_TRACE_MAX_AGE_SECONDS).toBe(2_592_000);
  });
  it('parses a valid positive value', () => {
    process.env[MAXAGE] = '604800';
    expect(resolveRecallTraceMaxAgeSeconds()).toBe(604800);
  });
  it('rejects a negative value fail-fast (the full-wipe footgun)', () => {
    process.env[MAXAGE] = '-1';
    expect(() => resolveRecallTraceMaxAgeSeconds()).toThrow(RangeError);
  });
  it('rejects zero', () => {
    process.env[MAXAGE] = '0';
    expect(() => resolveRecallTraceMaxAgeSeconds()).toThrow(RangeError);
  });
  it('rejects a non-numeric value (would be NaN → throw-every-tick)', () => {
    process.env[MAXAGE] = 'abc';
    expect(() => resolveRecallTraceMaxAgeSeconds()).toThrow(RangeError);
  });
});
