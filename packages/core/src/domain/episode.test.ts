/**
 * RED-phase unit tests for src/core/domain/episode.ts — T1.1 of first-class-episodes (M2).
 * Pure cursor + limit + LIKE-escape helpers for the episodic read surface.
 * @see .claude/knowledge-base/plans/first-class-episodes-plan.md § T1.1
 */
import { describe, expect, test } from 'vitest';

import {
  EPISODE_LIMIT_DEFAULT,
  EPISODE_LIMIT_MAX,
  decodeEpisodeCursor,
  encodeEpisodeCursor,
  escapeLikePattern,
  resolveEpisodeLimit,
} from './episode.js';
import { InvalidScope } from './errors.js';

describe('encodeEpisodeCursor / decodeEpisodeCursor', () => {
  test('round-trips created_at (full ms precision) + id', () => {
    const createdAt = new Date('2026-06-22T10:11:12.345Z');
    const id = '11111111-2222-3333-4444-555555555555';
    const cursor = encodeEpisodeCursor(createdAt, id);
    const decoded = decodeEpisodeCursor(cursor);
    expect(decoded.createdAt.toISOString()).toBe('2026-06-22T10:11:12.345Z');
    expect(decoded.id).toBe(id);
  });

  test('decode throws InvalidScope on malformed base64', () => {
    expect(() => decodeEpisodeCursor('!!!not-base64!!!')).toThrow(InvalidScope);
  });

  test('decode throws InvalidScope when the date component is not a valid Date', () => {
    const bad = Buffer.from('not-a-date|some-id', 'utf8').toString('base64url');
    expect(() => decodeEpisodeCursor(bad)).toThrow(InvalidScope);
  });

  test('decode throws InvalidScope when the id component is missing', () => {
    const bad = Buffer.from('2026-06-22T10:11:12.345Z', 'utf8').toString('base64url');
    expect(() => decodeEpisodeCursor(bad)).toThrow(InvalidScope);
  });
});

describe('resolveEpisodeLimit', () => {
  test('defaults to EPISODE_LIMIT_DEFAULT when undefined', () => {
    expect(resolveEpisodeLimit(undefined)).toBe(EPISODE_LIMIT_DEFAULT);
  });

  test('caps at EPISODE_LIMIT_MAX', () => {
    expect(resolveEpisodeLimit(10_000)).toBe(EPISODE_LIMIT_MAX);
  });

  test('passes a valid in-range value through', () => {
    expect(resolveEpisodeLimit(25)).toBe(25);
  });
});

describe('escapeLikePattern', () => {
  test('escapes % _ and backslash so they match literally under ILIKE', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  test('leaves ordinary text untouched', () => {
    expect(escapeLikePattern('hello world')).toBe('hello world');
  });
});
