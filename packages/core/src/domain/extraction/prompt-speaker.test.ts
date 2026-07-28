/**
 * M29 T1.1 (#160) — write-side speaker attribution in the extraction prompt.
 *
 * Root cause (dogfound): the extraction prompt hardcoded the first-person speaker as the
 * entity `user`, so the ASSISTANT's own statements ("I analyzed X") were stored as the
 * user's ("user analisou X"), ignoring the authoritative `attributedTo`. Grounded in the
 * established agent-context discipline: agent actions must be framed
 * "Agent recommended [X]" and attributed to the assistant.
 *
 * These tests lock: attributedTo='assistant' emits a HIGH-PRIORITY directive naming the
 * speaker `assistant` (never `user` for self-statements); the default (user / undefined)
 * path stays byte-identical to the prior behavior (no regression for user turns).
 */
import { describe, expect, test } from 'vitest';

import { generateAdditiveExtractionPrompt } from './prompt.js';

function promptFor(attributedTo?: string): string {
  return generateAdditiveExtractionPrompt(
    [],
    [{ role: 'assistant', content: 'I analyzed the config and recommend an allowlist.' }],
    undefined,
    undefined,
    undefined,
    undefined,
    attributedTo,
  ).prompt;
}

describe('extraction prompt — speaker attribution (M29 / #160)', () => {
  test('attributedTo="assistant" emits an assistant-speaker directive', () => {
    const p = promptFor('assistant');
    const low = p.toLowerCase();
    // Names the assistant as the first-person speaker entity.
    expect(low).toContain('assistant');
    // High-priority override signal so it beats the default `user` rule in SYSTEM_PROMPT.
    expect(low).toContain('highest priority');
    // Frames the assistant's own action as the assistant's, not the user's.
    expect(low).toContain('assistant recommended');
  });

  test('attributedTo="assistant" forbids storing assistant self-statements as `user`', () => {
    const p = promptFor('assistant').toLowerCase();
    // The directive must explicitly reserve `user` for user-stated facts only.
    expect(p).toMatch(/never "user"|reserve "user"/);
  });

  test('default (undefined) path is byte-identical to attributedTo="user" — no regression', () => {
    const def = promptFor(undefined);
    const asUser = promptFor('user');
    expect(def).toBe(asUser);
  });

  test('user turn does NOT carry the assistant-speaker directive', () => {
    const p = promptFor('user').toLowerCase();
    // The assistant override block is assistant-only; a user turn keeps the default speaker.
    expect(p).not.toContain('the author of the new messages is the assistant');
  });

  test('an arbitrary peer id (not "assistant") keeps the default `user` speaker', () => {
    // A user-id string must not trigger the assistant path (only the literal 'assistant' does).
    expect(promptFor('peer-42')).toBe(promptFor('user'));
  });
});
