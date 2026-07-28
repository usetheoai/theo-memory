/**
 * 4 zod schema tests — T2.1.
 *
 * Coverage: schema parse/reject behavior for remember + recall + forget + reflect.
 * Inline absorbs EC-2 (payload caps), EC-10 (recall.threshold range), EC-11 (reflect strict empty object).
 *
 * @see ADR D2 — Tool schema: zod-authored, 4 separate tools (no action collapsing)
 * @see ADR D6 — Error mechanisms: zod validation fail → Protocol Error -32602
 * @see EC-2 — Payload size caps (MAX_CONTENT_BYTES, MAX_QUERY_BYTES) at boundary
 * @see EC-10 — recall.threshold range [0, 1] default 0
 * @see EC-11 — reflect schema strict (extras rejected)
 */
import { describe, expect, test } from 'vitest';

import { TOOL_NAME as EPISODES_TOOL_NAME } from './episodes-schema.js';
import { TOOL_NAME as FORGET_TOOL_NAME, INPUT_SCHEMA as forgetSchema } from './forget-schema.js';
import { TOOL_NAME as RECALL_TOOL_NAME, INPUT_SCHEMA as recallSchema } from './recall-schema.js';
import {
  TOOL_NAME as REFLECT_TOOL_NAME,
  INPUT_SCHEMA as reflectSchema,
} from './reflect-schema.js';
import {
  TOOL_NAME as REMEMBER_TOOL_NAME,
  INPUT_SCHEMA as rememberSchema,
} from './remember-schema.js';

// Per MCP spec 2025-11-25 § Tool Names (blueprint Q7).
const TOOL_NAME_SPEC_REGEX = /^[A-Za-z0-9_.-]{1,128}$/;

describe('rememberSchema (T2.1)', () => {
  test('accepts a non-empty content string', () => {
    // Given: minimal valid input
    // When: parsed
    const result = rememberSchema.safeParse({ content: 'Paulo likes coffee' });
    // Then: accepted
    expect(result.success).toBe(true);
  });

  test('rejects missing content (zod boundary → Protocol Error -32602 per ADR D6)', () => {
    const result = rememberSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('recallSchema (T2.1)', () => {
  test('defaults topK to 20 (matches @usetheo/memory contract per src/core/retrieval/pipeline.ts:73)', () => {
    // Given: minimal valid input
    // When: parsed
    const result = recallSchema.safeParse({ query: 'beverages' });
    // Then: topK defaults to 20 — honored from v0.0 contract (upstream-pipeline parity, per architecture.md § 5)
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topK).toBe(20);
    }
  });

  test('rejects threshold outside [0, 1] (EC-10 absorption)', () => {
    const tooHigh = recallSchema.safeParse({ query: 'foo', threshold: 1.5 });
    const tooLow = recallSchema.safeParse({ query: 'foo', threshold: -0.1 });
    expect(tooHigh.success).toBe(false);
    expect(tooLow.success).toBe(false);
  });
});

describe('forgetSchema (T2.1)', () => {
  test('rejects when both id and all are provided (mutual exclusion per ADR D6)', () => {
    const result = forgetSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000', all: true });
    expect(result.success).toBe(false);
  });

  test('rejects when neither id nor all is provided (mutual exclusion per ADR D6)', () => {
    const result = forgetSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('reflectSchema (T2.1)', () => {
  test('accepts an empty object', () => {
    const result = reflectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('rejects extra keys (EC-11 strict absorption — prevents silent drift)', () => {
    const result = reflectSchema.safeParse({ unexpected: 'field' });
    expect(result.success).toBe(false);
  });
});

describe('tool names (MCP spec 2025-11-25 § Tool Names — blueprint Q7)', () => {
  test('each tool name matches /^[A-Za-z0-9_.-]{1,128}$/', () => {
    expect(REMEMBER_TOOL_NAME).toMatch(TOOL_NAME_SPEC_REGEX);
    expect(RECALL_TOOL_NAME).toMatch(TOOL_NAME_SPEC_REGEX);
    expect(FORGET_TOOL_NAME).toMatch(TOOL_NAME_SPEC_REGEX);
    expect(REFLECT_TOOL_NAME).toMatch(TOOL_NAME_SPEC_REGEX);
    expect(EPISODES_TOOL_NAME).toMatch(TOOL_NAME_SPEC_REGEX);
  });
});
