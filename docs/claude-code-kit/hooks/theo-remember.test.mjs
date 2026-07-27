#!/usr/bin/env node
// theo-remember.test.mjs — T1.2 (M14) TDD: attributed_to por origem de hook.
//
// Run: node --test docs/claude-code-kit/hooks/theo-remember.test.mjs
//
// A autoria é EMERGENTE da origem do hook: o Stop resume o assistente → 'assistant';
// uma captura explícita do usuário → 'user'. Testa a função pura `buildRememberPayload`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRememberPayload } from './theo-remember.mjs';

const ENV = { userId: '' };

test('test_stop_summary_attributed_to_assistant — o resumo do Stop vai com attributedTo assistant', () => {
  const payload = buildRememberPayload({
    input: { last_assistant_message: 'Migrei a auth de sessões para JWT tokens neste turno.', cwd: '/p/x' },
    env: ENV,
    attributedTo: 'assistant',
  });
  assert.notEqual(payload, null);
  assert.equal(payload.body.attributedTo, 'assistant');
});

test('test_user_remember_attributed_to_user — captura do usuário vai com attributedTo user', () => {
  const payload = buildRememberPayload({
    input: { last_assistant_message: 'O usuário prefere TypeScript e usa ESLint no projeto.', cwd: '/p/x' },
    env: ENV,
    attributedTo: 'user',
  });
  assert.notEqual(payload, null);
  assert.equal(payload.body.attributedTo, 'user');
});

test('test_payload_sets_infer_true — M27 T3.1: o write do kit pede extração explícita', () => {
  const payload = buildRememberPayload({
    input: { last_assistant_message: 'Migrei a auth de sessões para JWT tokens neste turno.', cwd: '/p/x' },
    env: ENV,
    attributedTo: 'assistant',
  });
  assert.notEqual(payload, null);
  assert.equal(payload.body.infer, true);
});

test('test_salience_floor_drops_short_turn — turno curto (< 40 chars) não gera payload', () => {
  const payload = buildRememberPayload({
    input: { last_assistant_message: 'ok', cwd: '/p/x' },
    env: ENV,
    attributedTo: 'assistant',
  });
  assert.equal(payload, null);
});
