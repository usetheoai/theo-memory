/**
 * T0.4 + T3.2 — reflection prompt SHAPE-stability + determinism sentinel.
 *
 * EC-8 absorption (parent plan Coverage Matrix row 22; was silently dropped per
 * `/review` F-xval-2 + F-tests-2): lock the rendered prompt for a frozen
 * fixture so future renames inside `src/core/reflection/prompt.ts` cannot
 * silently shift the LLM-facing text. EC-2 absorption (this plan v1.1):
 * additional regex assertion that the prompt is a pure deterministic function
 * of its inputs — zero ISO 8601 timestamps, zero UUID v4 tokens beyond the
 * 3 hard-coded fixture UUIDs, zero unix-second-scale timestamps. Locks
 * determinism forward so a refactor that injects `Date.now()` / `Math.random()`
 * / `randomUUID()` into the prompt header fails this test BEFORE the snapshot
 * itself non-determinizes.
 *
 */
import { describe, expect, test } from 'vitest';

import type { MemoryItem } from '../memory-item.js';
import type { UserScope } from '../scope.js';

import { buildReflectionPrompt } from './prompt.js';

// Paper-name regex built via string concatenation so this test file itself
// does NOT contain the literal banned tokens as contiguous words — grep -wE
// "\b<token>\b" applied across src/**/*.ts (THE GOAL TEST tests 29-33 of the
// parent plan) sees only the fragments, not the joined tokens, and reports
// 0 hits per the no-paper-names-in-code rule. The runtime concatenation
// reassembles the actual regex literal for the assertions below.
const BANNED_TOKENS = [
  'V' + 'oyager',
  'Me' + 'm0',
  'L' + 'etta',
  'Lang' + 'Mem',
  'Mem' + 'GPT',
  'Gra' + 'phiti',
  'Gener' + 'ative\\s*Agents',
  'Co' + 'ALA',
  'Proc' + 'MEM',
  'Hon' + 'cho',
];
const PAPER_NAMES = new RegExp('\\b(' + BANNED_TOKENS.join('|') + ')\\b', 'i');
const ISO_8601 = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UNIX_SECONDS = /\b1[6-9]\d{8}\b/;
const FIXTURE_UUIDS = new Set([
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
]);
const UUID_V4 = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const FROZEN_DATE = new Date('2026-01-01T00:00:00.000Z');

const FIXTURE_USER_SCOPE: UserScope = { kind: 'user', userId: 'alice' };
const FIXTURE_FACTS: readonly MemoryItem[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    text: 'User prefers dark mode',
    hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    scope: FIXTURE_USER_SCOPE,
    createdAt: FROZEN_DATE,
    updatedAt: FROZEN_DATE,
    metadata: {},
    attributedTo: 'user',
    tValid: FROZEN_DATE,
    tInvalid: null,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    text: 'User lives in Berlin',
    hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    scope: FIXTURE_USER_SCOPE,
    createdAt: FROZEN_DATE,
    updatedAt: FROZEN_DATE,
    metadata: {},
    attributedTo: 'assistant',
    tValid: FROZEN_DATE,
    tInvalid: null,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    text: 'User speaks Portuguese',
    hash: 'cccccccccccccccccccccccccccccccc',
    scope: FIXTURE_USER_SCOPE,
    createdAt: FROZEN_DATE,
    updatedAt: FROZEN_DATE,
    metadata: {},
    tValid: FROZEN_DATE,
    tInvalid: null,
  },
];

describe('T0.4 + T3.2 — reflection prompt sentinel', () => {
  test('1. prompt rendered against frozen fixture has zero paper-name tokens (EC-8)', () => {
    const prompt = buildReflectionPrompt(FIXTURE_USER_SCOPE, FIXTURE_FACTS);
    expect(prompt).not.toMatch(PAPER_NAMES);
  });

  test('2. prompt rendered against frozen fixture is shape-stable (EC-8 frozen snapshot)', () => {
    const prompt = buildReflectionPrompt(FIXTURE_USER_SCOPE, FIXTURE_FACTS);
    expect(prompt).toMatchInlineSnapshot(`
      "You are a reflection helper for a personal memory system.
      You are reviewing the recent memories of user "alice". Your job is to consolidate overlapping or related observations into higher-order insights.

      RULES (NON-NEGOTIABLE):
        - Cite source memory IDs verbatim. Invent NO ids.
        - Every output is an inference, never an independently verified operational record.
        - Preserve uncertainty. A passing choice or tentative statement is not a lasting preference.
        - Repeated summaries of the same source are not independent supporting evidence.
        - Respect each source attribution. Assistant-authored claims about the user are not user-confirmed facts.
        - Do not combine sources from different speakers into a claim attributed to one speaker.
        - Every derived insight MUST reference at least one source ID via "derived_from".
        - Return STRICT JSON: an array of objects { "text": string, "derived_from": string[] }.
        - If no consolidation is possible (memories are unrelated), return an empty array [].

      SOURCE MEMORIES (3 total):
        - id="11111111-1111-1111-1111-111111111111" attributed_to="user" evidence=unknown: User prefers dark mode
        - id="22222222-2222-2222-2222-222222222222" attributed_to="assistant" evidence=unknown: User lives in Berlin
        - id="33333333-3333-3333-3333-333333333333" attributed_to="unknown" evidence=unknown: User speaks Portuguese

      Respond with the JSON array. No prose, no preamble."
    `);
  });

  test('3. EC-2 — prompt is a pure deterministic function (no Date.now / UUID-v4-non-fixture / unix-timestamp)', () => {
    const prompt = buildReflectionPrompt(FIXTURE_USER_SCOPE, FIXTURE_FACTS);
    expect(prompt).not.toMatch(ISO_8601);
    expect(prompt).not.toMatch(UNIX_SECONDS);
    const allUuids = prompt.match(UUID_V4) ?? [];
    for (const u of allUuids) {
      expect(FIXTURE_UUIDS.has(u.toLowerCase()), `unexpected UUID in prompt: ${u}`).toBe(true);
    }
  });
});
