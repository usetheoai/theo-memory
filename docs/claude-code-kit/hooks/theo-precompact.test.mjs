#!/usr/bin/env node
// theo-precompact.test.mjs — M26 seam closure: the PreCompact WRITE hook was untestable
// (inline main, no pure builder) and untested — the same class of gap that let the attribution
// bug ship. Tests the extracted pure `buildPrecompactPayload`.
//
// Run: node --test docs/claude-code-kit/hooks/theo-precompact.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrecompactPayload } from './theo-precompact.mjs';

const ENV = { userId: '' };

test('test_precompact_sets_infer_true — the flush asks for extraction explicitly (not the stale verbatim comment)', () => {
  const p = buildPrecompactPayload({
    input: { last_assistant_message: 'Discutimos a migração de auth para JWT e o deploy em container Linux neste turno.', cwd: '/p/x', session_id: 's1' },
    env: ENV,
  });
  assert.notEqual(p, null);
  assert.equal(p.body.infer, true);
});

test('test_precompact_no_single_attributedTo — a mixed transcript keeps per-fact multi-peer attribution (no forced origin)', () => {
  const p = buildPrecompactPayload({
    input: { last_assistant_message: 'user prefere TypeScript; o assistente sugeriu ESLint neste turno de trabalho.', cwd: '/p/x', session_id: 's1' },
    env: ENV,
  });
  // Precompact captures a MIXED transcript — attribution belongs to the LLM per-fact guess,
  // NOT a single forced origin (unlike the assistant-only Stop hook).
  assert.equal(p.body.attributedTo, undefined);
});

test('test_precompact_session_wins_over_user — flush belongs to the compacting session (M8)', () => {
  const p = buildPrecompactPayload({
    input: { last_assistant_message: 'Um turno de trabalho suficientemente longo para passar do salience floor de quarenta chars.', cwd: '/p/x', session_id: 's-abc' },
    env: { userId: 'u1' },
  });
  assert.equal(p.body.sessionId, 's-abc');
  assert.equal(p.body.userId, undefined);
});

test('test_precompact_salience_floor — a short turn produces no payload', () => {
  const p = buildPrecompactPayload({
    input: { last_assistant_message: 'ok', cwd: '/p/x' },
    env: ENV,
  });
  assert.equal(p, null);
});
